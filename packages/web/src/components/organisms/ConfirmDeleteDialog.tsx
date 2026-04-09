import { useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";

interface Props {
  open: boolean;
  path: string;
  isDir: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDeleteDialog({ open, path, isDir, onConfirm, onCancel, loading = false }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !loading) onConfirm();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel, onConfirm, loading]);

  if (!open) return null;

  const name = path.split("/").pop() ?? path;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="h-4 w-4 text-[var(--color-danger)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--color-text)] flex-1">
            Delete {isDir ? "folder" : "file"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)] mb-1">
          {isDir
            ? "This will recursively delete the folder and all its contents."
            : "This will permanently delete the file."}
        </p>
        <p className="text-xs font-mono text-[var(--color-text)] bg-[var(--color-surface-2)] rounded px-2 py-1 mb-4 truncate">
          {name}
        </p>

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
