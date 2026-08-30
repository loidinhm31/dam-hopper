import { memo, useState, useEffect, useRef, type ReactNode } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Plus, X, Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import {
  cancelScheduledTerminalFit,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import {
  terminalRegistry,
  subscribeToRegistry,
} from "@/lib/terminal-registry.js";
import type { PaneNode } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/use-terminal-layout.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { TabBar } from "@/components/organisms/TabBar.js";
import { TerminalDockPreview } from "@/components/organisms/TerminalDockPreview.js";
import type { TerminalDiagnosticsMenuHandler } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { syncNativeKeyboardSuppression } from "@/lib/terminal-native-input-policy.js";
import { MobileTerminalAccessoryBar } from "@/components/organisms/MobileTerminalAccessoryBar.js";

interface PaneContainerProps {
  node: PaneNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  terminalCommitStatusEnabled?: boolean;
  openTabs: TabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  activeSessionId?: string | null;
  suppressTerminalFocus?: boolean;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
}

export const PaneContainer = memo(function PaneContainer({
  node,
  layout,
  mountedSessions,
  terminalCommitStatusEnabled: terminalCommitStatusOverride,
  openTabs,
  onNewTerminal,
  onSelectTab,
  onToggleTabPin,
  onCloseTab,
  onOpenDiagnosticsMenu,
  activeSessionId = null,
  suppressTerminalFocus = false,
  browserOpen = false,
  renderBrowserContent,
  onCloseBrowser,
}: PaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const shouldSuppressTerminalFocus =
    isAndroidChromeNativeInputSuppressed || suppressTerminalFocus;
  const isFocused = layout.focusedPaneId === node.id;
  const configuredTerminalCommitStatusEnabled = useSettingsStore(
    (state) => state.terminalCommitStatusEnabled,
  );
  const terminalCommitStatusEnabled =
    terminalCommitStatusOverride ?? configuredTerminalCommitStatusEnabled;
  const activeProject = mountedSessions.find(
    (session) => session.sessionId === node.activeSessionId,
  )?.project;

  // Track drag state to show/hide drop zones
  const [isDragging, setIsDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });

  // ── reparent terminal elements into this container ──────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const doReparent = () => {
      if (shouldSuppressTerminalFocus) {
        for (const sessionId of node.sessionIds) {
          cancelScheduledTerminalFit(terminalRegistry.get(sessionId));
        }
      }
      attachTerminalsToHost({
        host: container,
        sessionIds: node.sessionIds,
        activeSessionId: node.activeSessionId,
        suppressTerminalFocus: shouldSuppressTerminalFocus,
      });
      for (const sessionId of node.sessionIds) {
        syncNativeKeyboardSuppression(
          terminalRegistry.get(sessionId)?.terminal ?? null,
          shouldSuppressTerminalFocus,
        );
      }
    };

    // Initial reparent attempt
    doReparent();

    // Subscribe to registry changes to handle terminals that initialize late
    const unsubscribe = subscribeToRegistry((registeredId) => {
      if (node.sessionIds.includes(registeredId)) {
        doReparent();
      }
    });

    return unsubscribe;
  }, [node.sessionIds, node.activeSessionId, shouldSuppressTerminalFocus]);

  // ── install keyboard handler on active terminal ──────────────────────────
  useEffect(() => {
    if (!node.activeSessionId) return;

    const entry = terminalRegistry.get(node.activeSessionId);
    if (!entry) return;

    const { terminal } = entry;
    const paneId = node.id;

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Keep one composition chain: terminal-global handling (including a
      // currently safe ghost acceptance) gets first refusal before pane keys.
      if (!entry.baseKeyEventHandler?.(e)) return false;
      // Ctrl+Shift+5 → split pane vertically
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "Digit5" &&
        e.type === "keydown"
      ) {
        layout.splitPane(paneId, "vertical");
        return false;
      }

      // Alt+Left → focus previous pane (cycle)
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.code === "ArrowLeft" &&
        e.type === "keydown"
      ) {
        const panes = layout.getPanes();
        const idx = panes.findIndex((p) => p.id === paneId);
        const prev = panes[(idx - 1 + panes.length) % panes.length];
        if (prev && prev.id !== paneId) {
          layout.setFocusedPaneId(prev.id);
          if (prev.activeSessionId) {
            onSelectTab(prev.activeSessionId);
            const prevEntry = terminalRegistry.get(prev.activeSessionId);
            if (!shouldSuppressTerminalFocus) prevEntry?.terminal.focus();
          }
        }
        return false;
      }

      // Alt+Right → focus next pane (cycle)
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.code === "ArrowRight" &&
        e.type === "keydown"
      ) {
        const panes = layout.getPanes();
        const idx = panes.findIndex((p) => p.id === paneId);
        const next = panes[(idx + 1) % panes.length];
        if (next && next.id !== paneId) {
          layout.setFocusedPaneId(next.id);
          if (next.activeSessionId) {
            onSelectTab(next.activeSessionId);
            const nextEntry = terminalRegistry.get(next.activeSessionId);
            if (!shouldSuppressTerminalFocus) nextEntry?.terminal.focus();
          }
        }
        return false;
      }

      // Ctrl+Shift+[ → previous tab in this pane
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "BracketLeft" &&
        e.type === "keydown"
      ) {
        const idx = node.sessionIds.indexOf(node.activeSessionId ?? "");
        if (idx > 0) {
          const prev = node.sessionIds[idx - 1];
          if (prev) {
            layout.setActiveSession(paneId, prev);
            onSelectTab(prev);
          }
        }
        return false;
      }

      // Ctrl+Shift+] → next tab in this pane
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "BracketRight" &&
        e.type === "keydown"
      ) {
        const idx = node.sessionIds.indexOf(node.activeSessionId ?? "");
        if (idx < node.sessionIds.length - 1) {
          const next = node.sessionIds[idx + 1];
          if (next) {
            layout.setActiveSession(paneId, next);
            onSelectTab(next);
          }
        }
        return false;
      }

      return true;
    });

    // Focus terminal when pane receives focus
    if (isFocused && !shouldSuppressTerminalFocus) {
      terminal.focus();
    }

    // Cleanup: restore the base handler when this pane releases the terminal.
    return () => {
      // Restore the TerminalPanel handler when this pane stops owning the terminal.
      try {
        terminal.attachCustomKeyEventHandler(
          entry.baseKeyEventHandler ?? (() => true),
        );
      } catch {
        // terminal may be disposed
      }
    };
  }, [
    node.activeSessionId,
    node.id,
    node.sessionIds,
    isFocused,
    layout,
    onNewTerminal,
    onSelectTab,
    shouldSuppressTerminalFocus,
  ]);

  // ── resize observer → fit active terminal ───────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (!node.activeSessionId) return;
      scheduleTerminalFit(terminalRegistry.get(node.activeSessionId));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [node.activeSessionId]);

  // ── derive tab entries for this pane ────────────────────────────────────
  const paneTabs = node.sessionIds
    .map((sid) => openTabs.find((t) => t.sessionId === sid))
    .filter((t): t is TabEntry => t !== undefined);

  const hasSplit = layout.getPanes().length > 1;
  const isEmpty = paneTabs.length === 0;
  const browserVisible = browserOpen && isFocused && !isEmpty;
  const terminalHost = (
    <div
      ref={containerRef}
      data-testid="terminal-pane-output-host"
      className="flex-1 min-h-0 overflow-clip relative bg-[var(--color-background)]"
      onClick={() => {
        layout.setFocusedPaneId(node.id);
        if (node.activeSessionId) {
          onSelectTab(node.activeSessionId);
          if (!shouldSuppressTerminalFocus) {
            terminalRegistry.get(node.activeSessionId)?.terminal.focus();
          }
        }
      }}
    >
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)] bg-[var(--color-background)]/50">
          <TerminalIcon className="h-10 w-10 opacity-10" />
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-medium">Empty Pane</p>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewTerminal();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[var(--color-primary)] text-white rounded hover:opacity-90 transition-opacity"
              >
                <Plus className="h-3 w-3" />
                New Terminal
              </button>
              {hasSplit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    layout.closePane(node.id);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors rounded"
                >
                  <X className="h-3 w-3" />
                  Close Pane
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <TerminalDockPreview paneId={node.id} isDragging={isDragging} />
    </div>
  );

  const terminalPane = (
    <div className="relative flex h-full min-h-0 flex-col">
      {terminalHost}
      {node.activeSessionId && node.activeSessionId === activeSessionId ? (
        <MobileTerminalAccessoryBar sessionId={node.activeSessionId} />
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col h-full border",
        isFocused ? "border-[var(--color-primary)]/60" : "border-transparent",
      )}
    >
      {/* Pane header: draggable tabs + controls */}
      <TabBar
        paneId={node.id}
        paneTabs={paneTabs}
        activeSessionId={node.activeSessionId}
        activeProject={activeProject}
        terminalCommitStatusEnabled={terminalCommitStatusEnabled}
        hasSplit={hasSplit}
        onSelectTab={(sessionId) => {
          layout.setActiveSession(node.id, sessionId);
          layout.setFocusedPaneId(node.id);
          onSelectTab(sessionId);
        }}
        onToggleTabPin={onToggleTabPin ?? (() => {})}
        onCloseTab={onCloseTab}
        onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
        onNewTerminal={onNewTerminal}
        onSplitPaneHorizontal={() => layout.splitPane(node.id, "horizontal")}
        onSplitPaneVertical={() => layout.splitPane(node.id, "vertical")}
        onClosePane={() => layout.closePane(node.id)}
      />

      {/* The focused terminal owns the browser split, so handoff never asks to choose a terminal. */}
      {browserVisible ? (
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          style={{ overflow: "clip" }}
          data-testid="terminal-browser-split"
        >
          <Panel
            id={`${node.id}:terminal`}
            defaultSize={60}
            minSize={30}
            style={{ overflow: "clip" }}
          >
            {terminalPane}
          </Panel>
          <Separator
            aria-label="Resize terminal and browser panels"
            className="w-1 shrink-0 bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)] data-[orientation=vertical]:cursor-col-resize"
          />
          <Panel id={`${node.id}:browser`} defaultSize={40} minSize={20}>
            <div className="h-full min-w-0 overflow-hidden">
              {renderBrowserContent?.(onCloseBrowser ?? (() => {}))}
            </div>
          </Panel>
        </Group>
      ) : (
        terminalPane
      )}
    </div>
  );
});
