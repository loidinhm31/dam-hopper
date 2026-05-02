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

  // ── sync new sessions into the split layout ──────────────────────────────
  useEffect(() => {
    const currentIds = new Set(mountedSessions.map((s) => s.sessionId));
    const newSessions = mountedSessions.filter(
      (s) => !prevSessionIdsRef.current.has(s.sessionId),
    );

    for (const s of newSessions) {
      const targetPaneId = layout.focusedPaneId ?? layout.getFirstPaneId();
      if (targetPaneId) {
        const pane = layout.getPaneById(targetPaneId);
        if (pane && !pane.sessionIds.includes(s.sessionId)) {
          layout.addSessionToPane(targetPaneId, s.sessionId);
        }
      }
    }

    prevSessionIdsRef.current = currentIds;
    
    // Prune sessions evicted from mountedSessions
    layout.pruneSessions(currentIds);
  }, [mountedSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── sync activeSessionId to the correct pane ─────────────────────────────
  // Depends on layout.root so it re-runs when addSessionToPane's state update settles
  useEffect(() => {
    if (!activeSessionId) return;
    const panes = layout.getPanes();
    const pane = panes.find((p) => p.sessionIds.includes(activeSessionId));
    if (pane) {
      layout.setActiveSession(pane.id, activeSessionId);
      layout.setFocusedPaneId(pane.id);
    }
  }, [activeSessionId, layout.root]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div 
        aria-hidden="true" 
        style={{ 
          position: "absolute", 
          visibility: "hidden", 
          pointerEvents: "none", 
          width: 1024, 
          height: 768, 
          overflow: "hidden",
          top: -10000, // Move far off-screen instead of just 1x1
          left: -10000 
        }}
      >
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
