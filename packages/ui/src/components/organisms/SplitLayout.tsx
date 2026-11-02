import {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import type { TileNode, TilePaneNode } from "@/types/tile-tree.js";
import { layoutNodeToTileNode } from "@/lib/tile-tree.js";
import type { UseTerminalLayoutResult } from "@/hooks/use-terminal-layout.js";
import { PaneContainer } from "@/components/organisms/PaneContainer.js";
import type { DragItem } from "@/components/organisms/TabBar.js";
import { fitAllTerminals } from "@/lib/terminal-fit-scheduler.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { TerminalDiagnosticsMenuHandler } from "@/components/organisms/TerminalDiagnosticsContextMenu.js";
import { TerminalTitleText } from "@/components/atoms/TerminalTitleText.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
export function resolveDragOverlayTitle(tab: DisplayTabEntry | undefined) {
  return { title: tab?.title, label: tab?.label ?? "Terminal" };
}

interface LayoutTreeProps {
  node: LayoutNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  terminalCommitStatusEnabled?: boolean;
  openTabs: DisplayTabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onRenameSession?: (sessionId: string) => void;
  activeSessionId: string | null;
  suppressTerminalFocus?: boolean;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
  onOpenSessionChanges?: (sessionId: string) => void;
}

function LayoutTree(props: LayoutTreeProps) {
  const tileRoot = useMemo(
    () => layoutNodeToTileNode(props.node),
    [props.node],
  );

  return (
    <GenericTileRenderer<string>
      node={tileRoot}
      onUpdateSizes={props.layout.updateSizes}
      renderPane={(tilePane) => (
        <PaneContainer
          node={{
            type: "pane",
            id: tilePane.id,
            sessionIds: tilePane.items,
            activeSessionId: tilePane.active,
          }}
          layout={props.layout}
          mountedSessions={props.mountedSessions}
          terminalCommitStatusEnabled={props.terminalCommitStatusEnabled}
          openTabs={props.openTabs}
          onNewTerminal={props.onNewTerminal}
          onSessionExit={props.onSessionExit}
          onSelectTab={props.onSelectTab}
          onToggleTabPin={props.onToggleTabPin ?? (() => {})}
          onCloseTab={props.onCloseTab}
          onRenameSession={props.onRenameSession}
          onOpenDiagnosticsMenu={props.onOpenDiagnosticsMenu}
          activeSessionId={props.activeSessionId}
          suppressTerminalFocus={props.suppressTerminalFocus}
          browserOpen={props.browserOpen}
          renderBrowserContent={props.renderBrowserContent}
          onCloseBrowser={props.onCloseBrowser}
          onOpenSessionChanges={props.onOpenSessionChanges}
        />
      )}
    />
  );
}

export interface GenericTileRendererProps<T> {
  node: TileNode<T>;
  onUpdateSizes: (nodeId: string, sizes: [number, number]) => void;
  renderPane: (pane: TilePaneNode<T>) => ReactNode;
}

export function GenericTileRenderer<T>({
  node,
  onUpdateSizes,
  renderPane,
}: GenericTileRendererProps<T>) {
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleResize = useCallback(
    (layoutMap: Layout) => {
      if (node.type !== "split") return;
      const leftId = node.children[0].id;
      const rightId = node.children[1].id;
      clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const leftSize = layoutMap[leftId] ?? 50;
        const rightSize = layoutMap[rightId] ?? 50;
        onUpdateSizes(node.id, [leftSize, rightSize]);
      }, 100);
    },
    [node, onUpdateSizes],
  );

  if (node.type === "pane") {
    return <>{renderPane(node)}</>;
  }

  return (
    <Group
      orientation={node.direction}
      onLayoutChanged={handleResize}
      className="h-full"
      style={{ overflow: "clip" }}
    >
      <Panel
        id={node.children[0].id}
        defaultSize={node.sizes[0]}
        minSize={10}
        style={{ overflow: "clip" }}
      >
        <GenericTileRenderer
          node={node.children[0]}
          onUpdateSizes={onUpdateSizes}
          renderPane={renderPane}
        />
      </Panel>
      <Separator
        aria-label="Resize split pane"
        className="bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)] data-[orientation=vertical]:w-px data-[orientation=vertical]:cursor-col-resize data-[orientation=horizontal]:h-px data-[orientation=horizontal]:cursor-row-resize"
      />
      <Panel
        id={node.children[1].id}
        defaultSize={node.sizes[1]}
        minSize={10}
        style={{ overflow: "clip" }}
      >
        <GenericTileRenderer
          node={node.children[1]}
          onUpdateSizes={onUpdateSizes}
          renderPane={renderPane}
        />
      </Panel>
    </Group>
  );
}

export interface SplitLayoutProps {
  root: LayoutNode;
  layout: UseTerminalLayoutResult;
  mountedSessions: MountedSession[];
  terminalCommitStatusEnabled?: boolean;
  openTabs: DisplayTabEntry[];
  onNewTerminal: () => void;
  onSessionExit: (sessionId: string) => void;
  onSelectTab: (sessionId: string) => void;
  onToggleTabPin?: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler;
  onRenameSession?: (sessionId: string) => void;
  activeSessionId?: string | null;
  suppressTerminalFocus?: boolean;
  browserOpen?: boolean;
  renderBrowserContent?: (onClose: () => void) => ReactNode;
  onCloseBrowser?: () => void;
  onOpenSessionChanges?: (sessionId: string) => void;
}

export function parseDockTarget(id: string): DockTarget | null {
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
  terminalCommitStatusEnabled,
  openTabs,
  onNewTerminal,
  onSessionExit,
  onSelectTab,
  onToggleTabPin,
  onCloseTab,
  onOpenDiagnosticsMenu,
  onRenameSession,
  activeSessionId = null,
  suppressTerminalFocus = false,
  browserOpen = false,
  renderBrowserContent,
  onCloseBrowser,
  onOpenSessionChanges,
}: SplitLayoutProps) {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const shouldSuppressTerminalFocus =
    isAndroidChromeNativeInputSuppressed || suppressTerminalFocus;
  // ── dnd-kit drag sensors (8px activation so clicks still work) ──────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const [activeDragMeta, setActiveDragMeta] = useState<{
    title?: DisplayTabEntry["title"];
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
        const dragTitle = resolveDragOverlayTitle(tab);
        setActiveDragMeta({
          ...dragTitle,
          sourcePaneLabel:
            paneIndex >= 0 ? `Pane ${paneIndex + 1}` : "Current Pane",
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

      fitAllTerminals(terminalRegistry.values());
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
      <div className="h-full overflow-clip">
        <LayoutTree
          node={root}
          layout={layout}
          mountedSessions={mountedSessions}
          terminalCommitStatusEnabled={terminalCommitStatusEnabled}
          openTabs={openTabs}
          onNewTerminal={onNewTerminal}
          onSessionExit={onSessionExit}
          onSelectTab={onSelectTab}
          onToggleTabPin={onToggleTabPin}
          onCloseTab={onCloseTab}
          onRenameSession={onRenameSession}
          onOpenDiagnosticsMenu={onOpenDiagnosticsMenu}
          activeSessionId={activeSessionId}
          suppressTerminalFocus={shouldSuppressTerminalFocus}
          browserOpen={browserOpen}
          renderBrowserContent={renderBrowserContent}
          onCloseBrowser={onCloseBrowser}
          onOpenSessionChanges={onOpenSessionChanges}
        />
      </div>
      {/* Drag overlay: floating tab label following the pointer */}
      <DragOverlay dropAnimation={null}>
        {activeDragMeta !== null && (
          <div className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-lg opacity-90 pointer-events-none whitespace-nowrap">
            {activeDragMeta.title ? (
              <TerminalTitleText
                title={activeDragMeta.title}
                className="font-mono"
              />
            ) : (
              <div className="font-mono">{activeDragMeta.label}</div>
            )}
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {activeDragMeta.sourcePaneLabel} · Drop to dock terminal
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}