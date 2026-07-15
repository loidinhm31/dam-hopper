import { useEffect, useMemo, useRef } from "react";
import { Download } from "lucide-react";

const MENU_WIDTH = 192;
const MENU_HEIGHT = 96;
const VIEWPORT_MARGIN = 8;

interface TerminalDiagnosticsContextMenuProps {
  x: number;
  y: number;
  isPending: boolean;
  error: string | null;
  onExport: () => void;
  onClose: () => void;
}

export function clampTerminalDiagnosticsContextMenuPosition(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
) {
  return {
    x: Math.max(
      VIEWPORT_MARGIN,
      Math.min(x, windowWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    ),
    y: Math.max(
      VIEWPORT_MARGIN,
      Math.min(y, windowHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
    ),
  };
}

export function TerminalDiagnosticsContextMenu({
  x,
  y,
  isPending,
  error,
  onExport,
  onClose,
}: TerminalDiagnosticsContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const position = useMemo(
    () =>
      clampTerminalDiagnosticsContextMenuPosition(
        x,
        y,
        window.innerWidth,
        window.innerHeight,
      ),
    [x, y],
  );

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        top: position.y,
        left: position.x,
        zIndex: 70,
      }}
      className="w-48 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        disabled={isPending}
        onClick={onExport}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        {isPending ? "Exporting…" : "Export Diagnostics"}
      </button>
      {error && (
        <p
          role="alert"
          className="border-t border-[var(--color-border)] px-3 pt-1.5 text-[10px] leading-snug text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
