import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

export function clampBranchContextMenuPosition(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
) {
  return {
    x: Math.min(x, windowWidth - 190),
    y: Math.min(y, windowHeight - 96),
  };
}

export function getDeleteBranchMenuState({
  isCurrent,
}: {
  isCurrent: boolean;
}) {
  return {
    disabled: isCurrent,
    title: isCurrent
      ? "Cannot delete the checked-out branch"
      : undefined,
  };
}

interface GitBranchContextMenuProps {
  x: number;
  y: number;
  branchName: string;
  isCurrent: boolean;
  onDelete: () => void;
  onClose: () => void;
}

export function GitBranchContextMenu({
  x,
  y,
  branchName,
  isCurrent,
  onDelete,
  onClose,
}: GitBranchContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const deleteState = getDeleteBranchMenuState({ isCurrent });

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

  const style = useMemo(
    () =>
      ({
        position: "fixed",
        top: y,
        left: x,
        zIndex: 70,
      }) as const,
    [x, y],
  );

  return (
    typeof document === "undefined"
      ? null
      : createPortal(
          <div
            ref={ref}
            role="menu"
            style={style}
            className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              {branchName}
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={deleteState.disabled}
              title={deleteState.title}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              onPointerDown={(event) => {
                if (deleteState.disabled) return;
                event.preventDefault();
                event.stopPropagation();
                onDelete();
              }}
              onClick={(event) => {
                if (deleteState.disabled || event.detail !== 0) return;
                onDelete();
              }}
            >
              Delete branch
            </button>
          </div>,
          document.body,
        )
  );
}
