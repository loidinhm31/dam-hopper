import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { GroupImperativeHandle, Layout } from "react-resizable-panels";

const STORAGE_KEY_MAIN = "ide-panel-main";
const STORAGE_KEY_CENTER = "ide-panel-center";

const MAIN_TREE_ID = "tree";
const MAIN_RIGHT_ID = "right";
const CENTER_EDITOR_ID = "editor";
const CENTER_TERMINAL_ID = "terminal";

function loadLayout(key: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as Layout;
  } catch {
    return undefined;
  }
}

function saveLayout(key: string, layout: Layout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // ignore quota errors
  }
}

interface IdeShellProps {
  tree: ReactNode;
  editor: ReactNode;
  terminal: ReactNode;
}

export function IdeShell({ tree, editor, terminal }: IdeShellProps) {
  const mainGroupRef = useRef<GroupImperativeHandle | null>(null);
  const centerGroupRef = useRef<GroupImperativeHandle | null>(null);

  useEffect(() => {
    const mainLayout = loadLayout(STORAGE_KEY_MAIN);
    if (mainLayout && mainGroupRef.current) mainGroupRef.current.setLayout(mainLayout);
    const centerLayout = loadLayout(STORAGE_KEY_CENTER);
    if (centerLayout && centerGroupRef.current) centerGroupRef.current.setLayout(centerLayout);
  }, []);

  const handleMainLayoutChange = useCallback((layout: Layout) => {
    saveLayout(STORAGE_KEY_MAIN, layout);
  }, []);

  const handleCenterLayoutChange = useCallback((layout: Layout) => {
    saveLayout(STORAGE_KEY_CENTER, layout);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden gradient-bg">
      <Group
        groupRef={mainGroupRef}
        orientation="horizontal"
        onLayoutChanged={handleMainLayoutChange}
        className="flex-1"
      >
        <Panel id={MAIN_TREE_ID} defaultSize={18} minSize={10} maxSize={40}>
          <div className="h-full overflow-hidden glass-card border-r border-[var(--color-border)]">
            {tree}
          </div>
        </Panel>

        <Separator className="w-1 hover:w-1.5 bg-[var(--color-border)] hover:bg-[var(--color-primary)]/40 transition-all cursor-col-resize" />

        <Panel id={MAIN_RIGHT_ID} minSize={30}>
          <Group
            groupRef={centerGroupRef}
            orientation="vertical"
            onLayoutChanged={handleCenterLayoutChange}
            className="h-full"
          >
            <Panel id={CENTER_EDITOR_ID} defaultSize={70} minSize={20}>
              <div className="h-full overflow-hidden">
                {editor}
              </div>
            </Panel>

            <Separator className="h-1 hover:h-1.5 bg-[var(--color-border)] hover:bg-[var(--color-primary)]/40 transition-all cursor-row-resize" />

            <Panel id={CENTER_TERMINAL_ID} defaultSize={30} minSize={10}>
              <div className="h-full overflow-hidden border-t border-[var(--color-border)]">
                {terminal}
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
