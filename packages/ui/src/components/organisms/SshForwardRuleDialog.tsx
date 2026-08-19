import { useRef, useState, type FormEvent } from "react";
import { Cable, Plus, Server, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import { SshForwardTargetFields } from "@/components/organisms/SshForwardTargetFields.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";
import {
  draftFromSshForwardRule,
  mapSshForwardErrorToFields,
  newSshForwardRuleDraft,
  validateSshForwardRuleDraft,
  type SshForwardRuleDraft,
  type SshForwardRuleErrors,
} from "@/lib/ssh-forward-form.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";
import type {
  SshConnectionProfile,
  SshForwardError,
  SshForwardRule,
} from "@/lib/ssh-forward-host.js";

interface Props {
  open: boolean;
  connection: SshConnectionProfile;
  existing: SshForwardRule | null;
  pending: boolean;
  error: SshForwardError | null;
  onClose: () => void;
  onSubmit: (draft: SshForwardRuleDraft) => void;
}

export function SshForwardRuleDialog({
  open,
  connection,
  existing,
  pending,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<SshForwardRuleDraft>(() =>
    existing ? draftFromSshForwardRule(existing) : newSshForwardRuleDraft(),
  );
  const [errors, setErrors] = useState<SshForwardRuleErrors>({});
  const firstInput = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocusTrap(open, pending, onClose, firstInput);

  if (!open) return null;

  const update = (
    field: keyof SshForwardRuleDraft,
    value: string | boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field !== "reviewed" ? { reviewed: false } : {}),
    }));
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
    const nextErrors = validateSshForwardRuleDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit(draft);
  };
  const errorPresentation = error
    ? getSshForwardErrorPresentation(error)
    : null;
  const displayedErrors: SshForwardRuleErrors = {
    ...(error ? mapSshForwardErrorToFields(error, "rule") : {}),
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
        className="dialog-viewport-fit relative max-h-[calc(100vh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-rule-title"
        aria-describedby="ssh-rule-description"
      >
        <div className="mb-4 flex items-start gap-2">
          {existing ? (
            <Server className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
          ) : (
            <Plus className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
          )}
          <div className="min-w-0 flex-1">
            <h2
              id="ssh-rule-title"
              className="text-sm font-semibold text-[var(--color-text)]"
            >
              {existing ? "Edit forwarding rule" : "Add forwarding rule"}
            </h2>
            <p
              id="ssh-rule-description"
              className="mt-1 text-xs text-[var(--color-text-muted)]"
            >
              Add a loopback port under{" "}
              <strong className="text-[var(--color-text)]">
                {connection.name}
              </strong>
              . Save the desired rule now; Connect establishes SSH before
              starting an enabled listener.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label="Close forwarding rule dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorPresentation ? (
          <p
            role="alert"
            className="mb-3 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            {errorPresentation.message}
          </p>
        ) : null}

        <form onSubmit={submit} className="space-y-4" aria-live="polite">
          <SshForwardProfileField
            label="Rule name"
            error={displayedErrors.name}
            errorId="ssh-rule-name-error"
          >
            <input
              id="ssh-rule-name"
              ref={firstInput}
              className={inputClass}
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              maxLength={64}
              autoComplete="off"
              aria-invalid={Boolean(displayedErrors.name)}
              aria-describedby={
                displayedErrors.name ? "ssh-rule-name-error" : undefined
              }
            />
          </SshForwardProfileField>
          <SshForwardTargetFields
            draft={draft}
            errors={displayedErrors}
            onUpdate={update}
          />
          <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3">
            <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Reconnect intent
            </legend>
            <label className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]">
              <Switch
                checked={draft.reconnectEnabled}
                onCheckedChange={(value) => update("reconnectEnabled", value)}
                ariaLabel="Reconnect this forwarding rule"
              />
              <span>
                Reopen this listener after a temporary SSH loss.
                <span className="mt-0.5 block text-[11px] opacity-80">
                  Existing listeners may wait during reconnect; disable remains
                  available.
                </span>
              </span>
            </label>
            {draft.reconnectEnabled ? (
              <SshForwardProfileField
                label="Maximum reconnect attempts"
                error={displayedErrors.reconnectMaxAttempts}
                errorId="ssh-rule-reconnect-attempts-error"
              >
                <input
                  id="ssh-rule-reconnect-attempts"
                  className={inputClass}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={draft.reconnectMaxAttempts}
                  onChange={(event) =>
                    update("reconnectMaxAttempts", event.target.value)
                  }
                  aria-invalid={Boolean(displayedErrors.reconnectMaxAttempts)}
                  aria-describedby={
                    displayedErrors.reconnectMaxAttempts
                      ? "ssh-rule-reconnect-attempts-error"
                      : undefined
                  }
                />
              </SshForwardProfileField>
            ) : null}
            <label className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={draft.desiredEnabled}
                onChange={(event) =>
                  update("desiredEnabled", event.target.checked)
                }
                className="mt-0.5"
              />
              <span>
                Enable after the parent connection is Established
                <span className="mt-0.5 block text-[11px] opacity-80">
                  No credential prompt opens from a rule toggle.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="flex items-start gap-2 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 p-3 text-xs text-[var(--color-text-muted)]">
            <Cable className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
            <span>
              Remote target is fixed to{" "}
              <code className="font-mono text-[var(--color-text)]">
                127.0.0.1
              </code>{" "}
              on the SSH server. Only the local listener and target port are
              configurable.
            </span>
          </div>
          <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3 text-xs text-[var(--color-text-muted)]">
            <input
              id="ssh-rule-reviewed"
              type="checkbox"
              checked={draft.reviewed}
              onChange={(event) => update("reviewed", event.target.checked)}
              className="mt-0.5"
              aria-invalid={Boolean(displayedErrors.reviewed)}
              aria-describedby={
                displayedErrors.reviewed ? "ssh-rule-reviewed-error" : undefined
              }
            />
            <span>
              I reviewed the local port, fixed loopback target, and reconnect
              behavior.
            </span>
          </label>
          {displayedErrors.reviewed ? (
            <p
              id="ssh-rule-reviewed-error"
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
              <Cable className="h-3.5 w-3.5" /> Save rule
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
