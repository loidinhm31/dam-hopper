import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useUnmarkProject } from "@/api/queries.js";

export interface UnmarkProjectDialogProps {
  open: boolean;
  projectName: string;
  profileId?: string;
  onSuccess?: () => void;
  onCancel: () => void;
}

export function UnmarkProjectDialog({
  open,
  projectName,
  profileId,
  onSuccess,
  onCancel,
}: UnmarkProjectDialogProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const unmarkMutation = useUnmarkProject({ profileId });

  const handleConfirm = async () => {
    if (unmarkMutation.isPending) return;
    setErrorMessage(null);
    try {
      await unmarkMutation.mutateAsync(projectName);
      onSuccess?.();
      onCancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !unmarkMutation.isPending) {
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="unmark-project-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[var(--color-danger)] shrink-0" />
            <DialogTitle>Unmark Project</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to unmark <strong className="text-[var(--color-text)]">{projectName}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 text-xs space-y-3 text-[var(--color-text-muted)]">
          <p>
            This removes the project entry from your workspace configuration. Associated project settings, commands, and tags will be removed.
          </p>
          <p className="p-2.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)]">
            <strong>Note:</strong> Files on disk and running terminal processes will remain intact and will not be deleted or terminated.
          </p>

          {errorMessage && (
            <div
              data-testid="unmark-project-error"
              className="flex items-start gap-2 p-3 text-xs rounded bg-red-500/10 border border-red-500/20 text-red-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={unmarkMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="unmark-project-confirm"
            onClick={handleConfirm}
            disabled={unmarkMutation.isPending}
          >
            {unmarkMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Unmarking…
              </>
            ) : (
              "Unmark Project"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
