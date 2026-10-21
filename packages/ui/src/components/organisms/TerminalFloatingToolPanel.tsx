import {
  useEffect,
  type ReactNode,
} from "react";
import { Grip, Move, X } from "lucide-react";
import {
  clampTerminalFloatingPanelLayout,
  TERMINAL_FILE_PANEL_MARGIN,
  type TerminalFloatingFilePanelLayout,
} from "@/lib/terminal-floating-file-panel-state.js";
import { TERMINAL_FLOATING_PANEL_BASE_Z_INDEX } from "@/lib/terminal-workspace-panel.js";
import { useFloatingPanelGeometry } from "@/hooks/use-floating-panel-geometry.js";

const TOOL_PANEL_LAYOUT: TerminalFloatingFilePanelLayout = {
  width: 720,
  height: 600,
  top: TERMINAL_FILE_PANEL_MARGIN,
  left: null,
};

const TOOL_PANEL_CONSTRAINTS = {
  minWidth: 480,
  maxWidth: Number.POSITIVE_INFINITY,
  minHeight: 360,
  maxHeight: Number.POSITIVE_INFINITY,
};

interface TerminalFloatingToolPanelProps {
  open: boolean;
  title: string;
  content: ReactNode;
  onClose: () => void;
  zIndex?: number;
  onActivate?: () => void;
  isTopmost?: boolean;
}

export function handleTerminalFloatingToolPanelKeyDown(
  event: Pick<KeyboardEvent, "key"> & {
    stopPropagation?: () => void;
    stopImmediatePropagation?: () => void;
    preventDefault?: () => void;
  },
  onClose: () => void,
  isTopmost = true,
) {
  if (event.key !== "Escape" || !isTopmost) return false;
  event.stopImmediatePropagation?.();
  event.stopPropagation?.();
  event.preventDefault?.();
  onClose();
  return true;
}

export function clampTerminalFloatingToolPanelLayout(
  layout: TerminalFloatingFilePanelLayout,
  bounds: { width: number; height: number },
) {
  return clampTerminalFloatingPanelLayout(
    layout,
    bounds,
    TOOL_PANEL_CONSTRAINTS,
  );
}

export function TerminalFloatingToolPanel({
  open,
  title,
  content,
  onClose,
  zIndex = TERMINAL_FLOATING_PANEL_BASE_Z_INDEX,
  onActivate,
  isTopmost = true,
}: TerminalFloatingToolPanelProps) {
  const {
    boundsRef,
    panelRef,
    layout,
    handleDragStart,
    handleResizeStart,
  } = useFloatingPanelGeometry({
    initialLayout: TOOL_PANEL_LAYOUT,
    clampLayout: clampTerminalFloatingToolPanelLayout,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const activeEl = document.activeElement;
      if (
        panelRef.current &&
        activeEl &&
        activeEl !== document.body &&
        !panelRef.current.contains(activeEl)
      ) {
        return;
      }
      handleTerminalFloatingToolPanelKeyDown(event, onClose, isTopmost);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isTopmost, onClose, open]);

  if (!open) return null;

  return (
    <div
      ref={boundsRef}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className="pointer-events-auto absolute flex min-h-0 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-2xl backdrop-blur-xl"
        style={{
          top: layout.top,
          left: layout.left ?? undefined,
          right: layout.left === null ? TERMINAL_FILE_PANEL_MARGIN : undefined,
          width: layout.width,
          height: layout.height,
        }}
        onPointerDownCapture={onActivate}
        onFocusCapture={onActivate}
        data-testid="terminal-floating-tool-panel"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 px-3">
          <div
            className="flex min-w-0 flex-1 cursor-move items-center gap-2"
            onMouseDown={handleDragStart}
            title={`Drag ${title} panel`}
          >
            <Move className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
            <span className="truncate text-xs font-semibold text-[var(--color-text)]">
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            title={`Close ${title} panel`}
            aria-label={`Close ${title} panel`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
        <button
          type="button"
          onMouseDown={handleResizeStart}
          className="absolute bottom-2 right-2 z-10 rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          title={`Resize ${title} panel`}
          aria-label={`Resize ${title} panel`}
        >
          <Grip className="h-4 w-4" />
        </button>
      </section>
    </div>
  );
}
