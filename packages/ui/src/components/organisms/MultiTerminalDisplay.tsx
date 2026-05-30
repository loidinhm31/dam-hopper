import { useEffect, useRef, useCallback } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { SplitLayout } from "@/components/organisms/SplitLayout.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalLayout } from "@/hooks/use-terminal-layout.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
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
  layoutRevision?: number;
}

export function MultiTerminalDisplay({
  activeSessionId,
  mountedSessions,
  openTabs,
  onSessionExit,
  onNewTerminal,
  onSelectTab,
  onCloseTab,
  layoutRevision = 0,
}: Props) {
  const layout = useTerminalLayout();
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const showMobileAccessoryBar =
    isCompactWorkspace && isCoarsePointer && !!activeSessionId;
  const suppressTerminalFocus =
    showMobileAccessoryBar && mobileCustomKeyboardEnabled;

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

  // Mode switches and Fleet rail resize-end events change the pane host size
  // outside SplitLayout's drag/drop path, so refit registered terminals once.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const [, entry] of terminalRegistry) {
        try {
          entry.fitAddon.fit();
        } catch {
          /* terminal may be disposed */
        }
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [layoutRevision]);

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
          left: -10000,
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
            suppressAutoFocus={suppressTerminalFocus}
          />
        ))}
      </div>

      {/* Visible split layout */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SplitLayout
          root={layout.root}
          layout={layout}
          mountedSessions={mountedSessions}
          openTabs={openTabs}
          onNewTerminal={onNewTerminal ?? (() => {})}
          onSessionExit={onSessionExit ?? (() => {})}
          onSelectTab={onSelectTab ?? (() => {})}
          onCloseTab={onCloseTab ?? (() => {})}
          suppressTerminalFocus={suppressTerminalFocus}
        />
      </div>
      {showMobileAccessoryBar && activeSessionId ? (
        <MobileTerminalAccessoryBar sessionId={activeSessionId} />
      ) : null}
    </div>
  );
}
