import { useState, useCallback, useMemo } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { TerminalTreeView } from "@/components/organisms/TerminalTreeView.js";
import { ProjectInfoPanel } from "@/components/organisms/ProjectInfoPanel.js";
import { TerminalTabBar } from "@/components/organisms/TerminalTabBar.js";
import { MultiTerminalDisplay, type MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { useTerminalTree } from "@/hooks/useTerminalTree.js";
import { useTerminalSessions } from "@/api/queries.js";
import type { TreeCommand } from "@/hooks/useTerminalTree.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { SessionInfo } from "@/types/electron.js";

/**
 * Maximum terminals kept mounted in DOM simultaneously.
 * Balances memory usage (xterm.js instances) vs. instant switching UX.
 */
const MAX_MOUNTED = 5;

type SelectionState =
  | { type: "project"; name: string }
  | { type: "terminal"; sessionId: string }
  | null;

/** State for the inline "+ Shell" prompt form. */
interface ShellPromptState {
  projectName: string;
  command: string;
}

export function TerminalsPage() {
  const qc = useQueryClient();
  const { tree, isLoading } = useTerminalTree();
  const { data: sessions = [] } = useTerminalSessions();

  const [selection, setSelection] = useState<SelectionState>(null);
  const [openTabs, setOpenTabs] = useState<TabEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [mountedSessions, setMountedSessions] = useState<MountedSession[]>([]);
  const [shellPrompt, setShellPrompt] = useState<ShellPromptState | null>(null);

  // Memoize session map to avoid stale closures and unnecessary re-computation
  const sessionMap = useMemo(
    () => new Map<string, SessionInfo>(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  /** Ensure a terminal session is open in a tab and activated. */
  function openTerminalTab(sessionId: string, project: string, command: string) {
    setOpenTabs((prev) => {
      if (prev.some((t) => t.sessionId === sessionId)) return prev;
      return [
        ...prev,
        {
          sessionId,
          label: `${project}:${sessionId.split(":")[0] ?? sessionId}`,
          session: sessionMap.get(sessionId),
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
    setShellPrompt(null);
    setSelection({ type: "project", name });
  }

  function handleSelectTerminal(sessionId: string) {
    // Allow selecting both alive and dead sessions (dead sessions stay for 60s)
    for (const project of tree) {
      const cmd = project.commands.find((c) => c.sessionId === sessionId);
      if (cmd) {
        openTerminalTab(sessionId, project.name, cmd.command);
        return;
      }
    }
  }

  function handleLaunchTerminal(projectName: string, cmd: TreeCommand) {
    window.devhub.terminal
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

  function handleKillTerminal(sessionId: string) {
    window.devhub.terminal.kill(sessionId);
    void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
  }

  function handleAddShell(projectName: string) {
    setShellPrompt({ projectName, command: "" });
    setSelection({ type: "project", name: projectName });
  }

  function handleShellSubmit() {
    if (!shellPrompt) return;
    const { projectName, command } = shellPrompt;
    // Use the user-provided command, or the platform's default shell
    const resolvedCommand =
      command.trim() || (window.devhub.platform === "win32" ? "cmd.exe" : "bash");
    const sessionId = `shell:${projectName}:${Date.now()}`;

    setShellPrompt(null);

    window.devhub.terminal
      .create({
        id: sessionId,
        project: projectName,
        command: resolvedCommand,
        cols: 120,
        rows: 30,
      })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        openTerminalTab(sessionId, projectName, resolvedCommand);

        // Auto-save to config using timestamp-based key to avoid duplicates
        const commandKey = `shell-${Date.now()}`;
        void window.devhub.config
          .updateProject(projectName, {
            commands: { [commandKey]: resolvedCommand },
          })
          .then(() => {
            void qc.invalidateQueries({ queryKey: ["projects"] });
          });
      })
      .catch((err: unknown) => {
        console.error("[TerminalsPage] failed to create shell", err);
      });
  }

  function handleSelectTab(sessionId: string) {
    setActiveTab(sessionId);
    setSelection({ type: "terminal", sessionId });

    setMountedSessions((prev) => {
      const existing = prev.find((s) => s.sessionId === sessionId);
      if (existing) {
        return [existing, ...prev.filter((s) => s.sessionId !== sessionId)];
      }
      for (const project of tree) {
        const cmd = project.commands.find((c) => c.sessionId === sessionId);
        if (cmd) {
          const next = [{ sessionId, project: project.name, command: cmd.command }, ...prev];
          return next.length > MAX_MOUNTED ? next.slice(0, MAX_MOUNTED) : next;
        }
      }
      return prev;
    });
  }

  function handleCloseTab(sessionId: string) {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      // If closing the active tab, activate the last remaining tab
      if (activeTab === sessionId) {
        setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null);
      }
      return remaining;
    });
    setMountedSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }

  const handleSessionExit = useCallback(
    (sessionId: string) => {
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      // Refresh tab's session metadata from the latest session map
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

  // Keep tab session info up-to-date with polling data
  const tabsWithLiveSession: TabEntry[] = openTabs.map((t) => ({
    ...t,
    session: sessionMap.get(t.sessionId) ?? t.session,
  }));

  const selectedId =
    selection?.type === "project"
      ? `project:${selection.name}`
      : selection?.type === "terminal"
        ? `terminal:${selection.sessionId}`
        : null;

  return (
    <div className="flex h-screen bg-[var(--color-background)]">
      <Sidebar />

      {/* Tree sidebar */}
      <div className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <h2 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Projects
          </h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          </div>
        ) : (
          <TerminalTreeView
            projects={tree}
            selectedId={selectedId}
            onSelectProject={handleSelectProject}
            onSelectTerminal={handleSelectTerminal}
            onLaunchTerminal={handleLaunchTerminal}
            onKillTerminal={handleKillTerminal}
            onAddShell={handleAddShell}
          />
        )}
      </div>

      {/* Right panel — context-switching */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Inline shell prompt overlay */}
        {shellPrompt && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--color-text)] mb-2">
              New shell in <span className="text-[var(--color-primary)]">{shellPrompt.projectName}</span>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Command (blank for bash)"
                value={shellPrompt.command}
                onChange={(e) => setShellPrompt((p) => p ? { ...p, command: e.target.value } : p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleShellSubmit();
                  if (e.key === "Escape") setShellPrompt(null);
                }}
                className={inputClass + " flex-1"}
              />
              <Button size="sm" variant="primary" onClick={handleShellSubmit}>
                Launch
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShellPrompt(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {selection?.type === "project" ? (
          <ProjectInfoPanel
            projectName={selection.name}
            onLaunchCommand={(cmd) => {
              if (selection.type === "project") {
                handleLaunchTerminal(selection.name, cmd);
              }
            }}
          />
        ) : selection?.type === "terminal" ? (
          <>
            <TerminalTabBar
              tabs={tabsWithLiveSession}
              activeTab={activeTab}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
            />
            <div className="flex-1 min-h-0">
              <MultiTerminalDisplay
                activeSessionId={activeTab}
                mountedSessions={mountedSessions}
                onSessionExit={handleSessionExit}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-muted)]">
            <TerminalIcon className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a project or terminal from the tree</p>
          </div>
        )}
      </div>
    </div>
  );
}
