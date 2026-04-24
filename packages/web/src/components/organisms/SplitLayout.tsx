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
import type { LayoutNode } from "@/types/terminal-layout.js";
import type { SplitDirection } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/useTerminalLayout.js";
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
}: SplitLayoutProps) {
  // ── dnd-kit drag sensors (8px activation so clicks still work) ──────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── timer ref for post-drag fit() — cleaned up on unmount ───────────────
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (fitTimerRef.current) clearTimeout(fitTimerRef.current); }, []);

  // ── active drag state for DragOverlay label ──────────────────────────────
  const [activeTabLabel, setActiveTabLabel] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DragItem | undefined;
      if (data?.type === "terminal-tab") {
        const tab = openTabs.find((t) => t.sessionId === data.sessionId);
        setActiveTabLabel(tab?.label ?? data.sessionId);
      }
    },
    [openTabs],
  );

  const handleDragCancel = useCallback(() => setActiveTabLabel(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTabLabel(null);
      const { active, over } = event;
      if (!over) return;

      const dragItem = active.data.current as DragItem | undefined;
      if (dragItem?.type !== "terminal-tab") return;

      const overId = String(over.id); // e.g. "paneId:top" | "paneId:center"
      const lastColon = overId.lastIndexOf(":");
      if (lastColon === -1) return;

      const targetPaneId = overId.substring(0, lastColon);
      const edge = overId.substring(lastColon + 1);
      const { sessionId, sourcePaneId } = dragItem;

      // Dropped on same pane center: no-op
      if (edge === "center" && targetPaneId === sourcePaneId) return;

      // Source pane will become empty after this move?
      const sourcePane = layout.getPaneById(sourcePaneId);
      const willBecomeEmpty = (sourcePane?.sessionIds.length ?? 0) <= 1;

      // Dragging only tab to own pane's edge: no meaningful split (would
      // create a split then immediately collapse it). Skip.
      if (edge !== "center" && targetPaneId === sourcePaneId && willBecomeEmpty) return;

      if (edge === "center") {
        layout.moveTabToPane(sessionId, sourcePaneId, targetPaneId);
        if (willBecomeEmpty) layout.closePane(sourcePaneId);
      } else {
        const direction: SplitDirection =
          edge === "left" || edge === "right" ? "horizontal" : "vertical";
        const newPaneId = layout.splitPane(targetPaneId, direction);
        layout.moveTabToPane(sessionId, sourcePaneId, newPaneId);
        layout.setFocusedPaneId(newPaneId);
        if (willBecomeEmpty) layout.closePane(sourcePaneId);
      }

      // Fit all registered terminals 150ms after state settles
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = setTimeout(() => {
        for (const [, entry] of terminalRegistry) {
          try { entry.fitAddon.fit(); } catch { /* terminal may be disposed */ }
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
        />
      </div>
      {/* Drag overlay: floating tab label following the pointer */}
      <DragOverlay dropAnimation={null}>
        {activeTabLabel !== null && (
          <div className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg opacity-90 pointer-events-none whitespace-nowrap">
            {activeTabLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
