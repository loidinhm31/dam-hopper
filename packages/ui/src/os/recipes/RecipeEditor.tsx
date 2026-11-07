import {
  useState,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { OsDesktop, OsWindow } from "../types.js";
import type {
  RecipeStepKey,
  RecipeV1,
} from "./types.js";
import {
  buildRecipeFromDesktopSubset,
} from "./recipe-engine.js";
import {
  exportRecipeJson,
  importRecipeJson,
} from "./schema.js";
import { saveRecipe } from "./persistence.js";
import { generateUUID } from "@/lib/utils.js";
import {
  getProfiles,
  getProfileChangeVersion,
  subscribeToProfileChanges,
  type ServerProfile,
} from "@/api/server-config.js";
import {
  getAllConnectionSnapshots,
  getConnectionSnapshot,
  subscribeConnections,
  type ConnectionSnapshot,
} from "@/api/connections.js";
import { useProjects } from "@/api/queries.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import {
  collectDesktopWindowIds,
  determineDefaultCandidatePair,
  determineSourceEmptyState,
  projectSourceDesktopWindowsPreview,
  projectSourceWindowsToCandidatePairs,
  type CanonicalContextCandidate,
  type ExtendedMatchingWindowPreview,
} from "./recipe-source-context.js";

export interface RecipeEditorProps {
  desktop?: OsDesktop;
  desktops?: readonly OsDesktop[];
  sourceDesktopId?: string;
  windows: Record<string, OsWindow>;
  initialRecipe?: RecipeV1;
  initialMode?: "save-subset" | "import" | "export";
  onSaved: (recipe: RecipeV1) => void;
  onCancel: () => void;
}

export function RecipeEditor({
  desktop,
  desktops,
  sourceDesktopId: propSourceDesktopId,
  windows,
  initialRecipe,
  initialMode,
  onSaved,
  onCancel,
}: RecipeEditorProps): ReactElement {
  const [mode, setMode] = useState<"save-subset" | "import" | "export">(
    initialMode ?? (initialRecipe ? "export" : "save-subset"),
  );

  // Fallback to single desktop if desktops array is not supplied
  const availableDesktops = useMemo(() => {
    if (desktops && desktops.length > 0) return desktops;
    if (desktop) return [desktop];
    return [];
  }, [desktops, desktop]);

  // Explicit source desktop selection - initialized ONCE on mount;
  // navigating outer shell does NOT reset it or authored commands.
  const [selectedDesktopId, setSelectedDesktopId] = useState<string>(() => {
    return propSourceDesktopId ?? desktop?.id ?? availableDesktops[0]?.id ?? "";
  });

  const sourceDesktop = useMemo(() => {
    return availableDesktops.find((d) => d.id === selectedDesktopId);
  }, [availableDesktops, selectedDesktopId]);

  // Configured profiles and live connection snapshots (read-only inputs)
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    getProfileChangeVersion,
    () => 0,
  );

  const profiles: ServerProfile[] = useMemo(() => {
    try {
      return getProfiles();
    } catch {
      return [];
    }
  }, [profileVersion]);

  const connectionVersion = useSyncExternalStore(
    subscribeConnections,
    () =>
      profiles
        .map((p) => {
          const s = getConnectionSnapshot(p.id);
          return `${p.id}:${s?.status}:${s?.owner?.generation ?? 0}`;
        })
        .join(";"),
    () => "",
  );

  const connectionSnapshots: Record<string, ConnectionSnapshot> = useMemo(() => {
    try {
      const snapshots = getAllConnectionSnapshots();
      const map: Record<string, ConnectionSnapshot> = {};
      for (const snap of snapshots) {
        if (snap?.owner?.profileId) {
          map[snap.owner.profileId] = snap;
        }
      }
      return map;
    } catch {
      return {};
    }
  }, [connectionVersion]);

  // Compute canonical candidate pairs strictly derived from actual project-bearing windows on source
  const candidates: CanonicalContextCandidate[] = useMemo(() => {
    if (!sourceDesktop) return [];
    return projectSourceWindowsToCandidatePairs({
      desktop: sourceDesktop,
      windows,
      configuredProfiles: profiles,
      connectionSnapshots,
    });
  }, [sourceDesktop, windows, profiles, connectionSnapshots]);

  // Determine initial default candidate pair:
  // matching desktop default if eligible, otherwise sole eligible pair; mixed requires explicit choice.
  const initialDefault = useMemo(() => {
    if (initialRecipe) {
      return { profileId: initialRecipe.profileId, projectId: initialRecipe.project };
    }
    if (!sourceDesktop) return null;
    return determineDefaultCandidatePair({
      candidates,
      desktopDefaultCtx: sourceDesktop.defaultCtx,
    });
  }, [initialRecipe, sourceDesktop, candidates]);

  // Target context selection state
  const [chosenProfileId, setChosenProfileId] = useState<string>(() => {
    return initialDefault?.profileId ?? "";
  });
  const [chosenProjectId, setChosenProjectId] = useState<string>(() => {
    return initialDefault?.projectId ?? "";
  });

  // Track user selection modification so late discovery cannot overwrite deliberate selection
  const userSelectionModified = useRef(false);

  const [recipeName, setRecipeName] = useState<string>(
    initialRecipe?.name ?? `${sourceDesktop?.name ?? "Desktop"} Recipe`,
  );
  const [recipeDesc, setRecipeDesc] = useState<string>(
    initialRecipe?.description ?? "",
  );

  // Authored commands per stepKey
  const [authoredCommands, setAuthoredCommands] = useState<Record<RecipeStepKey, string>>(() => {
    const init: Record<RecipeStepKey, string> = {};
    if (initialRecipe) {
      for (const s of initialRecipe.terminalSteps) {
        init[s.key] = s.command;
      }
    }
    return init;
  });

  // Value-bound confirmation fingerprint: stepKey -> `${windowId}:::${command}`
  // Any edit to command text invalidates that step's confirmation.
  const [confirmedCommandByStep, setConfirmedCommandByStep] = useState<Record<RecipeStepKey, string>>(() => {
    const init: Record<RecipeStepKey, string> = {};
    if (initialRecipe) {
      for (const s of initialRecipe.terminalSteps) {
        init[s.key] = `${s.key}:::${s.command}`;
      }
    }
    return init;
  });

  // Import / Export state
  const [importJsonText, setImportJsonText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Existing project discovery supplements options/labels with explicit zero matches.
  // Reuses existing project/profile query without new poll loop.
  const { data: discoveredProjects = [] } = useProjects(
    chosenProfileId ? { profileId: chosenProfileId } : { profileId: "__disabled__" },
  );

  // Handlers for explicit source & target selection
  const handleSourceDesktopChange = (newDesktopId: string) => {
    setSelectedDesktopId(newDesktopId);
    userSelectionModified.current = false;
    const newDesktop = availableDesktops.find((d) => d.id === newDesktopId);
    if (newDesktop) {
      const newCandidates = projectSourceWindowsToCandidatePairs({
        desktop: newDesktop,
        windows,
        configuredProfiles: profiles,
        connectionSnapshots,
      });
      const newDef = determineDefaultCandidatePair({
        candidates: newCandidates,
        desktopDefaultCtx: newDesktop.defaultCtx,
      });
      if (newDef) {
        setChosenProfileId(newDef.profileId);
        setChosenProjectId(newDef.projectId);
      } else {
        setChosenProfileId("");
        setChosenProjectId("");
      }
      setRecipeName(`${newDesktop.name} Recipe`);
    }
  };

  const handleServerChange = (newProfileId: string) => {
    userSelectionModified.current = true;
    setChosenProfileId(newProfileId);
    // Narrow project choices to projects belonging to this server on this desktop
    const serverCandidates = candidates.filter((c) => c.profileId === newProfileId);
    const stillHasChosenProj = serverCandidates.some((c) => c.projectId === chosenProjectId);
    if (!stillHasChosenProj) {
      if (serverCandidates.length === 1) {
        setChosenProjectId(serverCandidates[0].projectId);
      } else {
        setChosenProjectId("");
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    userSelectionModified.current = true;
    setChosenProjectId(newProjectId);
  };

  // Command editing: strictly invalidates that step's confirmation
  const handleCommandChange = (stepKey: RecipeStepKey, val: string) => {
    setAuthoredCommands((prev) => ({ ...prev, [stepKey]: val }));
    // Invalidate value-bound confirmation on every edit
    setConfirmedCommandByStep((prev) => {
      if (stepKey in prev) {
        const next = { ...prev };
        delete next[stepKey];
        return next;
      }
      return prev;
    });
  };

  const handleConfirmToggle = (
    stepKey: RecipeStepKey,
    windowId: string,
    currentCmd: string,
    checked: boolean,
  ) => {
    setConfirmedCommandByStep((prev) => {
      const next = { ...prev };
      if (checked) {
        next[stepKey] = `${windowId}:::${currentCmd}`;
      } else {
        delete next[stepKey];
      }
      return next;
    });
  };

  // Preview EVERY window on source desktop as included or excluded with clear reason
  const subsetPreview = useMemo(() => {
    if (!sourceDesktop) {
      return {
        matchingWindows: [] as ExtendedMatchingWindowPreview[],
        excludedWindows: [],
        canSave: false,
      };
    }
    return projectSourceDesktopWindowsPreview({
      desktop: sourceDesktop,
      windows,
      chosenProfileId,
      chosenProjectId,
    });
  }, [sourceDesktop, windows, chosenProfileId, chosenProjectId]);

  // Distinguish empty states:
  // fleet-only / no project windows, windows on different desktop, different selected context
  const emptyState = useMemo(() => {
    if (!sourceDesktop) return { type: "none" as const };
    return determineSourceEmptyState({
      desktop: sourceDesktop,
      allDesktops: availableDesktops,
      windows,
      matchingCount: subsetPreview.matchingWindows.length,
      candidatesCount: candidates.length,
    });
  }, [sourceDesktop, availableDesktops, windows, subsetPreview.matchingWindows.length, candidates.length]);

  // Export JSON preview
  const exportPreview = useMemo(() => {
    if (!initialRecipe) return null;
    return exportRecipeJson(initialRecipe);
  }, [initialRecipe]);

  // Save handler
  const handleSaveSubset = () => {
    setSaveError(null);
    if (!sourceDesktop) {
      setSaveError("No valid source desktop available");
      return;
    }
    if (!recipeName.trim()) {
      setSaveError("Recipe name cannot be empty");
      return;
    }
    if (!chosenProfileId.trim()) {
      setSaveError("Target host profile cannot be empty");
      return;
    }
    if (!chosenProjectId.trim()) {
      setSaveError("Target project cannot be empty");
      return;
    }
    if (subsetPreview.matchingWindows.length === 0) {
      setSaveError("Cannot save recipe: no matching windows found");
      return;
    }

    try {
      const recipeId = initialRecipe?.id ?? `recipe-${generateUUID().slice(0, 8)}`;
      const { recipe } = buildRecipeFromDesktopSubset({
        recipeId,
        name: recipeName.trim(),
        description: recipeDesc.trim() || undefined,
        desktop: sourceDesktop,
        windows,
        chosenProfileId,
        chosenProjectId,
        authoredCommandsByStepKey: authoredCommands,
      });

      saveRecipe(recipe);
      onSaved(recipe);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const handleImport = () => {
    setImportErrors([]);
    const res = importRecipeJson(importJsonText);
    if (!res.valid) {
      setImportErrors(res.errors as string[]);
      return;
    }

    try {
      saveRecipe(res.recipe);
      onSaved(res.recipe);
    } catch (err) {
      setImportErrors([(err as Error).message]);
    }
  };

  // Derive Server options (Source candidates first, then other configured profiles with 0 windows)
  const candidateProfileIds = new Set(candidates.map((c) => c.profileId));
  const otherProfiles = profiles.filter((p) => !candidateProfileIds.has(p.id));

  // Derive Project options for the chosen server (Source candidates first, then other discovered projects with 0 windows)
  const serverCandidates = candidates.filter((c) => c.profileId === chosenProfileId);
  const serverCandidateProjectIds = new Set(serverCandidates.map((c) => c.projectId));
  const otherDiscoveredProjects = discoveredProjects.filter(
    (p) => !serverCandidateProjectIds.has(p.name),
  );

  return (
    <div
      data-testid="recipe-editor"
      className="flex flex-col h-full w-full overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)] text-xs"
    >
      {/* Top Navigation Tabs */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-[var(--color-primary)]">
            📜 Recipe Designer
          </span>
          <div className="flex items-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
            <button
              type="button"
              data-testid="recipe-mode-subset"
              onClick={() => setMode("save-subset")}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                mode === "save-subset"
                  ? "bg-[var(--color-primary)] text-white font-medium"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              Save Desktop Subset
            </button>
            <button
              type="button"
              data-testid="recipe-mode-import"
              onClick={() => setMode("import")}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                mode === "import"
                  ? "bg-[var(--color-primary)] text-white font-medium"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              Import JSON
            </button>
            {initialRecipe && (
              <button
                type="button"
                data-testid="recipe-mode-export"
                onClick={() => setMode("export")}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  mode === "export"
                    ? "bg-[var(--color-primary)] text-white font-medium"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                Export JSON
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          data-testid="recipe-editor-cancel-btn"
          onClick={onCancel}
          className="px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {saveError && (
          <div
            data-testid="recipe-save-error"
            className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-xs"
          >
            {saveError}
          </div>
        )}

        {/* Actionable Source Unavailable State */}
        {mode === "save-subset" && !sourceDesktop && (
          <div
            data-testid="recipe-source-unavailable"
            className="p-4 rounded border border-amber-500/30 bg-amber-500/10 flex flex-col gap-3 max-w-xl"
          >
            <span className="font-bold text-sm text-amber-500">
              Source Desktop Unavailable
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              The selected source desktop is no longer available (it may have been deleted).
              Please select an available desktop to continue recipe capture without moving windows:
            </span>
            <div className="w-64">
              <Select
                value={undefined}
                onValueChange={(val) => handleSourceDesktopChange(val)}
              >
                <SelectTrigger data-testid="recipe-recovery-desktop-select">
                  <SelectValue placeholder="Choose available desktop..." />
                </SelectTrigger>
                <SelectContent>
                  {availableDesktops.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* MODE 1: Save Desktop Subset */}
        {mode === "save-subset" && sourceDesktop && (
          <div className="flex flex-col gap-4 max-w-3xl">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-sm">
                Save Desktop Windows as Reusable Recipe
              </span>
              <span className="text-[var(--color-text-muted)]">
                Choose the source desktop, target host server, and project. Only windows belonging
                to this project will be saved. Excluded nonmatching windows are listed below with
                reasons. Source windows remain byte-for-byte unchanged.
              </span>
            </div>

            {/* Controlled Selectors: Source Desktop -> Server -> Project */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
              {/* 1. Source Desktop Selector */}
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Source Desktop:
                </label>
                <Select
                  value={selectedDesktopId}
                  onValueChange={handleSourceDesktopChange}
                >
                  <SelectTrigger data-testid="recipe-source-desktop">
                    <SelectValue placeholder="Select desktop..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDesktops.map((d) => {
                      const count = collectDesktopWindowIds(d).length;
                      return (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} ({count} {count === 1 ? "win" : "wins"})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Target Server (Host Profile) Selector */}
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Target Host Profile:
                </label>
                <Select
                  value={chosenProfileId || undefined}
                  onValueChange={handleServerChange}
                >
                  <SelectTrigger data-testid="recipe-target-profile">
                    <SelectValue placeholder="Select server..." />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Source desktop candidates first */}
                    {candidates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                          From Source Desktop
                        </SelectLabel>
                        {Array.from(new Set(candidates.map((c) => c.profileId))).map((profId) => {
                          const profCandidates = candidates.filter((c) => c.profileId === profId);
                          const cand = profCandidates[0];
                          const totalWins = profCandidates.reduce((sum, c) => sum + c.windowCount, 0);
                          const disambig = cand.serverDisambiguator ? ` (${cand.serverDisambiguator})` : "";
                          const label = `${cand.serverName}${disambig} • ${totalWins} ${totalWins === 1 ? "window" : "windows"}`;
                          return (
                            <SelectItem key={profId} value={profId}>
                              {label}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    )}

                    {/* Other configured servers */}
                    {otherProfiles.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                          Other Servers
                        </SelectLabel>
                        {otherProfiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} (0 windows on desktop)
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}

                    {/* Ensure currently chosen profile is displayed even if unlisted */}
                    {chosenProfileId &&
                      !candidates.some((c) => c.profileId === chosenProfileId) &&
                      !otherProfiles.some((p) => p.id === chosenProfileId) && (
                        <SelectItem value={chosenProfileId}>
                          {chosenProfileId}
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>

              {/* 3. Target Project Selector (Narrowed to selected server) */}
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Target Project:
                </label>
                <Select
                  value={chosenProjectId || undefined}
                  onValueChange={handleProjectChange}
                  disabled={!chosenProfileId}
                >
                  <SelectTrigger data-testid="recipe-target-project">
                    <SelectValue
                      placeholder={
                        chosenProfileId ? "Select project..." : "Select server first"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Candidate projects from source desktop */}
                    {serverCandidates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                          From Source Desktop
                        </SelectLabel>
                        {serverCandidates.map((cand) => {
                          const wtSuffix =
                            cand.worktreeIds.length > 0
                              ? ` (${cand.worktreeIds.length} ${
                                  cand.worktreeIds.length === 1 ? "worktree" : "worktrees"
                                })`
                              : "";
                          return (
                            <SelectItem key={cand.projectId} value={cand.projectId}>
                              {cand.projectId} ({cand.windowCount} {cand.windowCount === 1 ? "win" : "wins"}){wtSuffix}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    )}

                    {/* Discovered projects */}
                    {otherDiscoveredProjects.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                          Other Discovered Projects
                        </SelectLabel>
                        {otherDiscoveredProjects.map((proj) => (
                          <SelectItem key={proj.name} value={proj.name}>
                            {proj.name} (0 windows on desktop)
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}

                    {/* Fallback option if chosenProjectId is custom or from initialRecipe */}
                    {chosenProjectId &&
                      !serverCandidateProjectIds.has(chosenProjectId) &&
                      !otherDiscoveredProjects.some((p) => p.name === chosenProjectId) && (
                        <SelectItem value={chosenProjectId}>
                          {chosenProjectId}
                        </SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>

              {/* Recipe Name Input */}
              <div className="flex flex-col gap-1 md:col-span-3">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Recipe Name:
                </label>
                <input
                  type="text"
                  data-testid="recipe-name-input"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs focus:outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              {/* Recipe Description Input */}
              <div className="flex flex-col gap-1 md:col-span-3">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Description (optional):
                </label>
                <textarea
                  data-testid="recipe-desc-input"
                  value={recipeDesc}
                  onChange={(e) => setRecipeDesc(e.target.value)}
                  rows={2}
                  className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs focus:outline-none focus:border-[var(--color-primary)] resize-none"
                />
              </div>
            </div>

            {/* Distinct Empty State Views */}
            {emptyState.type === "fleet-only-or-empty" && (
              <div
                data-testid="recipe-empty-fleet-only"
                className="p-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs flex flex-col gap-1"
              >
                <span className="font-bold">No project windows on source desktop</span>
                <span>
                  Desktop "{sourceDesktop.name}" contains only contextless/fleet utilities or has no
                  windows. Open project applications or select a different source desktop above.
                </span>
              </div>
            )}

            {emptyState.type === "windows-on-other-desktop" && (
              <div
                data-testid="recipe-empty-other-desktops"
                className="p-3 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs flex flex-col gap-1.5"
              >
                <span className="font-bold">Project windows exist on other desktops</span>
                <span>
                  Desktop "{sourceDesktop.name}" has no project windows. Eligible project windows
                  were found on other desktops:
                </span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {emptyState.otherDesktopsWithWindows?.map((od) => (
                    <button
                      key={od.id}
                      type="button"
                      onClick={() => handleSourceDesktopChange(od.id)}
                      className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)] flex items-center gap-1 transition-colors"
                    >
                      Switch to {od.name} ({od.windowCount} {od.windowCount === 1 ? "window" : "windows"})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {emptyState.type === "different-selected-context" && (
              <div
                data-testid="recipe-no-matching-warning"
                className="p-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs flex flex-col gap-1"
              >
                <span className="font-bold">No matching windows for selected context</span>
                <span>
                  No windows on desktop "{sourceDesktop.name}" match host "{chosenProfileId || "none"}"
                  and project "{chosenProjectId || "none"}". Adjust the server/project selection above
                  or choose a candidate from this desktop.
                </span>
              </div>
            )}

            {/* Matching Windows List (with Authored Commands and Worktree Display) */}
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-xs text-emerald-400 flex items-center gap-1.5">
                ✓ Matching Windows to Include ({subsetPreview.matchingWindows.length})
              </span>

              {subsetPreview.matchingWindows.length > 0 && (
                <div className="flex flex-col gap-2">
                  {subsetPreview.matchingWindows.map((m: ExtendedMatchingWindowPreview) => {
                    const win = windows[m.windowId];
                    const isTerminal = win?.appId === "terminals";
                    const currentCmd =
                      authoredCommands[m.stepKey] ??
                      (win?.appState?.command as string | undefined) ??
                      "bash";
                    const isConfirmed =
                      confirmedCommandByStep[m.stepKey] === `${m.windowId}:::${currentCmd}`;

                    return (
                      <div
                        key={m.windowId}
                        data-testid={`recipe-matching-win-${m.windowId}`}
                        className="p-2.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs flex items-center gap-1">
                              {isTerminal ? ">_" : "📁"} {m.title}
                            </span>
                            {m.isWorktree && m.worktreeId && (
                              <span
                                data-testid={`recipe-worktree-badge-${m.windowId}`}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-400 font-mono"
                              >
                                Worktree: {m.worktreeId}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                            {m.appId} • {m.stepKey}
                          </span>
                        </div>

                        {/* Explicit Command Authoring & Value-Bound Confirmation for Terminals */}
                        {isTerminal && (
                          <div className="flex flex-col gap-1 pt-1 border-t border-[var(--color-border)]/50">
                            <label className="text-[11px] font-semibold text-[var(--color-text-muted)]">
                              Command to execute on launch (required):
                            </label>
                            <input
                              type="text"
                              data-testid={`recipe-step-command-${m.stepKey}`}
                              value={currentCmd}
                              onChange={(e) => handleCommandChange(m.stepKey, e.target.value)}
                              placeholder="e.g. pnpm dev"
                              className="px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-xs focus:outline-none focus:border-[var(--color-primary)]"
                            />
                            <label className="flex items-center gap-1.5 pt-1 text-[11px] cursor-pointer select-none">
                              <input
                                type="checkbox"
                                data-testid={`recipe-step-confirm-${m.stepKey}`}
                                checked={isConfirmed}
                                onChange={(e) =>
                                  handleConfirmToggle(
                                    m.stepKey,
                                    m.windowId,
                                    currentCmd,
                                    e.target.checked,
                                  )
                                }
                                className="rounded text-[var(--color-primary)]"
                              />
                              <span className="font-medium text-[var(--color-text)]">
                                I explicitly author and confirm this launch command
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Excluded Windows List with Reasons */}
            {subsetPreview.excludedWindows.length > 0 && (
              <div className="flex flex-col gap-2 pt-2 border-t border-[var(--color-border)]">
                <span className="font-semibold text-xs text-amber-400 flex items-center gap-1.5">
                  ⚠ Excluded Windows ({subsetPreview.excludedWindows.length})
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  The following windows on this desktop do not match the chosen target and will not
                  be included:
                </span>

                <div className="flex flex-col gap-1.5">
                  {subsetPreview.excludedWindows.map((ex) => (
                    <div
                      key={ex.windowId}
                      data-testid={`recipe-excluded-win-${ex.windowId}`}
                      className="p-2 rounded border border-amber-500/20 bg-amber-500/5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{ex.title}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                          ({ex.appId})
                        </span>
                      </div>
                      <span className="text-[11px] text-amber-400/90 font-medium">{ex.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clear Architectural Scope Notice (AC8 / F1 Limits) */}
            <div
              data-testid="recipe-ac8-f1-notice"
              className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] flex flex-col gap-0.5"
            >
              <span className="font-semibold text-[var(--color-text)]">
                Capture Specification Notice (AC8 / F1 Limits)
              </span>
              <span>
                Capturing a recipe stores declarative launch definitions for terminal commands and
                application states. It does not provide full live process state restoration, live
                window adoption, or multi-step execution transactional guarantees (AC8 and F1
                limitations apply).
              </span>
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="recipe-save-submit-btn"
                disabled={
                  !subsetPreview.canSave ||
                  !recipeName.trim() ||
                  !chosenProfileId.trim() ||
                  !chosenProjectId.trim() ||
                  !subsetPreview.matchingWindows
                    .filter((m) => windows[m.windowId]?.appId === "terminals")
                    .every((m) => {
                      const win = windows[m.windowId];
                      const cmd =
                        authoredCommands[m.stepKey] ??
                        (win?.appState?.command as string | undefined) ??
                        "bash";
                      return (
                        confirmedCommandByStep[m.stepKey] ===
                        `${m.windowId}:::${cmd}`
                      );
                    })
                }
                onClick={handleSaveSubset}
                className="px-4 py-1.5 rounded bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 font-medium text-xs transition-opacity"
              >
                Confirm & Save Recipe
              </button>
            </div>
          </div>
        )}

        {/* MODE 2: Import Recipe JSON */}
        {mode === "import" && (
          <div className="flex flex-col gap-3 max-w-2xl">
            <span className="font-semibold text-sm">Import Recipe JSON</span>
            <span className="text-[var(--color-text-muted)]">
              Paste portable Recipe JSON below. The imported recipe remains completely inert until
              explicitly reviewed and launched.
            </span>

            {importErrors.length > 0 && (
              <div
                data-testid="recipe-import-errors"
                className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex flex-col gap-1"
              >
                <span className="font-bold">Schema validation errors:</span>
                <ul className="list-disc pl-4">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <textarea
              data-testid="recipe-import-textarea"
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste RecipeV1 JSON..."
              rows={12}
              className="px-3 py-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs focus:outline-none focus:border-[var(--color-primary)] resize-y"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="recipe-import-submit-btn"
                onClick={handleImport}
                className="px-4 py-1.5 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium text-xs"
              >
                Validate & Import
              </button>
            </div>
          </div>
        )}

        {/* MODE 3: Export Recipe JSON */}
        {mode === "export" && exportPreview && (
          <div className="flex flex-col gap-3 max-w-2xl">
            <span className="font-semibold text-sm">Export Recipe JSON</span>

            {/* Security Warning Notice */}
            <div
              data-testid="recipe-export-warning"
              className="p-3 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 flex items-start gap-2"
            >
              <span className="text-base">⚠</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Security Notice</span>
                <span>{exportPreview.warning}</span>
              </div>
            </div>

            <textarea
              readOnly
              data-testid="recipe-export-json-view"
              value={exportPreview.json}
              rows={14}
              className="px-3 py-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs select-all focus:outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
