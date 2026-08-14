import type { ChangeEvent } from "react";
import { inputClass } from "@/components/atoms/Button.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type {
  SshForwardProfileDraft,
  SshForwardProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshForwardProfileDraft;
  errors: SshForwardProfileErrors;
  onUpdate: (
    field: keyof SshForwardProfileDraft,
    value: string | boolean,
  ) => void;
}

export function SshForwardTargetFields({ draft, errors, onUpdate }: Props) {
  const input =
    (field: keyof SshForwardProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(field, event.target.value);
  return (
    <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3 sm:grid-cols-2">
      <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        Forward targets
      </legend>
      <SshForwardProfileField
        label="Desktop loopback port"
        error={errors.localPort}
      >
        <input
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.localPort}
          onChange={input("localPort")}
          aria-invalid={Boolean(errors.localPort)}
        />
      </SshForwardProfileField>
      <SshForwardProfileField
        label="Remote loopback port"
        error={errors.targetPort}
      >
        <input
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.targetPort}
          onChange={input("targetPort")}
          aria-invalid={Boolean(errors.targetPort)}
        />
      </SshForwardProfileField>
      <div className="sm:col-span-2">
        <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Remote host
        </span>
        <code className="mt-1 block rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-[var(--color-text)]">
          127.0.0.1 (fixed)
        </code>
      </div>
    </fieldset>
  );
}
