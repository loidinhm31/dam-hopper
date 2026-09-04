import { useEffect, useRef, useState } from "react";
import { Download, Pencil } from "lucide-react";
import { ContextMenu } from "@/components/ui/ContextMenu.js";

export type TerminalDiagnosticsMenuHandler = (
  sessionId: string,
  x: number,
  y: number,
) => void;

export function openTerminalDiagnosticsContextMenu(
  event: {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  sessionId: string,
  onOpenDiagnosticsMenu?: TerminalDiagnosticsMenuHandler,
) {
  if (!onOpenDiagnosticsMenu) return;
  event.preventDefault();
  event.stopPropagation();
  onOpenDiagnosticsMenu(sessionId, event.clientX, event.clientY);
}

interface TerminalDiagnosticsContextMenuProps {
  x: number;
  y: number;
  isPending: boolean;
  isAlive?: boolean;
  error: string | null;
  onExport: () => void;
  onRename?: () => void;
  onClose: () => void;
}

/**
 * The menu is rendered near WorkspacePage because export state is lifted
 * there. A local hidden trigger lets Radix receive the original pointer
 * coordinates without reimplementing its placement or collision logic.
 */
export function TerminalDiagnosticsContextMenu({
  x,
  y,
  isPending,
  isAlive = true,
  error,
  onExport,
  onRename,
  onClose,
}: TerminalDiagnosticsContextMenuProps) {
  // The synthetic trigger event below opens this controlled menu and supplies
  // Radix with its pointer coordinates. Starting closed avoids an unanchored
  // initial open state.
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, [x, y]);

  return (
    <ContextMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) onClose();
      }}
    >
      <ContextMenu.Trigger ref={triggerRef}>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="w-48">
          <ContextMenu.Item
            onSelect={() => {
              setOpen(false);
              onClose();
              onRename?.();
            }}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item
            disabled={isPending || !isAlive}
            onSelect={onExport}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            {isPending ? "Exporting…" : "Export Diagnostics"}
          </ContextMenu.Item>
          {error && (
            <p
              role="alert"
              className="max-h-24 overflow-auto border-t border-[var(--color-border)] px-3 pt-1.5 text-[10px] leading-snug text-[var(--color-danger)]"
            >
              {error}
            </p>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
