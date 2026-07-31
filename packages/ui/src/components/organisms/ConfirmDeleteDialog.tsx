import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";

interface Props {
  open: boolean;
  paths: string[];
  hasDirectory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  paths,
  hasDirectory,
  onConfirm,
  onCancel,
  loading = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel, onConfirm, loading]);

  if (!open) return null;

  const itemCount = paths.length;
  const name = paths[0]?.split("/").pop() ?? "";
  const isBulk = itemCount > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !loading && onCancel()}
      />
      <form
        className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading) onConfirm();
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="h-4 w-4 text-[var(--color-danger)] shrink-0" />
          <h2
            id="delete-dialog-title"
            className="text-sm font-semibold text-[var(--color-text)] flex-1"
          >
            Delete{" "}
            {isBulk ? `${itemCount} items` : hasDirectory ? "folder" : "file"}
          </h2>
          <button
            type="button"
            onClick={() => !loading && onCancel()}
            disabled={loading}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)] mb-1">
          {hasDirectory
            ? "This will recursively delete the folder and all its contents."
            : "This will permanently delete the file."}
        </p>
        <p className="text-xs font-mono text-[var(--color-text)] bg-[var(--color-surface-2)] rounded px-2 py-1 mb-4 truncate">
          {isBulk ? `${itemCount} selected items` : name}
        </p>

        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => !loading && onCancel()}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={loading}
            disabled={loading}
          >
            Delete
          </Button>
        </div>
      </form>
    </div>
  );
}
