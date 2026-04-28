import { useRef, useState, type ReactNode, useMemo, useEffect } from "react";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";
import { useResizeHandle } from "@/hooks/useResizeHandle.js";
import { cn } from "@/lib/utils.js";
import type { ToolWindowDef } from "@/types/ide.js";
import { ActivityBar } from "@/components/organisms/ActivityBar.js";
import { ToolPanel } from "@/components/organisms/ToolPanel.js";

const TREE_WIDTH_KEY = "dam-hopper:ide-tree-width";
const TERMINAL_TREE_WIDTH_KEY = "dam-hopper:ide-terminal-tree-width";
const EDITOR_HEIGHT_KEY = "dam-hopper:ide-editor-height-pct";

const LEFT_TOP_KEY = "dam-hopper:ide-left-top";
const LEFT_BOTTOM_KEY = "dam-hopper:ide-left-bottom";
const RIGHT_TOP_KEY = "dam-hopper:ide-right-top";
const RIGHT_BOTTOM_KEY = "dam-hopper:ide-right-bottom";

const LEFT_SPLIT_KEY = "dam-hopper:ide-left-split";
const RIGHT_SPLIT_KEY = "dam-hopper:ide-right-split";

interface IdeShellProps {
  leftTools: ToolWindowDef[];
  rightTools: ToolWindowDef[];
  editor: ReactNode;
  terminal: ReactNode;
  hideEditor?: boolean;
}

export function IdeShell({ leftTools, rightTools, editor, terminal, hideEditor = false }: IdeShellProps) {
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

  // Vertical: sidebar top/bottom split
  const [leftSplitPct, setLeftSplitPct] = useState<number>(() => {
    const stored = localStorage.getItem(LEFT_SPLIT_KEY);
    return stored ? parseInt(stored, 10) : 50;
  });
  const [rightSplitPct, setRightSplitPct] = useState<number>(() => {
    const stored = localStorage.getItem(RIGHT_SPLIT_KEY);
    return stored ? parseInt(stored, 10) : 50;
  });

  const [isLeftVertDragging, setIsLeftVertDragging] = useState(false);
  const [isRightVertDragging, setIsRightVertDragging] = useState(false);

  function createVertMouseDown(
    pct: number,
    setPct: (v: number | ((v: number) => number)) => void,
    setIsDragging: (v: boolean) => void,
    storageKey: string,
    containerRef: React.RefObject<HTMLDivElement | null>
  ) {
    return function handleMouseDown(e: React.MouseEvent) {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const startY = e.clientY;
      const startPct = pct;
      const totalH = container.getBoundingClientRect().height;

      setIsDragging(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(ev: MouseEvent) {
        const newPct = Math.min(Math.max(startPct + ((ev.clientY - startY) / totalH) * 100, 10), 90);
        setPct(newPct);
      }

      function onMouseUp() {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsDragging(false);
        setPct((pct) => {
          localStorage.setItem(storageKey, String(Math.round(pct)));
          return pct;
        });
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };
  }

  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const rightSidebarRef = useRef<HTMLDivElement>(null);

  const handleLeftVertMouseDown = createVertMouseDown(leftSplitPct, setLeftSplitPct, setIsLeftVertDragging, LEFT_SPLIT_KEY, leftSidebarRef);
  const handleRightVertMouseDown = createVertMouseDown(rightSplitPct, setRightSplitPct, setIsRightVertDragging, RIGHT_SPLIT_KEY, rightSidebarRef);

  // Vertical: editor / terminal split
  const [editorPct, setEditorPct] = useState<number>(() => {
    const stored = localStorage.getItem(EDITOR_HEIGHT_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (!isNaN(v)) return Math.min(Math.max(v, 20), 85);
    }
    return 70;
  });
  const [isVertDragging, setIsVertDragging] = useState(false);
  const centerPanelRef = useRef<HTMLDivElement>(null);

  function handleVertMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const panel = centerPanelRef.current;
    if (!panel) return;
    const startY = e.clientY;
    const startPct = editorPct;
    const totalH = panel.getBoundingClientRect().height;

    setIsVertDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const newPct = Math.min(Math.max(startPct + ((ev.clientY - startY) / totalH) * 100, 20), 85);
      setEditorPct(newPct);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsVertDragging(false);
      setEditorPct((pct) => {
        localStorage.setItem(EDITOR_HEIGHT_KEY, String(Math.round(pct)));
        return pct;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  const isDragging = isLeftDragging || isRightDragging || isVertDragging || isLeftVertDragging || isRightVertDragging;

  return (
    <div className={cn("flex h-screen overflow-hidden gradient-bg", isDragging && "select-none")}>
      {/* App nav sidebar */}
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      {/* ── Left Side ────────────────────────────────────────────────── */}
      <ActivityBar 
        side="left" 
        tools={leftTools} 
        activeTopId={activeLeftTopId} 
        activeBottomId={activeLeftBottomId} 
        onToggle={handleToggleLeft} 
      />
      
      {(activeLeftTopTool || activeLeftBottomTool) && (
        <>
          <div 
            ref={leftSidebarRef}
            style={{ width: leftWidth }} 
            className="shrink-0 flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)]"
          >
            {activeLeftTopTool && (
              <ToolPanel 
                tool={activeLeftTopTool} 
                width={leftWidth} 
                onClose={() => setActiveLeftTopId(null)} 
                style={activeLeftBottomTool ? { height: `${leftSplitPct}%` } : undefined}
                className={activeLeftBottomTool ? "border-b border-[var(--color-border)]" : "flex-1"}
              />
            )}
            
            {activeLeftTopTool && activeLeftBottomTool && (
              <div
                onMouseDown={handleLeftVertMouseDown}
                className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20"
              >
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {activeLeftBottomTool && (
              <ToolPanel 
                tool={activeLeftBottomTool} 
                width={leftWidth} 
                onClose={() => setActiveLeftBottomId(null)} 
                className="flex-1"
              />
            )}
          </div>
          <div
            {...leftResizeProps}
            className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </>
      )}

      {/* ── Center: editor + terminal (vertical split) ──────────────── */}
      <div ref={centerPanelRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!hideEditor && (
          <>
            <div style={{ height: `${editorPct}%` }} className="overflow-hidden">
              {editor}
            </div>
            <div
              onMouseDown={handleVertMouseDown}
              className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20 border-t border-[var(--color-border)]"
            >
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </>
        )}
        <div className="flex-1 min-h-0 overflow-hidden">
          {terminal}
        </div>
      </div>

      {/* ── Right Side ───────────────────────────────────────────────── */}
      {(activeRightTopTool || activeRightBottomTool) && (
        <>
          <div
            {...rightResizeProps}
            className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          <div 
            ref={rightSidebarRef}
            style={{ width: rightWidth }} 
            className="shrink-0 flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)]"
          >
            {activeRightTopTool && (
              <ToolPanel 
                tool={activeRightTopTool} 
                width={rightWidth} 
                onClose={() => setActiveRightTopId(null)} 
                style={activeRightBottomTool ? { height: `${rightSplitPct}%` } : undefined}
                className={activeRightBottomTool ? "border-b border-[var(--color-border)]" : "flex-1"}
              />
            )}
            
            {activeRightTopTool && activeRightBottomTool && (
              <div
                onMouseDown={handleRightVertMouseDown}
                className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20"
              >
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {activeRightBottomTool && (
              <ToolPanel 
                tool={activeRightBottomTool} 
                width={rightWidth} 
                onClose={() => setActiveRightBottomId(null)} 
                className="flex-1"
              />
            )}
          </div>
        </>
      )}

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
  );
}
