import { Plus, Server, X } from "lucide-react";
import type { SshForwardProfile } from "@/lib/ssh-forward-host.js";

export function SshForwardProfileDialogHeader({
  existing,
  onClose,
  pending,
}: {
  existing: SshForwardProfile | null;
  onClose: () => void;
  pending: boolean;
}) {
  return (
    <div className="mb-4 flex items-start gap-2">
      {existing ? (
        <Server className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
      ) : (
        <Plus className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
      )}
      <div className="min-w-0 flex-1">
        <h2
          id="ssh-forward-profile-title"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          {existing ? "Edit SSH forward" : "Add SSH forward"}
        </h2>
        <p
          id="ssh-forward-profile-description"
          className="mt-1 text-xs text-[var(--color-text-muted)]"
        >
          SSH endpoint, local listener, and the fixed remote loopback target.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        aria-label="Close profile dialog"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
