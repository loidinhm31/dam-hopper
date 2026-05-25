import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";

export function buildForcePushDialogDescription(
  project: string,
  rootLabel: string,
) {
  return `Overwrite the upstream history for ${project} on ${rootLabel}.`;
}

export function buildForcePushDialogWarning() {
  return "This is destructive. Remote commits that are not in your current local branch will be replaced upstream.";
}

interface GitForcePushDialogProps {
  open: boolean;
  project: string;
  rootLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function GitForcePushDialog({
  open,
  project,
  rootLabel,
  loading,
  onClose,
  onConfirm,
}: GitForcePushDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Force Push</DialogTitle>
          <DialogDescription>
            {buildForcePushDialogDescription(project, rootLabel)}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          {buildForcePushDialogWarning()}
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          DamHopper will force-push the checked-out branch to its configured
          upstream for this selected VCS root only.
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={loading}
            onClick={onConfirm}
          >
            Force Push
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
