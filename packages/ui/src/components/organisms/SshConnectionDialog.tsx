import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound, Plus, Server, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { SshForwardEndpointFields } from "@/components/organisms/SshForwardEndpointFields.js";
import { SshForwardAuthFields } from "@/components/organisms/SshForwardAuthFields.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";
import {
  draftFromSshConnectionProfile,
  mapSshForwardErrorToFields,
  newSshConnectionDraft,
  validateSshConnectionDraft,
  type SshConnectionProfileDraft,
  type SshConnectionProfileErrors,
} from "@/lib/ssh-forward-form.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";
import type { ServerProfile } from "@/api/server-config.js";
import type {
  KeyInventory,
  SshConnectionProfile,
  SshForwardError,
} from "@/lib/ssh-forward-host.js";

interface Props {
  open: boolean;
  existing: SshConnectionProfile | null;
  sourceProfile: ServerProfile | null;
  pending: boolean;
  error: SshForwardError | null;
  onClose: () => void;
  onSubmit: (draft: SshConnectionProfileDraft) => void;
  onListKeys: () => Promise<KeyInventory>;
}

export function SshConnectionDialog({
  open,
  existing,
  sourceProfile,
  pending,
  error,
  onClose,
  onSubmit,
  onListKeys,
}: Props) {
  const [draft, setDraft] = useState<SshConnectionProfileDraft>(() =>
    existing
      ? draftFromSshConnectionProfile(existing)
      : newSshConnectionDraft(sourceProfile),
  );
  const [errors, setErrors] = useState<SshConnectionProfileErrors>({});
  const [keys, setKeys] = useState<KeyInventory["keys"] | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const keyRequestStarted = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocusTrap(open, pending, onClose, firstInput);

  useEffect(() => {
    if (!open || draft.authMode !== "key" || keys || keyRequestStarted.current)
      return;
    keyRequestStarted.current = true;
    void onListKeys()
      .then((inventory) => setKeys(inventory.keys))
      .catch((nextError) =>
        setKeyError(getSshForwardErrorPresentation(nextError).message),
      );
  }, [draft.authMode, keys, onListKeys, open]);

  if (!open) return null;

  const update = (
    field: keyof SshConnectionProfileDraft,
    value: string | boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "sshHost" || field === "sshPort" || field === "sshUser"
        ? { reviewed: false }
        : {}),
    }));
    if (field === "authMode" && value === "agent") {
      keyRequestStarted.current = false;
      setKeys(null);
      setKeyError(null);
    }
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      form: undefined,
      reviewed: undefined,
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const nextErrors = validateSshConnectionDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit(draft);
  };
  const errorPresentation = error
    ? getSshForwardErrorPresentation(error)
    : null;
  const displayedErrors: SshConnectionProfileErrors = {
    ...(error ? mapSshForwardErrorToFields(error, "connection") : {}),
    ...errors,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !pending && onClose()
      }
    >
      <div
        ref={dialogRef}
        className="dialog-viewport-fit relative max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-connection-title"
        aria-describedby="ssh-connection-description"
      >
        <div className="mb-4 flex items-start gap-2">
          {existing ? (
            <Server className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
          ) : (
            <Plus className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="ssh-connection-title"
              className="text-sm font-semibold text-[var(--color-text)]"
            >
              {existing ? "Edit SSH connection" : "Add SSH connection"}
            </h2>
            <p
              id="ssh-connection-description"
              className="mt-1 text-xs text-[var(--color-text-muted)]"
            >
              Save the credential-free endpoint first. Connect separately when
              you are ready to verify trust and authenticate.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label="Close SSH connection dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!existing && sourceProfile ? (
          <p className="mb-3 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 px-3 py-2 text-xs text-[var(--color-text-muted)]">
            Defaulted from{" "}
            <strong className="text-[var(--color-text)]">
              {sourceProfile.name}
            </strong>
            . Review the endpoint before saving.
          </p>
        ) : null}
        {errorPresentation ? (
          <p
            role="alert"
            className="mb-3 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            {errorPresentation.message}
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-4" aria-live="polite">
          <SshForwardEndpointFields
            draft={draft}
            errors={displayedErrors}
            onUpdate={update}
            firstInput={firstInput}
          />
          <SshForwardAuthFields
            draft={draft}
            errors={displayedErrors}
            keys={keys}
            keyError={keyError}
            onUpdate={update}
          />
          <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3 text-xs text-[var(--color-text-muted)]">
            <input
              id="ssh-connection-reviewed"
              type="checkbox"
              checked={draft.reviewed}
              onChange={(event) => update("reviewed", event.target.checked)}
              className="mt-0.5"
              aria-invalid={Boolean(displayedErrors.reviewed)}
              aria-describedby={
                displayedErrors.reviewed
                  ? "ssh-connection-reviewed-error"
                  : undefined
              }
            />
            <span>
              I reviewed the SSH endpoint, host key policy, user, and selected
              authentication method before saving.
            </span>
          </label>
          {displayedErrors.reviewed ? (
            <p
              id="ssh-connection-reviewed-error"
              role="alert"
              className="text-xs text-[var(--color-danger)]"
            >
              {displayedErrors.reviewed}
            </p>
          ) : null}
          {displayedErrors.form ? (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {displayedErrors.form}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              <KeyRound className="h-3.5 w-3.5" /> Save connection
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
