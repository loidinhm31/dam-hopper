import { useRef, useState, type ReactNode, useMemo, useEffect } from "react";
import { TopNav } from "@/components/organisms/TopNav.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";
import { useResizeHandle } from "@/hooks/useResizeHandle.js";
import { useVerticalResizeHandle } from "@/hooks/useVerticalResizeHandle.js";
import { cn } from "@/lib/utils.js";
import type { ToolWindowDef } from "@/types/ide.js";
import { ActivityBar } from "@/components/organisms/ActivityBar.js";
import { SidebarTopGroup } from "@/components/organisms/SidebarTopGroup.js";
import { SidebarBottomGroup } from "@/components/organisms/SidebarBottomGroup.js";

const TREE_WIDTH_KEY = "dam-hopper:ide-tree-width";
const TERMINAL_TREE_WIDTH_KEY = "dam-hopper:ide-terminal-tree-width";
const BOTTOM_HEIGHT_KEY = "dam-hopper:ide-bottom-height";

const LEFT_TOP_KEY = "dam-hopper:ide-left-top";
const LEFT_BOTTOM_KEY = "dam-hopper:ide-left-bottom";
const RIGHT_TOP_KEY = "dam-hopper:ide-right-top";
const RIGHT_BOTTOM_KEY = "dam-hopper:ide-right-bottom";

export function IdeShell({ leftTools, rightTools, editor }: { leftTools: ToolWindowDef[], rightTools: ToolWindowDef[], editor: ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapse();

  // Left: tool panel width
  const {
    width: leftWidth,
    handleProps: leftResizeProps,
    isDragging: isLeftDragging,
  } = useResizeHandle({ min: 140, max: 480, defaultWidth: 240, storageKey: TREE_WIDTH_KEY });

  // Right: tool panel width
  const {
    width: rightWidth,
    handleProps: rightResizeProps,
    isDragging: isRightDragging,
  } = useResizeHandle({ min: 180, max: 480, defaultWidth: 260, storageKey: TERMINAL_TREE_WIDTH_KEY, reversed: true });

  // Bottom: panel height
  const {
    height: bottomHeight,
    handleProps: bottomResizeProps,
    isDragging: isBottomDragging,
  } = useVerticalResizeHandle({ min: 100, max: 600, defaultHeight: 300, storageKey: BOTTOM_HEIGHT_KEY, reversed: true });

  const [activeLeftTopId, setActiveLeftTopId] = useState<string | null>(() => {
    const stored = localStorage.getItem(LEFT_TOP_KEY);
    if (stored === null) return leftTools.find(t => !t.position || t.position === 'top')?.id || null;
    return stored === "null" ? null : stored;
  });
  const [activeLeftBottomId, setActiveLeftBottomId] = useState<string | null>(() => {
    const stored = localStorage.getItem(LEFT_BOTTOM_KEY);
    if (stored === null) return leftTools.find(t => t.position === 'bottom')?.id || null;
    return stored === "null" ? null : stored;
  });
  const [activeRightTopId, setActiveRightTopId] = useState<string | null>(() => {
    const stored = localStorage.getItem(RIGHT_TOP_KEY);
    if (stored === null) return rightTools.find(t => !t.position || t.position === 'top')?.id || null;
    return stored === "null" ? null : stored;
  });
  const [activeRightBottomId, setActiveRightBottomId] = useState<string | null>(() => {
    const stored = localStorage.getItem(RIGHT_BOTTOM_KEY);
    if (stored === null) return rightTools.find(t => t.position === 'bottom')?.id || null;
    return stored === "null" ? null : stored;
  });

  const activeLeftTopTool = useMemo(() => leftTools.find(t => t.id === activeLeftTopId), [leftTools, activeLeftTopId]);
  const activeLeftBottomTool = useMemo(() => leftTools.find(t => t.id === activeLeftBottomId), [leftTools, activeLeftBottomId]);
  const activeRightTopTool = useMemo(() => rightTools.find(t => t.id === activeRightTopId), [rightTools, activeRightTopId]);
  const activeRightBottomTool = useMemo(() => rightTools.find(t => t.id === activeRightBottomId), [rightTools, activeRightBottomId]);

  useEffect(() => {
    localStorage.setItem(LEFT_TOP_KEY, activeLeftTopId === null ? "null" : activeLeftTopId);
  }, [activeLeftTopId]);
  useEffect(() => {
    localStorage.setItem(LEFT_BOTTOM_KEY, activeLeftBottomId === null ? "null" : activeLeftBottomId);
  }, [activeLeftBottomId]);
  useEffect(() => {
    localStorage.setItem(RIGHT_TOP_KEY, activeRightTopId === null ? "null" : activeRightTopId);
  }, [activeRightTopId]);
  useEffect(() => {
    localStorage.setItem(RIGHT_BOTTOM_KEY, activeRightBottomId === null ? "null" : activeRightBottomId);
  }, [activeRightBottomId]);

  function handleToggleLeft(id: string) {
    const tool = leftTools.find(t => t.id === id);
    if (!tool) return;
    const isTop = !tool.position || tool.position === 'top';
    if (isTop) setActiveLeftTopId(curr => curr === id ? null : id);
    else setActiveLeftBottomId(curr => curr === id ? null : id);
  }

  function handleToggleRight(id: string) {
    const tool = rightTools.find(t => t.id === id);
    if (!tool) return;
    const isTop = !tool.position || tool.position === 'top';
    if (isTop) setActiveRightTopId(curr => curr === id ? null : id);
    else setActiveRightBottomId(curr => curr === id ? null : id);
  }

  const isDragging = isLeftDragging || isRightDragging || isBottomDragging;

  return (
    <div className={cn("flex flex-col h-screen overflow-hidden gradient-bg", isDragging && "select-none")}>
      {/* App nav top bar */}
      <TopNav collapsed={collapsed} onToggle={toggle} />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* ── Left Activity Bar ────────────────────────────────────────── */}
        <ActivityBar 
          side="left" 
          tools={leftTools} 
          activeTopId={activeLeftTopId} 
          activeBottomId={activeLeftBottomId} 
          onToggle={handleToggleLeft} 
        />
        
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* ── Top area: Sidebars + Editor ───────────────────────────── */}
          <div className="flex-1 flex min-w-0 overflow-hidden">
            {activeLeftTopTool && (
              <>
                <div style={{ width: leftWidth }} className="shrink-0 flex flex-col">
                  <SidebarTopGroup
                    tool={activeLeftTopTool}
                    onClose={() => setActiveLeftTopId(null)}
                  />
                </div>
                <div
                  {...leftResizeProps}
                  className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </>
            )}

            {/* ── Center Editor ────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                {editor}
              </div>
            </div>

            {activeRightTopTool && (
              <>
                <div
                  {...rightResizeProps}
                  className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
                >
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div style={{ width: rightWidth }} className="shrink-0 flex flex-col">
                  <SidebarTopGroup
                    tool={activeRightTopTool}
                    onClose={() => setActiveRightTopId(null)}
                  />
                </div>
              </>
            )}
          </div>

          {/* ── Bottom Panel Area ────────────────────────────────────── */}
          {(activeLeftBottomTool || activeRightBottomTool) && (
            <div className="shrink-0 flex flex-col bg-[var(--color-surface)]">
              <div
                {...bottomResizeProps}
                className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20"
              >
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div 
                style={{ height: bottomHeight }} 
                className="flex border-t border-[var(--color-border)] overflow-hidden"
              >
                {activeLeftBottomTool && (
                  <div className="flex-1 min-w-0 flex flex-col">
                    <SidebarBottomGroup
                      tool={activeLeftBottomTool}
                      onClose={() => setActiveLeftBottomId(null)}
                    />
                  </div>
                )}
                {activeLeftBottomTool && activeRightBottomTool && (
                  <div className="w-px shrink-0 bg-[var(--color-border)]" />
                )}
                {activeRightBottomTool && (
                  <div className="flex-1 min-w-0 flex flex-col">
                    <SidebarBottomGroup
                      tool={activeRightBottomTool}
                      onClose={() => setActiveRightBottomId(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Activity Bar ───────────────────────────────────────── */}
        {rightTools.length > 0 && (
          <ActivityBar 
            side="right" 
            tools={rightTools} 
            activeTopId={activeRightTopId} 
            activeBottomId={activeRightBottomId} 
            onToggle={handleToggleRight} 
          />
        )}
      </div>
    </div>
  );
}
