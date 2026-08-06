import { useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";
import { TerminalKeepAliveHost } from "@/components/organisms/TerminalKeepAliveHost.js";
import { SplitLayout } from "@/components/organisms/SplitLayout.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  collectPanes,
  useTerminalLayout,
} from "@/hooks/use-terminal-layout.js";
import { fitAllTerminals } from "@/lib/terminal-fit-scheduler.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { TerminalDiagnosticsMenuHandler } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";

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
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  layoutRevision?: number;
  renderTerminals?: boolean;
  onVisibleSessionIdsChange?: (sessionIds: ReadonlySet<string>) => void;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
}

export function MultiTerminalDisplay({
  activeSessionId,
  mountedSessions,
  openTabs,
  onSessionExit,
  onNewTerminal,
  onSelectTab,
  onCloseTab,
  onOpenDiagnosticsMenu,
  layoutRevision = 0,
  renderTerminals = true,
  onVisibleSessionIdsChange,
  browserOpen = false,
  renderBrowserContent,
  onCloseBrowser,
}: Props) {
  const layout = useTerminalLayout();
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const showMobileAccessoryBar =
    !!activeSessionId &&
    (isAndroidChromeNativeInputSuppressed ||
      (isCompactWorkspace && isCoarsePointer));
  const suppressTerminalNativeInput =
    isAndroidChromeNativeInputSuppressed ||
    (showMobileAccessoryBar && mobileCustomKeyboardEnabled);
  const visibleSessionIds = useMemo(
    () =>
      new Set(
        collectPanes(layout.root).flatMap((pane) =>
          pane.activeSessionId ? [pane.activeSessionId] : [],
        ),
      ),
    [layout.root],
  );

  useEffect(() => {
    onVisibleSessionIdsChange?.(visibleSessionIds);
    return () => onVisibleSessionIdsChange?.(new Set());
  }, [onVisibleSessionIdsChange, visibleSessionIds]);

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
  // PaneContainer subscribes to the registry, so no forced re-render is needed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleTerminalReady = useCallback((_: string) => {}, []);

  // Mode switches and Fleet rail resize-end events change the pane host size
  // outside SplitLayout's drag/drop path, so refit registered terminals once.
  useEffect(() => {
    fitAllTerminals(terminalRegistry.values());
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
      {renderTerminals && (
        <TerminalKeepAliveHost
          mountedSessions={mountedSessions}
          openTabs={openTabs}
          onSessionExit={onSessionExit}
          onNewTerminal={onNewTerminal}
          onTerminalReady={handleTerminalReady}
          suppressAutoFocus={suppressTerminalNativeInput}
          suppressNativeKeyboard={suppressTerminalNativeInput}
          webglEnabledSessionIds={visibleSessionIds}
        />
      )}

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
          onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
          suppressTerminalFocus={suppressTerminalNativeInput}
          browserOpen={browserOpen}
          renderBrowserContent={renderBrowserContent}
          onCloseBrowser={onCloseBrowser}
        />
      </div>
      {showMobileAccessoryBar && activeSessionId ? (
        <MobileTerminalAccessoryBar sessionId={activeSessionId} />
      ) : null}
    </div>
  );
}
