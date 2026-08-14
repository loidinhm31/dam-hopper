import type { ChangeEvent } from "react";
import { KeyRound } from "lucide-react";
import { inputClass } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type { KeyInventory, SshForwardError } from "@/lib/ssh-forward-host.js";
import type {
  SshForwardProfileDraft,
  SshForwardProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshForwardProfileDraft;
  errors: SshForwardProfileErrors;
  keys: KeyInventory["keys"] | null;
  keyError: SshForwardError | null;
  onUpdate: (
    field: keyof SshForwardProfileDraft,
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
  const input =
    (field: keyof SshForwardProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(field, event.target.value);
  return (
    <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3 sm:grid-cols-2">
      <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        Authentication and reconnect
      </legend>
      <SshForwardProfileField label="Authentication">
        <select
          className={inputClass}
          value={draft.authMode}
          onChange={(event) =>
            onUpdate(
              "authMode",
              event.target.value as SshForwardProfileDraft["authMode"],
            )
          }
        >
          <option value="agent">OS SSH agent (recommended)</option>
          <option value="key">Safe unencrypted key</option>
        </select>
      </SshForwardProfileField>
      {draft.authMode === "key" ? (
        <SshForwardProfileField label="Safe key" error={errors.keyId}>
          <select
            className={inputClass}
            value={draft.keyId}
            onChange={(event) => onUpdate("keyId", event.target.value)}
            disabled={!keys && !keyError}
          >
            <option value="">
              {!keys && !keyError ? "Loading safe keys…" : "Select a key"}
            </option>
            {keys?.map((key) => (
              <option key={key.keyId} value={key.keyId}>
                {key.label} · {key.algorithm}
              </option>
            ))}
          </select>
          {keyError ? (
            <p className="mt-1 text-[11px] text-[var(--color-danger)]">
              {keyError.message}
            </p>
          ) : null}
          {keys && keys.length === 0 ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              No safe keys found. Load an encrypted key in the OS agent and use
              agent authentication.
            </p>
          ) : null}
        </SshForwardProfileField>
      ) : (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2 text-xs text-[var(--color-text-muted)]">
          <KeyRound className="mb-1 h-4 w-4 text-[var(--color-primary)]" />
          Authentication uses the OS SSH agent. Native receives only the opaque
          key selection.
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Switch
          checked={draft.autoStart}
          onCheckedChange={(value) => onUpdate("autoStart", value)}
          ariaLabel="Auto-start forward"
        />{" "}
        Auto-start when this server scope activates
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Switch
          checked={draft.reconnectEnabled}
          onCheckedChange={(value) => onUpdate("reconnectEnabled", value)}
          ariaLabel="Enable reconnect"
        />{" "}
        Reconnect on SSH loss
      </label>
      {draft.reconnectEnabled ? (
        <SshForwardProfileField
          label="Maximum reconnect attempts"
          error={errors.reconnectMaxAttempts}
        >
          <input
            className={inputClass}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={draft.reconnectMaxAttempts}
            onChange={input("reconnectMaxAttempts")}
            aria-invalid={Boolean(errors.reconnectMaxAttempts)}
          />
        </SshForwardProfileField>
      ) : null}
    </fieldset>
  );
}
