import { useRef, useCallback, useEffect } from "react";
import type { Layout } from "react-resizable-panels";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { LayoutNode } from "@/types/terminal-layout.js";
import type { UseTerminalLayoutResult } from "@/hooks/useTerminalLayout.js";
import { PaneContainer } from "@/components/organisms/PaneContainer.js";
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
  return (
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
  );
}
