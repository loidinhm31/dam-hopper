import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";

interface ConflictDialogProps {
  open: boolean;
  fileName: string;
  onReload: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}

export function ConflictDialog({
  open,
  fileName,
  onReload,
  onOverwrite,
  onCancel,
}: ConflictDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--color-text)] flex-1">
            Save Conflict
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)] mb-5">
          <span className="font-medium text-[var(--color-text)]">{fileName}</span> was modified
          on disk since you last loaded it. Your local changes will be lost if you reload.
        </p>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onReload}>
            Reload from disk
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={onOverwrite}>
            Overwrite
          </Button>
        </div>
      </div>
    </div>
  );
}
