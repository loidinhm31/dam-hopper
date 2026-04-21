import { useRef, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/organisms/Sidebar.js";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse.js";
import { useResizeHandle } from "@/hooks/useResizeHandle.js";
import { Files, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Terminal as TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils.js";

const TREE_WIDTH_KEY = "dam-hopper:ide-tree-width";
const TERMINAL_TREE_WIDTH_KEY = "dam-hopper:ide-terminal-tree-width";
const EDITOR_HEIGHT_KEY = "dam-hopper:ide-editor-height-pct";
const TREE_COLLAPSED_KEY = "dam-hopper:ide-tree-collapsed";
const TERMINAL_TREE_COLLAPSED_KEY = "dam-hopper:ide-terminal-tree-collapsed";

const MINIMAL_WIDTH = 40;

interface IdeShellProps {
  tree: ReactNode;
  editor: ReactNode;
  terminal: ReactNode;
  /** Right-side collapsible sidebar — hosts TerminalTreeView */
  terminalTree?: ReactNode;
  hideEditor?: boolean;
}

export function IdeShell({ tree, editor, terminal, terminalTree, hideEditor = false }: IdeShellProps) {
  const { collapsed, toggle } = useSidebarCollapse();

  // Left: file tree panel
  const {
    width: treeWidth,
    handleProps: treeResizeProps,
    isDragging: isTreeDragging,
  } = useResizeHandle({ min: 140, max: 480, defaultWidth: 240, storageKey: TREE_WIDTH_KEY });

  // Right: terminal tree panel
  const {
    width: terminalTreeWidth,
    handleProps: terminalTreeResizeProps,
    isDragging: isTerminalTreeDragging,
  } = useResizeHandle({ min: 180, max: 480, defaultWidth: 260, storageKey: TERMINAL_TREE_WIDTH_KEY, reversed: true });

  const [treeCollapsed, setTreeCollapsed] = useState<boolean>(() =>
    localStorage.getItem(TREE_COLLAPSED_KEY) === "true",
  );
  const [terminalTreeCollapsed, setTerminalTreeCollapsed] = useState<boolean>(() =>
    localStorage.getItem(TERMINAL_TREE_COLLAPSED_KEY) === "true",
  );

  function toggleTree() {
    setTreeCollapsed((v) => {
      localStorage.setItem(TREE_COLLAPSED_KEY, String(!v));
      return !v;
    });
  }

  function toggleTerminalTree() {
    setTerminalTreeCollapsed((v) => {
      localStorage.setItem(TERMINAL_TREE_COLLAPSED_KEY, String(!v));
      return !v;
    });
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

  const isDragging = isTreeDragging || isTerminalTreeDragging || isVertDragging;

  return (
    <div className={cn("flex h-screen overflow-hidden gradient-bg", isDragging && "select-none")}>
      {/* App nav sidebar */}
      <Sidebar collapsed={collapsed} onToggle={toggle} />

      {/* ── Left: File tree sidebar ──────────────────────────────────── */}
      {treeCollapsed ? (
        <div
          style={{ width: MINIMAL_WIDTH }}
          className="shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center py-2 gap-3"
        >
          <button
            onClick={toggleTree}
            title="Expand file explorer"
            className="p-1.5 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <div className="flex-1 flex items-center justify-center">
            <span
              className="text-[9px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase select-none"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Explorer
            </span>
          </div>
          <Files className="h-4 w-4 text-[var(--color-text-muted)] opacity-40 shrink-0 mb-1" />
        </div>
      ) : (
        <>
          <div
            style={{ width: treeWidth }}
            className="shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden"
          >
            <div className="shrink-0 flex items-center justify-end px-1 pt-1">
              <button
                onClick={toggleTree}
                title="Collapse file explorer"
                className="p-1 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {tree}
            </div>
          </div>

          <div
            {...treeResizeProps}
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

      {/* ── Right: Terminal tree sidebar ─────────────────────────────── */}
      {terminalTree && (
        terminalTreeCollapsed ? (
          <div
            style={{ width: MINIMAL_WIDTH }}
            className="shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col items-center py-2 gap-3"
          >
            <button
              onClick={toggleTerminalTree}
              title="Expand terminal tree"
              className="p-1.5 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
            <div className="flex-1 flex items-center justify-center">
              <span
                className="text-[9px] font-bold tracking-widest text-[var(--color-text-muted)] uppercase select-none"
                style={{ writingMode: "vertical-rl" }}
              >
                Terminals
              </span>
            </div>
            <TerminalIcon className="h-4 w-4 text-[var(--color-text-muted)] opacity-40 shrink-0 mb-1" />
          </div>
        ) : (
          <>
            <div
              {...terminalTreeResizeProps}
              className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div
              style={{ width: terminalTreeWidth }}
              className="shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden"
            >
              <div className="shrink-0 flex items-center justify-start px-1 pt-1">
                <button
                  onClick={toggleTerminalTree}
                  title="Collapse terminal tree"
                  className="p-1 rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {terminalTree}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
