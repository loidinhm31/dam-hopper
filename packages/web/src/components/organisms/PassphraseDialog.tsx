import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";

interface Props {
  open: boolean;
  onSubmit: (passphrase: string, keyPath?: string) => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
  availableKeys?: string[];
}

export function PassphraseDialog({
  open,
  onSubmit,
  onCancel,
  loading = false,
  error,
  availableKeys = [],
}: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPassphrase("");
      setSelectedKey(availableKeys[0] ?? "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, availableKeys]);

  // Escape to cancel
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase || loading) return;
    onSubmit(passphrase, selectedKey || undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--color-text)] flex-1">
            SSH Key Passphrase
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Git operation failed due to SSH authentication. Enter your SSH key passphrase to load it into the agent and retry.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* SSH key selector */}
          {availableKeys.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">
                SSH Key
              </label>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={loading}
                className={cn(inputClass, "pr-8")}
              >
                <option value="">Default key</option>
                {availableKeys.map((k) => (
                  <option key={k} value={k}>
                    ~/.ssh/{k}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Passphrase input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">
              Passphrase
            </label>
            <input
              ref={inputRef}
              type="password"
              autoComplete="off"
              placeholder="Enter passphrase..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading}
              className={inputClass}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 rounded px-2 py-1">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={loading}
              disabled={!passphrase}
            >
              Load Key & Retry
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
