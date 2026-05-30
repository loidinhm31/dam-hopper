import { useRef, useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Layout } from "react-resizable-panels";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { DockTarget, LayoutNode } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/use-terminal-layout.js";
import { PaneContainer } from "@/components/organisms/PaneContainer.js";
import type { DragItem } from "@/components/organisms/TabBar.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";

interface LayoutTreeProps {
  node: LayoutNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  suppressTerminalFocus?: boolean;
}

function LayoutTree({
  node,
  layout,
  mountedSessions,
  openTabs,
  onNewTerminal,
  onSessionExit,
  onSelectTab,
  onCloseTab,
  suppressTerminalFocus = false,
}: LayoutTreeProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // v4.9.0: onLayoutChanged receives Layout = { [panelId: string]: number }
  const handleResize = useCallback(
    (layoutMap: Layout) => {
      if (node.type !== "split") return;
      const leftId = node.children[0].id;
      const rightId = node.children[1].id;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const leftSize = layoutMap[leftId] ?? 50;
        const rightSize = layoutMap[rightId] ?? 50;
        layout.updateSizes(node.id, [leftSize, rightSize]);
      }, 100);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.type === "split" ? node.id : null, layout.updateSizes],
  );

  if (node.type === "pane") {
    return (
      <PaneContainer
        node={node}
        layout={layout}
        mountedSessions={mountedSessions}
        openTabs={openTabs}
        onNewTerminal={onNewTerminal}
        onSessionExit={onSessionExit}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        suppressTerminalFocus={suppressTerminalFocus}
      />
    );
  }

  return (
    <Group
      orientation={node.direction}
      onLayoutChanged={handleResize}
      className="h-full"
    >
      <Panel id={node.children[0].id} defaultSize={node.sizes[0]} minSize={10}>
        <LayoutTree
          node={node.children[0]}
          layout={layout}
          mountedSessions={mountedSessions}
          openTabs={openTabs}
          onNewTerminal={onNewTerminal}
          onSessionExit={onSessionExit}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          suppressTerminalFocus={suppressTerminalFocus}
        />
      </Panel>
      <Separator className="bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors data-[orientation=vertical]:w-px data-[orientation=vertical]:cursor-col-resize data-[orientation=horizontal]:h-px data-[orientation=horizontal]:cursor-row-resize" />
      <Panel id={node.children[1].id} defaultSize={node.sizes[1]} minSize={10}>
        <LayoutTree
          node={node.children[1]}
          layout={layout}
          mountedSessions={mountedSessions}
          openTabs={openTabs}
          onNewTerminal={onNewTerminal}
          onSessionExit={onSessionExit}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          suppressTerminalFocus={suppressTerminalFocus}
        />
      </Panel>
    </Group>
  );
}

export interface SplitLayoutProps {
  root: LayoutNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  openTabs: TabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  suppressTerminalFocus?: boolean;
}

function parseDockTarget(id: string): DockTarget | null {
  const parts = id.split(":");
  if (parts[0] === "pane" && parts[2] === "center") {
    return { kind: "pane-center", paneId: parts[1] ?? "" };
  }
  if (parts[0] === "pane" && parts[2] === "edge") {
    const edge = parts[3];
    if (
      edge === "top" ||
      edge === "bottom" ||
      edge === "left" ||
      edge === "right"
    ) {
      return { kind: "pane-edge", paneId: parts[1] ?? "", edge };
    }
  }
  if (parts[0] === "tabs" && parts[2] === "index") {
    const index = Number(parts[3]);
    if (Number.isFinite(index)) {
      return { kind: "tab-index", paneId: parts[1] ?? "", index };
    }
  }
  return null;
}

export function SplitLayout({
  root,
  layout,
  mountedSessions,
  openTabs,
  onNewTerminal,
  onSessionExit,
  onSelectTab,
  onCloseTab,
  suppressTerminalFocus = false,
}: SplitLayoutProps) {
  // ── dnd-kit drag sensors (8px activation so clicks still work) ──────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── timer ref for post-drag fit() — cleaned up on unmount ───────────────
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    },
    [],
  );

  // ── active drag state for DragOverlay label ──────────────────────────────
  const [activeDragMeta, setActiveDragMeta] = useState<{
    label: string;
    sourcePaneLabel: string;
  } | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DragItem | undefined;
      if (data?.type === "terminal-tab") {
        const tab = openTabs.find((t) => t.sessionId === data.sessionId);
        const paneIndex = layout
          .getPanes()
          .findIndex((pane) => pane.id === data.sourcePaneId);
        setActiveDragMeta({
          label: tab?.label ?? data.sessionId,
          sourcePaneLabel: paneIndex >= 0 ? `Pane ${paneIndex + 1}` : "Current Pane",
        });
      }
    },
    [layout, openTabs],
  );

  const handleDragCancel = useCallback(() => setActiveDragMeta(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragMeta(null);
      const { active, over } = event;
      if (!over) return;

      const dragItem = active.data.current as DragItem | undefined;
      if (dragItem?.type !== "terminal-tab") return;
      const target = parseDockTarget(String(over.id));
      if (!target) return;
      const changed = layout.dockSession(
        dragItem.sessionId,
        dragItem.sourcePaneId,
        target,
      );
      if (!changed) return;

      // Fit all registered terminals 150ms after state settles
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        for (const [, entry] of terminalRegistry) {
          try {
            entry.fitAddon.fit();
          } catch {
            /* terminal may be disposed */
          }
        }
      }, 150);
    },
    [layout],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full overflow-hidden">
        <LayoutTree
          node={root}
          layout={layout}
          mountedSessions={mountedSessions}
          openTabs={openTabs}
          onNewTerminal={onNewTerminal}
          onSessionExit={onSessionExit}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          suppressTerminalFocus={suppressTerminalFocus}
        />
      </div>
      {/* Drag overlay: floating tab label following the pointer */}
      <DragOverlay dropAnimation={null}>
        {activeDragMeta !== null && (
          <div className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg opacity-90 pointer-events-none whitespace-nowrap">
            <div className="font-mono">{activeDragMeta.label}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {activeDragMeta.sourcePaneLabel} · Drop to dock terminal
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
