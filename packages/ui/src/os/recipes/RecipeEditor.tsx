import {
  useState,
  useMemo,
  type ReactElement,
} from "react";
import type { OsDesktop, OsWindow } from "../types.js";
import type {
  MatchingWindowPreview,
  RecipeStepKey,
  RecipeTerminalStep,
  RecipeV1,
  SaveSubsetPreview,
} from "./types.js";
import {
  buildRecipeFromDesktopSubset,
  calculateSaveSubset,
} from "./recipe-engine.js";
import {
  exportRecipeJson,
  importRecipeJson,
  RECIPE_EXPORT_WARNING,
  validateRecipeV1,
} from "./schema.js";
import { saveRecipe } from "./persistence.js";
import { generateUUID } from "@/lib/utils.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkspaceStore } from "@/stores/workspace.js";

export interface RecipeEditorProps {
  desktop: OsDesktop;
  windows: Record<string, OsWindow>;
  initialRecipe?: RecipeV1;
  initialMode?: "save-subset" | "import" | "export";
  onSaved: (recipe: RecipeV1) => void;
  onCancel: () => void;
}

export function RecipeEditor({
  desktop,
  windows,
  initialRecipe,
  initialMode,
  onSaved,
  onCancel,
}: RecipeEditorProps): ReactElement {
  const currentProfile = useServerProfile();
  const activeProject = useWorkspaceStore((state) => state.activeProject);

  const [mode, setMode] = useState<"save-subset" | "import" | "export">(
    initialMode ?? (initialRecipe ? "export" : "save-subset"),
  );

  // Subset form state
  const [chosenProfileId, setChosenProfileId] = useState<string>(
    initialRecipe?.profileId ?? desktop.defaultCtx?.profileId ?? currentProfile?.id ?? "default",
  );
  const [chosenProjectId, setChosenProjectId] = useState<string>(
    initialRecipe?.project ?? desktop.defaultCtx?.projectId ?? activeProject ?? "",
  );
  const [recipeName, setRecipeName] = useState<string>(
    initialRecipe?.name ?? `${desktop.name} Recipe`,
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

  // Explicit confirmation per terminal step command
  const [confirmedCommands, setConfirmedCommands] = useState<Record<RecipeStepKey, boolean>>(() => {
    const init: Record<RecipeStepKey, boolean> = {};
    if (initialRecipe) {
      for (const s of initialRecipe.terminalSteps) {
        init[s.key] = true;
      }
    }
    return init;
  });

  // Import / Export state
  const [importJsonText, setImportJsonText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Save Subset calculation preview
  const subsetPreview: SaveSubsetPreview = useMemo(() => {
    return calculateSaveSubset({
      desktop,
      windows,
      chosenProfileId,
      chosenProjectId,
    });
  }, [desktop, windows, chosenProfileId, chosenProjectId]);

  // Export JSON preview
  const exportPreview = useMemo(() => {
    if (!initialRecipe) return null;
    return exportRecipeJson(initialRecipe);
  }, [initialRecipe]);

  const handleCommandChange = (stepKey: RecipeStepKey, val: string) => {
    setAuthoredCommands((prev) => ({ ...prev, [stepKey]: val }));
  };

  const handleSaveSubset = () => {
    setSaveError(null);
    try {
      if (!recipeName.trim()) {
        setSaveError("Recipe name cannot be empty");
        return;
      }
      if (!chosenProjectId.trim()) {
        setSaveError("Target project cannot be empty");
        return;
      }

      const recipeId = initialRecipe?.id ?? `recipe-${generateUUID().slice(0, 8)}`;
      const { recipe } = buildRecipeFromDesktopSubset({
        recipeId,
        name: recipeName.trim(),
        description: recipeDesc.trim() || undefined,
        desktop,
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

        {/* MODE 1: Save Desktop Subset */}
        {mode === "save-subset" && (
          <div className="flex flex-col gap-4 max-w-3xl">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-sm">
                Save Desktop Windows as Reusable Recipe
              </span>
              <span className="text-[var(--color-text-muted)]">
                Choose the target host and project. Only windows belonging to this project will be
                saved. Excluded nonmatching windows are listed below with reasons. Source desktop
                remains unchanged.
              </span>
            </div>

            {/* Target Selectors */}
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Target Host Profile:
                </label>
                <input
                  type="text"
                  data-testid="recipe-target-profile"
                  value={chosenProfileId}
                  onChange={(e) => setChosenProfileId(e.target.value)}
                  className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs focus:outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-xs text-[var(--color-text-muted)]">
                  Target Project:
                </label>
                <input
                  type="text"
                  data-testid="recipe-target-project"
                  value={chosenProjectId}
                  onChange={(e) => setChosenProjectId(e.target.value)}
                  placeholder="e.g. dam-hopper"
                  className="px-2.5 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs focus:outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              <div className="flex flex-col gap-1 col-span-2">
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

              <div className="flex flex-col gap-1 col-span-2">
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

            {/* Matching Windows List (with Authored Commands) */}
            <div className="flex flex-col gap-2">
              <span className="font-semibold text-xs text-emerald-400 flex items-center gap-1.5">
                ✓ Matching Windows to Include ({subsetPreview.matchingWindows.length})
              </span>

              {subsetPreview.matchingWindows.length === 0 ? (
                <div
                  data-testid="recipe-no-matching-warning"
                  className="p-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs"
                >
                  No windows on this desktop match host "{chosenProfileId}" and project "
                  {chosenProjectId}". Adjust the target host/project above or move windows to this
                  desktop.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {subsetPreview.matchingWindows.map((m: MatchingWindowPreview) => {
                    const win = windows[m.windowId];
                    const isTerminal = win?.appId === "terminals";
                    return (
                      <div
                        key={m.windowId}
                        data-testid={`recipe-matching-win-${m.windowId}`}
                        className="p-2.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs flex items-center gap-1">
                            {isTerminal ? ">_" : "📁"} {m.title}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                            {m.appId} • {m.stepKey}
                          </span>
                        </div>

                        {/* Explicit Command Authoring for Terminals */}
                        {isTerminal && (
                          <div className="flex flex-col gap-1 pt-1 border-t border-[var(--color-border)]/50">
                            <label className="text-[11px] font-semibold text-[var(--color-text-muted)]">
                              Command to execute on launch (required):
                            </label>
                            <input
                              type="text"
                              data-testid={`recipe-step-command-${m.stepKey}`}
                              value={
                                authoredCommands[m.stepKey] ??
                                (win?.appState?.command as string | undefined) ??
                                "bash"
                              }
                              onChange={(e) => handleCommandChange(m.stepKey, e.target.value)}
                              placeholder="e.g. pnpm dev"
                              className="px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-xs focus:outline-none focus:border-[var(--color-primary)]"
                            />
                            <label className="flex items-center gap-1.5 pt-1 text-[11px] cursor-pointer select-none">
                              <input
                                type="checkbox"
                                data-testid={`recipe-step-confirm-${m.stepKey}`}
                                checked={Boolean(confirmedCommands[m.stepKey])}
                                onChange={(e) =>
                                  setConfirmedCommands((prev) => ({
                                    ...prev,
                                    [m.stepKey]: e.target.checked,
                                  }))
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
                  !subsetPreview.matchingWindows
                    .filter((m) => windows[m.windowId]?.appId === "terminals")
                    .every((m) => Boolean(confirmedCommands[m.stepKey]))
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

            {/* Warning Banner */}
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
