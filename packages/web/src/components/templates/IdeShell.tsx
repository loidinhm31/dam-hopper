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

const ACTIVE_LEFT_KEY = "dam-hopper:ide-active-left";
const ACTIVE_RIGHT_KEY = "dam-hopper:ide-active-right";

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

  const [activeLeftId, setActiveLeftId] = useState<string | null>(() => {
    const stored = localStorage.getItem(ACTIVE_LEFT_KEY);
    if (stored === null) return leftTools.length > 0 ? leftTools[0].id : null;
    return stored === "null" ? null : stored;
  });
  const [activeRightId, setActiveRightId] = useState<string | null>(() => {
    const stored = localStorage.getItem(ACTIVE_RIGHT_KEY);
    if (stored === null) return rightTools.length > 0 ? rightTools[0].id : null;
    return stored === "null" ? null : stored;
  });

  const activeLeftTool = useMemo(() => leftTools.find(t => t.id === activeLeftId), [leftTools, activeLeftId]);
  const activeRightTool = useMemo(() => rightTools.find(t => t.id === activeRightId), [rightTools, activeRightId]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_LEFT_KEY, activeLeftId === null ? "null" : activeLeftId);
  }, [activeLeftId]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_RIGHT_KEY, activeRightId === null ? "null" : activeRightId);
  }, [activeRightId]);

  function handleToggleLeft(id: string) {
    setActiveLeftId(curr => curr === id ? null : id);
  }

  function handleToggleRight(id: string) {
    setActiveRightId(curr => curr === id ? null : id);
  }

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
  const rightPanelRef = useRef<HTMLDivElement>(null);

  function handleVertMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const panel = rightPanelRef.current;
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

  const isDragging = isLeftDragging || isRightDragging || isVertDragging;

  return (
    <div className={cn("flex h-screen overflow-hidden gradient-bg", isDragging && "select-none")}>
      {/* App nav sidebar */}
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      {/* ── Left Side ────────────────────────────────────────────────── */}
      <ActivityBar 
        side="left" 
        tools={leftTools} 
        activeId={activeLeftId} 
        onToggle={handleToggleLeft} 
      />
      
      {activeLeftTool && (
        <>
          <ToolPanel 
            tool={activeLeftTool} 
            width={leftWidth} 
            onClose={() => setActiveLeftId(null)} 
            className="border-r border-[var(--color-border)]"
          />
          <div
            {...leftResizeProps}
            className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </>
      )}

      {/* ── Center: editor + terminal (vertical split) ──────────────── */}
      <div ref={rightPanelRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
      {activeRightTool && (
        <>
          <div
            {...rightResizeProps}
            className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          <ToolPanel 
            tool={activeRightTool} 
            width={rightWidth} 
            onClose={() => setActiveRightId(null)} 
            className="border-l border-[var(--color-border)]"
          />
        </>
      )}

      {rightTools.length > 0 && (
        <ActivityBar 
          side="right" 
          tools={rightTools} 
          activeId={activeRightId} 
          onToggle={handleToggleRight} 
        />
      )}
    </div>
  );
}
