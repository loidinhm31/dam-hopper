import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Grip, Move, X } from "lucide-react";
import {
  clampTerminalFloatingPanelLayout,
  TERMINAL_FILE_PANEL_MARGIN,
  type TerminalFloatingFilePanelLayout,
} from "@/lib/terminal-floating-file-panel-state.js";

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
}

export function handleTerminalFloatingToolPanelKeyDown(
  event: Pick<KeyboardEvent, "key">,
  onClose: () => void,
) {
  if (event.key !== "Escape") return false;
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
}: TerminalFloatingToolPanelProps) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [layout, setLayout] =
    useState<TerminalFloatingFilePanelLayout>(TOOL_PANEL_LAYOUT);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      handleTerminalFloatingToolPanelKeyDown(event, onClose);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const resolveCurrentFrame = () => {
    const bounds = boundsRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!bounds || !panel) return null;

    return {
      bounds,
      frame: {
        left: panel.left - bounds.left,
        top: panel.top - bounds.top,
        width: panel.width,
        height: panel.height,
      },
    };
  };

  const updateLayout = (
    nextLayout: TerminalFloatingFilePanelLayout,
    bounds: { width: number; height: number },
  ) => setLayout(clampTerminalFloatingToolPanelLayout(nextLayout, bounds));

  const handleDragStart = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const { bounds, frame } = current;
    const startX = event.clientX;
    const startY = event.clientY;
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateLayout(
        {
          width: frame.width,
          height: frame.height,
          top: frame.top + moveEvent.clientY - startY,
          left: frame.left + moveEvent.clientX - startX,
        },
        bounds,
      );
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleResizeStart = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const { bounds, frame } = current;
    const startX = event.clientX;
    const startY = event.clientY;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateLayout(
        {
          width: frame.width + moveEvent.clientX - startX,
          height: frame.height + moveEvent.clientY - startY,
          top: frame.top,
          left: frame.left,
        },
        bounds,
      );
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div ref={boundsRef} className="pointer-events-none absolute inset-0 z-20">
      <section
        ref={panelRef}
        className="pointer-events-auto absolute flex min-h-0 max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-2xl backdrop-blur-xl"
        style={{
          top: layout.top,
          left: layout.left ?? undefined,
          right: layout.left === null ? TERMINAL_FILE_PANEL_MARGIN : undefined,
          width: layout.width,
          height: layout.height,
        }}
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
          className="absolute bottom-2 right-2 rounded-sm p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          title={`Resize ${title} panel`}
          aria-label={`Resize ${title} panel`}
        >
          <Grip className="h-4 w-4" />
        </button>
      </section>
    </div>
  );
}
