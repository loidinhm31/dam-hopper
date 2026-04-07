import { useState, useCallback, useMemo, useEffect } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { TerminalTreeView } from "@/components/organisms/TerminalTreeView.js";
import { ProjectInfoPanel } from "@/components/organisms/ProjectInfoPanel.js";
import { TerminalTabBar } from "@/components/organisms/TerminalTabBar.js";
import { MultiTerminalDisplay, type MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { useTerminalTree } from "@/hooks/useTerminalTree.js";
import { useTerminalSessions, useProjects } from "@/api/queries.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";
import { useResizeHandle } from "@/hooks/useResizeHandle.js";
import { FREE_TERMINAL_PREFIX } from "@/hooks/useTerminalTree.js";
import type { TreeCommand, TreeProject } from "@/hooks/useTerminalTree.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { SessionInfo } from "@/api/client.js";
import { api } from "@/api/client.js";
import { generateUUID } from "@/lib/utils.js";

/**
 * Maximum terminals kept mounted in DOM simultaneously.
 * Balances memory usage (xterm.js instances) vs. instant switching UX.
 */
const MAX_MOUNTED = 5;

type SelectionState =
  | { type: "project"; name: string }
  | { type: "terminal"; sessionId: string }
  | null;

/** State for the inline "New Terminal" launch form. */
interface LaunchFormState {
  projectName: string;
  cwd: string;
  command: string;
}

/** State for the inline "Save as profile" prompt on a tab. */
interface SavePromptState {
  sessionId: string;
  name: string;
  error?: string;
}

/** State for the inline "Save free terminal to project" prompt. */
interface FreeTerminalSavePromptState {
  sessionId: string;
  projectName: string;
  name: string;
  error?: string;
}

/** Chars that would corrupt the session ID prefix (segment separator is `:`) */
const INVALID_PROFILE_NAME_RE = /[:]/;

/** Validate profile name and return an error string or null. */
function validateProfileName(name: string, existing: string[]): string | null {
  if (!name.trim()) return "Name is required";
  if (INVALID_PROFILE_NAME_RE.test(name)) return "Name must not contain ':'";
  if (existing.includes(name.trim())) return "A profile with this name already exists";
  return null;
}

/** Find session metadata (project name + command) by scanning the tree. */
function findSessionMeta(
  sessionId: string,
  tree: TreeProject[],
  sessionMap: Map<string, SessionInfo>,
): { project: string; command: string } | null {
  for (const project of tree) {
    for (const cmd of project.commands) {
      if (cmd.type === "terminal") {
        const match = cmd.sessions?.find((s) => s.id === sessionId);
        if (match) return { project: project.name, command: cmd.command };
      } else if (cmd.sessionId === sessionId) {
        return { project: project.name, command: cmd.command };
      }
    }
  }
  const s = sessionMap.get(sessionId);
  return s ? { project: s.project ?? "", command: s.command } : null;
}

export function TerminalsPage() {
  const qc = useQueryClient();
  const { tree, freeTerminals, isLoading } = useTerminalTree();
  const { data: sessions = [] } = useTerminalSessions();
  const { data: projects = [] } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  const { collapsed: sidebarCollapsed, toggle: handleSidebarToggle } = useSidebarCollapse();
  const { width: treeWidth, handleProps: resizeHandleProps, isDragging } = useResizeHandle({
    min: 160,
    max: 400,
    defaultWidth: 224,
    storageKey: "devhub:tree-width",
  });

  const [selection, setSelection] = useState<SelectionState>(null);
  const [openTabs, setOpenTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mountedSessions, setMountedSessions] = useState<MountedSession[]>([]);
  const [launchForm, setLaunchForm] = useState<LaunchFormState | null>(null);
  const [savePrompt, setSavePrompt] = useState<SavePromptState | null>(null);
  const [freeTerminalSavePrompt, setFreeTerminalSavePrompt] = useState<FreeTerminalSavePromptState | null>(null);

  const sessionMap = useMemo(
    () => new Map<string, SessionInfo>(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  /** Maps free terminal session ID → 1-based display index for O(1) label lookups. */
  const freeTerminalIndexMap = useMemo(
    () => new Map(freeTerminals.map((s, i) => [s.id, i + 1])),
    [freeTerminals],
  );

  /** Set of session IDs that are already instances of a saved profile. */
  const profileSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const project of tree) {
      for (const cmd of project.commands) {
        if (cmd.type === "terminal") {
          for (const s of cmd.sessions ?? []) ids.add(s.id);
        }
      }
    }
    return ids;
  }, [tree]);

  // Action: create a new free terminal when ?action=new-terminal is in URL
  useEffect(() => {
    if (searchParams.get("action") !== "new-terminal") return;
    setSearchParams({}, { replace: true });
    handleAddFreeTerminal();
  // handleAddFreeTerminal closes over stable refs; qc and searchParams are in deps via the outer scope
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Deep-link: open a specific session tab when ?session= param is present
  useEffect(() => {
    const sessionParam = searchParams.get("session");
    if (!sessionParam || sessions.length === 0) return;

    const meta = findSessionMeta(sessionParam, tree, sessionMap);
    if (meta) {
      openTerminalTab(sessionParam, meta.project, meta.command);
    }

    setSearchParams({}, { replace: true });
  // openTerminalTab and findSessionMeta are function declarations (hoisted) that
  // close over sessionMap/profileSessionIds — both derived from sessions which IS
  // in deps, so values are always fresh when this effect runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sessions, tree]);

  /** Derive a human-readable tab label from a session ID and project name. */
  function tabLabel(sessionId: string, project: string, command: string): string {
    const parts = sessionId.split(":");
    const type = parts[0] ?? sessionId;
    if (type === "free") {
      const n = freeTerminalIndexMap.get(sessionId);
      return `Terminal ${n ?? "?"}`;
    }
    if (type === "terminal") {
      const profile = parts[2];
      if (profile && profile !== "_") return `${project}:${profile.replace(/_/g, " ")}`;
      // ad-hoc: show command basename
      const cmdBase = command.split(/[\s/\\]/).find(Boolean) ?? command;
      return `${project}:${cmdBase}`;
    }
    return `${project}:${type}`;
  }

  /** Ensure a terminal session is open in a tab and activated. */
  function openTerminalTab(sessionId: string, project: string, command: string) {
    const isAdHoc = !profileSessionIds.has(sessionId) &&
      sessionId.startsWith("terminal:") &&
      sessionId.split(":")[2] === "_";

    setOpenTabs((prev) => {
      if (prev.some((t) => t.sessionId === sessionId)) return prev;
      return [
        ...prev,
        {
          sessionId,
          label: tabLabel(sessionId, project, command),
          session: sessionMap.get(sessionId),
          isSaveable: isAdHoc,
        },
      ];
    });

    setMountedSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return [existing, ...prev.filter((s) => s.sessionId !== sessionId)];
      }
      const next = [{ sessionId, project, command }, ...prev];
      return next.length > MAX_MOUNTED ? next.slice(0, MAX_MOUNTED) : next;
    });

    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });
  }

  function handleSelectProject(name: string) {
    setLaunchForm(null);
    setSelection({ type: "project", name });
  }

  function handleSelectTerminal(sessionId: string) {
    const meta = findSessionMeta(sessionId, tree, sessionMap);
    if (meta) {
      openTerminalTab(sessionId, meta.project, meta.command);
    }
  }

  function handleLaunchTerminal(projectName: string, cmd: TreeCommand) {
    api.terminal
      .create({
        id: cmd.sessionId,
        project: projectName,
        command: cmd.command,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(cmd.sessionId, projectName, cmd.command);
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to create terminal", err);
      });
  }

  /** Launch a new instance from a saved terminal profile. */
  function handleLaunchProfile(projectName: string, cmd: TreeCommand) {
    const sanitizedName = (cmd.profileName ?? "terminal").replace(/ /g, "_");
    const sessionId = `terminal:${projectName}:${sanitizedName}:${Date.now()}`;

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: cmd.command,
        cwd: cmd.cwd,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, cmd.command);
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to launch profile instance", err);
      });
  }

  /** Launch from the inline form (project + path + command). */
  function handleLaunchFormSubmit() {
    if (!launchForm) return;
    const { projectName, cwd, command } = launchForm;
    const platform = (window as { devhub?: { platform?: string } }).devhub?.platform;
    const resolvedCommand =
      command.trim() || (platform === "win32" ? "cmd.exe" : "bash");
    const resolvedCwd = cwd.trim() || undefined;
    // "_" segment marks this as an ad-hoc (unsaved) terminal — enables Save button
    const sessionId = `terminal:${projectName}:_:${Date.now()}`;

    setLaunchForm(null);

    api.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: resolvedCommand,
        cwd: resolvedCwd,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, resolvedCommand);
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to launch terminal", err);
      });
  }

  /** Delete a saved terminal profile from project config and kill/close its live instances. */
  function handleDeleteProfile(projectName: string, profileName: string) {
    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

    const sanitizedName = profileName.replace(/ /g, "_");
    const prefix = `terminal:${projectName}:${sanitizedName}:`;
    const instanceIds = sessions.filter((s) => s.id.startsWith(prefix)).map((s) => s.id);

    // Kill live instances
    for (const id of instanceIds) {
      const s = sessionMap.get(id);
      if (s?.alive) void api.terminal.kill(id);
    }

    // Close tabs for all instances (alive or dead)
    if (instanceIds.length > 0) {
      setOpenTabs((prev) => {
        const remaining = prev.filter((t) => !instanceIds.includes(t.sessionId));
        if (activeTab && instanceIds.includes(activeTab)) {
          setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null);
        }
        return remaining;
      });
      setMountedSessions((prev) => prev.filter((s) => !instanceIds.includes(s.sessionId)));
    }

    const updated = (project.terminals ?? []).filter((t) => t.name !== profileName);
    void api.config
      .updateProject(projectName, { terminals: updated })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      });
  }

  /** Save a running terminal session as a named profile. */
  function handleSaveProfile() {
    if (!savePrompt) return;
    const { sessionId, name } = savePrompt;

    const session = sessionMap.get(sessionId);
    if (!session) return;

    // Free terminals have no project — cannot be saved as profiles.
    if (!session.project) return;

    const project = projects.find((p) => p.name === session.project);
    if (!project) return;

    const existingNames = (project.terminals ?? []).map((t) => t.name);
    const error = validateProfileName(name, existingNames);
    if (error) {
      setSavePrompt((p) => p ? { ...p, error } : p);
      return;
    }

    const newProfile = {
      name: name.trim(),
      command: session.command,
      cwd: session.cwd || ".",
    };

    setSavePrompt(null);

    void api.config
      .updateProject(session.project ?? "", {
        terminals: [...(project.terminals ?? []), newProfile],
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["config"] });
      });
  }

  function handleAddFreeTerminal() {
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({ id: sessionId, command: "", cols: 120, rows: 30 })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, "", "");
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to create free terminal", err);
      });
  }

  function handleLaunchFreeWithCommand(command: string) {
    const sessionId = `${FREE_TERMINAL_PREFIX}${generateUUID()}`;
    api.terminal
      .create({ id: sessionId, command, cols: 120, rows: 30 })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, "", command);
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to create free terminal", err);
      });
  }

  function handleLaunchSuggestedCommand(projectName: string, command: string) {
    const sessionId = `terminal:${projectName}:_:${Date.now()}`;
    api.terminal
      .create({ id: sessionId, project: projectName, command, cols: 120, rows: 30 })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, command);
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to create suggested terminal", err);
      });
  }

  function handleAddShell(projectName: string) {
    setLaunchForm({ projectName, cwd: "", command: "" });
    setSelection({ type: "project", name: projectName });
  }

  function handleSelectTab(sessionId: string) {
    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });

    setMountedSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return [existing, ...prev.filter((s) => s.sessionId !== sessionId)];
      }
      const meta = findSessionMeta(sessionId, tree, sessionMap);
      if (meta) {
        const next = [{ sessionId, project: meta.project, command: meta.command }, ...prev];
        return next.length > MAX_MOUNTED ? next.slice(0, MAX_MOUNTED) : next;
      }
      return prev;
    });
  }

  function handleCloseTab(sessionId: string) {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      if (activeTab === sessionId) {
        setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null);
      }
      return remaining;
    });
    setMountedSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }

  function handleKillTerminal(sessionId: string) {
    void api.terminal.kill(sessionId);
    void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  function handleRemoveFreeTerminal(sessionId: string) {
    void api.terminal.remove(sessionId).then(() => {
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
    });
    // Close tab immediately (optimistic)
    handleCloseTab(sessionId);
  }

  function handleOpenFreeTerminalSavePrompt(sessionId: string) {
    if (projects.length === 0) return;
    setFreeTerminalSavePrompt({
      sessionId,
      projectName: projects[0].name,
      name: "",
    });
  }

  function handleSaveFreeTerminalToProject() {
    if (!freeTerminalSavePrompt) return;
    const { sessionId, projectName, name } = freeTerminalSavePrompt;

    const session = sessionMap.get(sessionId);
    if (!session?.command) return;

    const project = projects.find((p) => p.name === projectName);
    if (!project) return;

    const existingNames = (project.terminals ?? []).map((t) => t.name);
    const error = validateProfileName(name, existingNames);
    if (error) {
      setFreeTerminalSavePrompt((p) => p ? { ...p, error } : p);
      return;
    }

    const newProfile = {
      name: name.trim(),
      command: session.command,
      cwd: session.cwd || ".",
    };

    setFreeTerminalSavePrompt(null);

    void api.config
      .updateProject(projectName, {
        terminals: [...(project.terminals ?? []), newProfile],
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["config"] });
      });
  }

  const handleSessionExit = useCallback(
    (sessionId: string) => {
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId
            ? { ...t, session: sessionMap.get(sessionId) }
            : t,
        ),
      );
    },
    [qc, sessionMap],
  );

  // Keep tab session info up-to-date with polling data.
  // Re-derive isSaveable from current profileSessionIds so the Save button
  // disappears after the user successfully saves the profile.
  const tabsWithLiveSession: TabEntry[] = openTabs.map((t) => {
    const isAdHoc =
      !profileSessionIds.has(t.sessionId) &&
      t.sessionId.startsWith("terminal:") &&
      t.sessionId.split(":")[2] === "_";
    const label = t.sessionId.startsWith(FREE_TERMINAL_PREFIX)
      ? tabLabel(t.sessionId, "", "")
      : t.label;
    return {
      ...t,
      label,
      session: sessionMap.get(t.sessionId) ?? t.session,
      isSaveable: isAdHoc,
    };
  });

  const selectedId =
    selection?.type === "project"
      ? `project:${selection.name}`
      : selection?.type === "terminal"
        ? `terminal:${selection.sessionId}`
        : null;

  return (
    <div className={`flex h-screen bg-[var(--color-background)]${isDragging ? " select-none" : ""}`}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={handleSidebarToggle} />

      {/* Tree sidebar */}
      <div style={{ width: treeWidth }} className="shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          </div>
        ) : (
          <TerminalTreeView
            projects={tree}
            freeTerminals={freeTerminals}
            selectedId={selectedId}
            onSelectProject={handleSelectProject}
            onSelectTerminal={handleSelectTerminal}
            onLaunchTerminal={handleLaunchTerminal}
            onKillTerminal={handleKillTerminal}
            onAddShell={handleAddShell}
            onLaunchProfile={handleLaunchProfile}
            onDeleteProfile={handleDeleteProfile}
            onLaunchSuggestedCommand={handleLaunchSuggestedCommand}
            onAddFreeTerminal={handleAddFreeTerminal}
            onLaunchFreeWithCommand={handleLaunchFreeWithCommand}
            onSelectFreeTerminal={handleSelectTerminal}
            onKillFreeTerminal={handleKillTerminal}
            onRemoveFreeTerminal={handleRemoveFreeTerminal}
            onSaveFreeTerminal={handleOpenFreeTerminalSavePrompt}
          />
        )}
      </div>

      {/* Resize handle */}
      <div
        {...resizeHandleProps}
        className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Right panel — context-switching */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Inline save free terminal to project prompt */}
        {freeTerminalSavePrompt && projects.length > 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--color-text)] mb-2">
              Save terminal as profile in project
            </p>
            <div className="flex gap-2 flex-wrap">
              <select
                value={freeTerminalSavePrompt.projectName}
                onChange={(e) =>
                  setFreeTerminalSavePrompt((p) => p ? { ...p, projectName: e.target.value, error: undefined } : p)
                }
                className={inputClass + " flex-1 min-w-32"}
              >
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <div className="flex-1 min-w-32">
                <input
                  type="text"
                  autoFocus
                  placeholder="Profile name"
                  value={freeTerminalSavePrompt.name}
                  onChange={(e) =>
                    setFreeTerminalSavePrompt((p) => p ? { ...p, name: e.target.value, error: undefined } : p)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveFreeTerminalToProject();
                    if (e.key === "Escape") setFreeTerminalSavePrompt(null);
                  }}
                  className={inputClass + " w-full" + (freeTerminalSavePrompt.error ? " border-[var(--color-danger)]" : "")}
                />
                {freeTerminalSavePrompt.error && (
                  <p className="text-[10px] text-[var(--color-danger)] mt-0.5">{freeTerminalSavePrompt.error}</p>
                )}
              </div>
              <Button size="sm" variant="primary" onClick={handleSaveFreeTerminalToProject}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFreeTerminalSavePrompt(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Inline launch form overlay */}
        {launchForm && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--color-text)] mb-2">
              New terminal in <span className="text-[var(--color-primary)]">{launchForm.projectName}</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                autoFocus
                placeholder="Path (relative to project root)"
                value={launchForm.cwd}
                onChange={(e) => setLaunchForm((f) => f ? { ...f, cwd: e.target.value } : f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLaunchFormSubmit();
                  if (e.key === "Escape") setLaunchForm(null);
                }}
                className={inputClass + " flex-1 min-w-32"}
              />
              <input
                type="text"
                placeholder="Command (blank for bash)"
                value={launchForm.command}
                onChange={(e) => setLaunchForm((f) => f ? { ...f, command: e.target.value } : f)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLaunchFormSubmit();
                  if (e.key === "Escape") setLaunchForm(null);
                }}
                className={inputClass + " flex-1 min-w-32"}
              />
              <Button size="sm" variant="primary" onClick={handleLaunchFormSubmit}>
                Launch
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLaunchForm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Tab bar is always visible when there are open tabs */}
        {openTabs.length > 0 && (
          <TerminalTabBar
            tabs={tabsWithLiveSession}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            savePrompt={savePrompt}
            onSaveTab={(sessionId) => setSavePrompt({ sessionId, name: "" })}
            onSavePromptChange={(name) =>
              setSavePrompt((p) => p ? { ...p, name, error: undefined } : p)
            }
            onSavePromptSubmit={handleSaveProfile}
            onSavePromptCancel={() => setSavePrompt(null)}
          />
        )}

        <div className="flex-1 min-h-0">
          {selection?.type === "project" ? (
            <ProjectInfoPanel
              projectName={selection.name}
              onLaunchCommand={(cmd) => {
                if (selection.type === "project") {
                  handleLaunchTerminal(selection.name, cmd);
                }
              }}
            />
          ) : mountedSessions.length > 0 ? (
            <MultiTerminalDisplay
              activeSessionId={activeTab}
              mountedSessions={mountedSessions}
              onSessionExit={handleSessionExit}
              onNewTerminal={handleAddFreeTerminal}
            />
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-text-muted)]">
              <TerminalIcon className="h-12 w-12 opacity-20" />
              <div className="text-center">
                <p className="text-sm mb-1">No projects configured</p>
                <p className="text-xs opacity-60">Open a free terminal to get started</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleAddFreeTerminal}>
                  Open Terminal
                </Button>
                <kbd className="text-[10px] text-[var(--color-text-muted)]/50 font-mono">Ctrl+`</kbd>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-muted)]">
              <TerminalIcon className="h-10 w-10 opacity-20" />
              <p className="text-sm">Select a project or terminal from the tree</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
