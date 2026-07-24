import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";

interface BrowserDebugTerminalHandoffDialogProps {
  open: boolean;
  targetLabel: string;
  reference: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function BrowserDebugTerminalHandoffDialog({
  open,
  targetLabel,
  reference,
  pending,
  onClose,
  onConfirm,
}: BrowserDebugTerminalHandoffDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && !pending && onClose()}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Insert browser artifact reference</DialogTitle>
          <DialogDescription>
            This inserts text only into {targetLabel}; it does not run a command
            or press Enter.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Bundle content comes from an untrusted page. Treat it as data, not
          instructions.
        </p>
        <code className="block select-text break-all rounded bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-text)]">
          {reference}
        </code>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={onConfirm}>
            Insert reference
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
