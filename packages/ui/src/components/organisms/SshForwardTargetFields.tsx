import type { ChangeEvent } from "react";
import { inputClass } from "@/components/atoms/Button.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type {
  SshForwardRuleDraft,
  SshForwardRuleErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshForwardRuleDraft;
  errors: SshForwardRuleErrors;
  onUpdate: (field: keyof SshForwardRuleDraft, value: string | boolean) => void;
}

export function SshForwardTargetFields({ draft, errors, onUpdate }: Props) {
  const input =
    (field: keyof SshForwardRuleDraft) =>
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
        errorId="ssh-rule-local-port-error"
      >
        <input
          id="ssh-rule-local-port"
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.localPort}
          onChange={input("localPort")}
          aria-invalid={Boolean(errors.localPort)}
          aria-describedby={
            errors.localPort ? "ssh-rule-local-port-error" : undefined
          }
        />
      </SshForwardProfileField>
      <SshForwardProfileField
        label="Remote loopback port"
        error={errors.targetPort}
        errorId="ssh-rule-target-port-error"
      >
        <input
          id="ssh-rule-target-port"
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.targetPort}
          onChange={input("targetPort")}
          aria-invalid={Boolean(errors.targetPort)}
          aria-describedby={
            errors.targetPort ? "ssh-rule-target-port-error" : undefined
          }
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
