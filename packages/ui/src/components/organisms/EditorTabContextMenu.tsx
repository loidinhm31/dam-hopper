import { useEffect, useMemo, useRef } from "react";

export interface EditorTabContextMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface EditorTabContextMenuProps {
  x: number;
  y: number;
  items: EditorTabContextMenuItem[];
  onClose: () => void;
}

export function clampEditorTabContextMenuPosition(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
) {
  return {
    x: Math.min(x, windowWidth - 190),
    y: Math.min(y, windowHeight - 130),
  };
}

export function getEditorTabContextMenuItems(args: {
  tabCount: number;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const { tabCount, onCloseTab, onCloseOthers, onCloseAll } = args;
  return [
    { label: "Close", onSelect: onCloseTab },
    {
      label: "Close Other Tabs",
      disabled: tabCount <= 1,
      onSelect: onCloseOthers,
    },
    { label: "Close All Tabs", onSelect: onCloseAll },
  ] satisfies EditorTabContextMenuItem[];
}

export function EditorTabContextMenu({
  x,
  y,
  items,
  onClose,
}: EditorTabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
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
        position: "absolute",
        top: y,
        left: x,
        zIndex: 70,
      }) as const,
    [x, y],
  );

  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className="w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
