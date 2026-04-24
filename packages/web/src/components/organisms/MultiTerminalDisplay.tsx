import { useEffect, useRef, useCallback } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { SplitLayout } from "@/components/organisms/SplitLayout.js";
import { useTerminalLayout } from "@/hooks/useTerminalLayout.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

export interface MountedSession {
  sessionId: string;
  project: string;
  command: string;
  cwd?: string;
}

interface Props {
  activeSessionId: string | null;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  onSessionExit?: (sessionId: string) => void;
  onNewTerminal?: () => void;
  onSelectTab?: (sessionId: string) => void;
  onCloseTab?: (sessionId: string) => void;
}

export function MultiTerminalDisplay({
  activeSessionId,
  mountedSessions,
  openTabs,
  onSessionExit,
  onNewTerminal,
  onSelectTab,
  onCloseTab,
}: Props) {
  const layout = useTerminalLayout();
  const prevSessionIdsRef = useRef<Set<string>>(new Set());

  // ── sync new sessions into the focused pane ──────────────────────────────
  useEffect(() => {
    const currentIds = new Set(mountedSessions.map((s) => s.sessionId));
    const newSessions = mountedSessions.filter(
      (s) => !prevSessionIdsRef.current.has(s.sessionId),
    );

    for (const s of newSessions) {
      const targetPaneId = layout.focusedPaneId ?? layout.getFirstPaneId();
      if (targetPaneId) {
        layout.addSessionToPane(targetPaneId, s.sessionId);
      }
    }

    prevSessionIdsRef.current = currentIds;
  }, [mountedSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── prune sessions evicted from mountedSessions ───────────────────────────
  useEffect(() => {
    const liveIds = new Set(mountedSessions.map((s) => s.sessionId));
    layout.pruneSessions(liveIds);
  }, [mountedSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── sync activeSessionId to focused pane ─────────────────────────────────
  useEffect(() => {
    if (!activeSessionId) return;
    const panes = layout.getPanes();
    const pane = panes.find((p) => p.sessionIds.includes(activeSessionId));
    if (pane) {
      layout.setActiveSession(pane.id, activeSessionId);
      layout.setFocusedPaneId(pane.id);
    }
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── called by TerminalPanel after term.open() + registerTerminal() ────────
  // PaneContainer has its own 150ms retry timer so no forced re-render needed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleTerminalReady = useCallback((_: string) => {}, []);

  if (mountedSessions.length === 0 || !activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
        <TerminalIcon className="h-10 w-10 opacity-20" />
        <p className="text-sm">Select a terminal to view output</p>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/*
        Hidden keep-alive container: TerminalPanel instances are mounted here
        so they manage PTY lifecycle. Their terminal elements are reparented
        into the visible PaneContainer divs by PaneContainer's useEffect.
        Rendered FIRST so their useEffects run before PaneContainer's.
      */}
      <div aria-hidden="true" style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", width: 1, height: 1, overflow: "hidden" }}>
        {mountedSessions.map((s) => (
          <TerminalPanel
            key={s.sessionId}
            sessionId={s.sessionId}
            project={s.project}
            command={s.command}
            cwd={s.cwd}
            onExit={() => onSessionExit?.(s.sessionId)}
            onNewTerminal={onNewTerminal}
            onTerminalReady={handleTerminalReady}
          />
        ))}
      </div>

      {/* Visible split layout */}
      <SplitLayout
        root={layout.root}
        layout={layout}
        mountedSessions={mountedSessions}
        openTabs={openTabs}
        onNewTerminal={onNewTerminal ?? (() => {})}
        onSessionExit={onSessionExit ?? (() => {})}
        onSelectTab={onSelectTab ?? (() => {})}
        onCloseTab={onCloseTab ?? (() => {})}
      />
    </div>
  );
}
