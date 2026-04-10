import { useRef, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";
import { useResizeHandle } from "@/hooks/useResizeHandle.js";

const TREE_STORAGE_KEY = "devhub:ide-tree-width";
const EDITOR_STORAGE_KEY = "devhub:ide-editor-height-pct";

interface IdeShellProps {
  tree: ReactNode;
  editor: ReactNode;
  terminal: ReactNode;
  /** When true: skip editor pane + vertical resize handle, terminal fills full right panel */
  hideEditor?: boolean;
}

export function IdeShell({ tree, editor, terminal, hideEditor = false }: IdeShellProps) {
  const { collapsed, toggle } = useSidebarCollapse();

  // Horizontal: file tree width (same pattern as TerminalsPage)
  const {
    width: treeWidth,
    handleProps: treeResizeProps,
    isDragging: isTreeDragging,
  } = useResizeHandle({
    min: 140,
    max: 480,
    defaultWidth: 240,
    storageKey: TREE_STORAGE_KEY,
  });

  // Vertical: editor / terminal split (percentage of right-panel height)
  const [editorPct, setEditorPct] = useState<number>(() => {
    const stored = localStorage.getItem(EDITOR_STORAGE_KEY);
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
      const delta = ev.clientY - startY;
      const newPct = Math.min(Math.max(startPct + (delta / totalH) * 100, 20), 85);
      setEditorPct(newPct);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsVertDragging(false);
      setEditorPct((pct) => {
        localStorage.setItem(EDITOR_STORAGE_KEY, String(Math.round(pct)));
        return pct;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  const isDragging = isTreeDragging || isVertDragging;

  return (
    <div className={`flex h-screen overflow-hidden gradient-bg${isDragging ? " select-none" : ""}`}>
      {/* App sidebar — same as every other page */}
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      {/* File tree panel */}
      <div
        style={{ width: treeWidth }}
        className="shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden"
      >
        {tree}
      </div>

      {/* Horizontal resize handle — identical to TerminalsPage */}
      <div
        {...treeResizeProps}
        className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Right panel: editor on top, terminal on bottom */}
      <div ref={rightPanelRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!hideEditor && (
          <>
            {/* Editor pane */}
            <div style={{ height: `${editorPct}%` }} className="overflow-hidden">
              {editor}
            </div>

            {/* Vertical resize handle */}
            <div
              onMouseDown={handleVertMouseDown}
              className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20 border-t border-[var(--color-border)]"
            >
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </>
        )}

        {/* Terminal pane */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {terminal}
        </div>
      </div>
    </div>
  );
}
