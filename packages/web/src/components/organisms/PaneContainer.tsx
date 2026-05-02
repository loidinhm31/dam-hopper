import { memo, useState, useEffect, useRef } from "react";
import { useDroppable, useDndMonitor } from "@dnd-kit/core";
import { Plus, X, Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { terminalRegistry, subscribeToRegistry } from "@/lib/terminal-registry.js";
import type { PaneNode } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/useTerminalLayout.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import { TabBar } from "@/components/organisms/TabBar.js";

// ─── PaneDropZones ────────────────────────────────────────────────────────────
// Always mounted so dnd-kit has registered droppables before drag starts.
// Uses pointer-events-none when not dragging to avoid blocking terminal input.

interface PaneDropZonesProps {
  paneId: string;
  isDragging: boolean;
}

function PaneDropZones({ paneId, isDragging }: PaneDropZonesProps) {
  const top = useDroppable({ id: `${paneId}:top` });
  const bottom = useDroppable({ id: `${paneId}:bottom` });
  const left = useDroppable({ id: `${paneId}:left` });
  const right = useDroppable({ id: `${paneId}:right` });
  const center = useDroppable({ id: `${paneId}:center` });

  const edgeClass = (isOver: boolean) =>
    cn(
      "absolute transition-colors duration-75 z-10",
      !isDragging && "pointer-events-none",
      isDragging && isOver
        ? "bg-blue-500/30 ring-2 ring-inset ring-blue-400"
        : "bg-transparent",
    );

  return (
    <>
      {/* Top edge strip */}
      <div ref={top.setNodeRef} className={cn(edgeClass(top.isOver), "inset-x-0 top-0 h-5")} />
      {/* Bottom edge strip */}
      <div ref={bottom.setNodeRef} className={cn(edgeClass(bottom.isOver), "inset-x-0 bottom-0 h-5")} />
      {/* Left edge strip */}
      <div ref={left.setNodeRef} className={cn(edgeClass(left.isOver), "inset-y-0 left-0 w-5")} />
      {/* Right edge strip */}
      <div ref={right.setNodeRef} className={cn(edgeClass(right.isOver), "inset-y-0 right-0 w-5")} />
      {/* Center zone */}
      <div
        ref={center.setNodeRef}
        className={cn(
          "absolute inset-5 z-9 transition-colors duration-75",
          !isDragging && "pointer-events-none",
          isDragging && center.isOver ? "bg-blue-500/10" : "bg-transparent",
        )}
      />
    </>
  );
}

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
  const isFocused = layout.focusedPaneId === node.id;

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
        el.style.display = isActive ? "block" : "none";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.position = "absolute";
        el.style.inset = "0";

        if (isActive) {
          if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
          fitTimerRef.current = setTimeout(() => {
            requestAnimationFrame(() => {
              entry.fitAddon.fit();
              entry.terminal.focus();
            });
          }, 150); // Increased delay for stability
        }
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

    return () => {
      unsubscribe();
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
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
  const isEmpty = paneTabs.length === 0;

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
      {/* Pane header: draggable tabs + controls */}
      <TabBar
        paneId={node.id}
        paneTabs={paneTabs}
        activeSessionId={node.activeSessionId}
        hasSplit={hasSplit}
        onSelectTab={(sessionId) => {
          layout.setActiveSession(node.id, sessionId);
          layout.setFocusedPaneId(node.id);
        }}
        onCloseTab={onCloseTab}
        onNewTerminal={onNewTerminal}
        onSplitPaneHorizontal={() => layout.splitPane(node.id, "horizontal")}
        onSplitPaneVertical={() => layout.splitPane(node.id, "vertical")}
        onClosePane={() => layout.closePane(node.id)}
      />

      {/* Terminal host div — terminal elements are reparented into here */}
      {/* relative + overflow-hidden so drop zone overlays are clipped to this area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative bg-[#0f172a]"
      >
        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[var(--color-text-muted)] bg-[var(--color-background)]/50">
            <TerminalIcon className="h-10 w-10 opacity-10" />
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs font-medium">Empty Pane</p>
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onNewTerminal(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[var(--color-primary)] text-white rounded hover:opacity-90 transition-opacity"
                >
                  <Plus className="h-3 w-3" />
                  New Terminal
                </button>
                {hasSplit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); layout.closePane(node.id); }}
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
        {/* Drop zones — always in DOM so dnd-kit has them registered */}
        <PaneDropZones paneId={node.id} isDragging={isDragging} />
      </div>
    </div>
  );
});
