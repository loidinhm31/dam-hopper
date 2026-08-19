import { KeyRound } from "lucide-react";
import { inputClass } from "@/components/atoms/Button.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type { KeyInventory } from "@/lib/ssh-forward-host.js";
import type {
  SshConnectionProfileDraft,
  SshConnectionProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshConnectionProfileDraft;
  errors: SshConnectionProfileErrors;
  keys: KeyInventory["keys"] | null;
  keyError: string | null;
  onUpdate: (
    field: keyof SshConnectionProfileDraft,
    value: string | boolean,
  ) => void;
}

export function SshForwardAuthFields({
  draft,
  errors,
  keys,
  keyError,
  onUpdate,
}: Props) {
  const localKeys = keys?.filter((key) => key.source === "local");
  return (
    <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3 sm:grid-cols-2">
      <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        Authentication
      </legend>
      <SshForwardProfileField label="Authentication">
        <select
          className={inputClass}
          value={draft.authMode}
          onChange={(event) =>
            onUpdate(
              "authMode",
              event.target.value as SshConnectionProfileDraft["authMode"],
            )
          }
        >
          <option value="agent">
            Username/password or SSH agent (recommended)
          </option>
          <option value="key">Local SSH key (passphrase if needed)</option>
        </select>
      </SshForwardProfileField>
      {draft.authMode === "key" ? (
        <SshForwardProfileField
          label="Local SSH key"
          error={errors.keyId}
          errorId="ssh-forward-key-id-error"
        >
          <select
            id="ssh-forward-key-id"
            className={inputClass}
            value={draft.keyId}
            onChange={(event) => onUpdate("keyId", event.target.value)}
            disabled={!keys && !keyError}
            aria-invalid={Boolean(errors.keyId || keyError) || undefined}
            aria-describedby={
              [
                errors.keyId ? "ssh-forward-key-id-error" : null,
                keyError ? "ssh-forward-key-inventory-error" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            <option value="">
              {!keys && !keyError ? "Loading local keys…" : "Select a key"}
            </option>
            {localKeys?.map((key) => (
              <option key={key.keyId} value={key.keyId}>
                {key.label} · {key.algorithm}
              </option>
            ))}
          </select>
          {keyError ? (
            <p
              id="ssh-forward-key-inventory-error"
              role="alert"
              aria-live="assertive"
              className="mt-1 text-[11px] text-[var(--color-danger)]"
            >
              {keyError}
            </p>
          ) : null}
          {localKeys && localKeys.length === 0 ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              No local keys found. Use username/password authentication or an
              SSH agent, or add a key under your user .ssh directory.
            </p>
          ) : null}
        </SshForwardProfileField>
      ) : (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2 text-xs text-[var(--color-text-muted)]">
          <KeyRound className="mb-1 h-4 w-4 text-[var(--color-primary)]" />
          Connect can use username/password without configuring an SSH agent; an
          SSH agent is also supported as a fallback. Native receives no secret
          in the connection profile.
        </div>
      )}
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2 text-xs text-[var(--color-text-muted)] sm:col-span-2">
        Credentials are never part of this profile. Connect explicitly after
        saving; any password or passphrase stays in memory until that attempt.
      </div>
    </fieldset>
  );
}
