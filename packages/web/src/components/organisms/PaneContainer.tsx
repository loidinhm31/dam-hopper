import { memo, useEffect, useRef } from "react";
import { SplitSquareHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import type { PaneNode } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/useTerminalLayout.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

interface PaneContainerProps {
  node: PaneNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}

export const PaneContainer = memo(function PaneContainer({
  node,
  layout,
  openTabs,
  onNewTerminal,
  onCloseTab,
}: PaneContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = layout.focusedPaneId === node.id;

  // ── reparent terminal elements into this container ──────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const doReparent = () => {
      for (const sessionId of node.sessionIds) {
        const entry = terminalRegistry.get(sessionId);
        if (!entry?.terminal.element) continue;

        const el = entry.terminal.element;
        const isActive = sessionId === node.activeSessionId;

        // Move element into this container if not already here
        if (el.parentElement !== container) {
          container.appendChild(el);
        }

        // Show/hide via display toggling (keeps terminal alive while hidden)
        el.style.display = isActive ? "flex" : "none";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.flexDirection = "column";
      }

      // Fit the active terminal after reparent
      if (node.activeSessionId) {
        const entry = terminalRegistry.get(node.activeSessionId);
        if (entry) {
          if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
          fitTimerRef.current = setTimeout(() => {
            requestAnimationFrame(() => {
              entry.fitAddon.fit();
            });
          }, 100);
        }
      }
    };

    doReparent();

    // Exponential backoff retries in case terminal registers after first render
    const RETRY_DELAYS = [100, 250] as const;
    let attempt = 0;
    const scheduleRetry = () => {
      if (attempt >= RETRY_DELAYS.length) return;
      const delay = RETRY_DELAYS[attempt++];
      retryTimerRef.current = setTimeout(() => {
        doReparent();
        scheduleRetry();
      }, delay);
    };
    scheduleRetry();

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current); // H1
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current); // H4: cancel pending fit
    };
  }, [node.sessionIds, node.activeSessionId]);

  // ── install keyboard handler on active terminal ──────────────────────────
  useEffect(() => {
    if (!node.activeSessionId) return;

    const entry = terminalRegistry.get(node.activeSessionId);
    if (!entry) return;

    const { terminal } = entry;
    const paneId = node.id;

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+Shift+5 → split pane vertically
      if (e.ctrlKey && e.shiftKey && e.code === "Digit5" && e.type === "keydown") {
        layout.splitPane(paneId, "vertical");
        return false;
      }

      // Alt+Left → focus previous pane (cycle)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowLeft" && e.type === "keydown") {
        const panes = layout.getPanes();
        const idx = panes.findIndex((p) => p.id === paneId);
        const prev = panes[(idx - 1 + panes.length) % panes.length];
        if (prev && prev.id !== paneId) {
          layout.setFocusedPaneId(prev.id);
          if (prev.activeSessionId) {
            const prevEntry = terminalRegistry.get(prev.activeSessionId);
            prevEntry?.terminal.focus();
          }
        }
        return false;
      }

      // Alt+Right → focus next pane (cycle)
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "ArrowRight" && e.type === "keydown") {
        const panes = layout.getPanes();
        const idx = panes.findIndex((p) => p.id === paneId);
        const next = panes[(idx + 1) % panes.length];
        if (next && next.id !== paneId) {
          layout.setFocusedPaneId(next.id);
          if (next.activeSessionId) {
            const nextEntry = terminalRegistry.get(next.activeSessionId);
            nextEntry?.terminal.focus();
          }
        }
        return false;
      }

      // Ctrl+Shift+[ → previous tab in this pane
      if (e.ctrlKey && e.shiftKey && e.code === "BracketLeft" && e.type === "keydown") {
        const idx = node.sessionIds.indexOf(node.activeSessionId ?? "");
        if (idx > 0) {
          const prev = node.sessionIds[idx - 1];
          if (prev) layout.setActiveSession(paneId, prev);
        }
        return false;
      }

      // Ctrl+Shift+] → next tab in this pane
      if (e.ctrlKey && e.shiftKey && e.code === "BracketRight" && e.type === "keydown") {
        const idx = node.sessionIds.indexOf(node.activeSessionId ?? "");
        if (idx < node.sessionIds.length - 1) {
          const next = node.sessionIds[idx + 1];
          if (next) layout.setActiveSession(paneId, next);
        }
        return false;
      }

      // Ctrl+Shift+C → copy selection
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && e.type === "keydown") {
        const sel = terminal.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }

      // Ctrl+` → global shortcut, don't forward
      if (e.ctrlKey && e.code === "Backquote") return false;

      // Shift+Enter → open new terminal
      if (e.shiftKey && !e.ctrlKey && !e.altKey && e.code === "Enter" && e.type === "keydown") {
        onNewTerminal();
        return false;
      }

      return true;
    });

    // Focus terminal when pane receives focus
    if (isFocused) {
      terminal.focus();
    }

    // Cleanup: restore no-op handler when effect re-runs or cleanup
    return () => {
      // Restore a minimal handler so it doesn't crash if terminal is gone
      try {
        terminal.attachCustomKeyEventHandler(() => true);
      } catch {
        // terminal may be disposed
      }
    };
  }, [node.activeSessionId, node.id, node.sessionIds, isFocused, layout, onNewTerminal]);

  // ── resize observer → fit active terminal ───────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (!node.activeSessionId) return;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        const entry = terminalRegistry.get(node.activeSessionId!);
        entry?.fitAddon.fit();
      }, 100);
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    };
  }, [node.activeSessionId]);

  // ── derive tab entries for this pane ────────────────────────────────────
  const paneTabs = node.sessionIds
    .map((sid) => openTabs.find((t) => t.sessionId === sid))
    .filter((t): t is TabEntry => t !== undefined);

  const hasSplit = layout.getPanes().length > 1;

  return (
    <div
      className={cn(
        "flex flex-col h-full border",
        isFocused ? "border-[var(--color-primary)]/60" : "border-transparent",
      )}
      onClick={() => {
        layout.setFocusedPaneId(node.id);
        if (node.activeSessionId) {
          terminalRegistry.get(node.activeSessionId)?.terminal.focus();
        }
      }}
    >
      {/* Pane header: tabs + controls */}
      {paneTabs.length > 0 && (
        <div className="flex items-center shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          {/* Tab strip */}
          <div className="flex items-center overflow-x-auto min-w-0 flex-1">
            {paneTabs.map((tab) => {
              const isActive = tab.sessionId === node.activeSessionId;
              return (
                <button
                  key={tab.sessionId}
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs shrink-0 border-b-2 transition-colors whitespace-nowrap",
                    isActive
                      ? "border-[var(--color-primary)] text-[var(--color-text)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    layout.setActiveSession(node.id, tab.sessionId);
                    layout.setFocusedPaneId(node.id);
                  }}
                >
                  <span className="max-w-32 truncate">{tab.label}</span>
                  <span
                    role="button"
                    aria-label="Close tab"
                    tabIndex={0}
                    className="opacity-40 hover:opacity-100 rounded hover:bg-[var(--color-danger)]/20 p-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.sessionId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onCloseTab(tab.sessionId);
                      }
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Split button */}
          <button
            type="button"
            title="Split pane (Ctrl+Shift+5)"
            className="shrink-0 p-1.5 mr-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              layout.splitPane(node.id, "vertical");
            }}
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
          </button>

          {/* Close pane button (only when multiple panes exist) */}
          {hasSplit && (
            <button
              type="button"
              title="Close pane"
              className="shrink-0 p-1.5 mr-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                layout.closePane(node.id);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Terminal host div — terminal elements are reparented into here */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative bg-[#0f172a]"
      />
    </div>
  );
});
