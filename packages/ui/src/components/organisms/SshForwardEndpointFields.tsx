import type { ChangeEvent, RefObject } from "react";
import { inputClass } from "@/components/atoms/Button.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type {
  SshForwardProfileDraft,
  SshForwardProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshForwardProfileDraft;
  errors: SshForwardProfileErrors;
  firstInput: RefObject<HTMLInputElement | null>;
  onUpdate: (
    field: keyof SshForwardProfileDraft,
    value: string | boolean,
  ) => void;
}

export function SshForwardEndpointFields({
  draft,
  errors,
  firstInput,
  onUpdate,
}: Props) {
  const input =
    (field: keyof SshForwardProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(field, event.target.value);
  return (
    <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3 sm:grid-cols-2">
      <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        SSH endpoint
      </legend>
      <SshForwardProfileField label="Profile name" error={errors.name}>
        <input
          ref={firstInput}
          className={inputClass}
          value={draft.name}
          onChange={input("name")}
          maxLength={64}
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
        />
      </SshForwardProfileField>
      <SshForwardProfileField label="SSH host" error={errors.sshHost}>
        <input
          className={inputClass}
          value={draft.sshHost}
          onChange={input("sshHost")}
          maxLength={253}
          autoComplete="off"
          aria-invalid={Boolean(errors.sshHost)}
        />
      </SshForwardProfileField>
      <SshForwardProfileField label="SSH port" error={errors.sshPort}>
        <input
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.sshPort}
          onChange={input("sshPort")}
          aria-invalid={Boolean(errors.sshPort)}
        />
      </SshForwardProfileField>
      <SshForwardProfileField label="SSH user" error={errors.sshUser}>
        <input
          className={inputClass}
          value={draft.sshUser}
          onChange={input("sshUser")}
          maxLength={64}
          autoComplete="username"
          aria-invalid={Boolean(errors.sshUser)}
        />
      </SshForwardProfileField>
    </fieldset>
  );
}
