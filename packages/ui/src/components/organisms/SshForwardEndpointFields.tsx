import type { ChangeEvent, RefObject } from "react";
import { inputClass } from "@/components/atoms/Button.js";
import { SshForwardProfileField } from "@/components/organisms/SshForwardProfileField.js";
import type {
  SshConnectionProfileDraft,
  SshConnectionProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshConnectionProfileDraft;
  errors: SshConnectionProfileErrors;
  firstInput: RefObject<HTMLInputElement | null>;
  onUpdate: (
    field: keyof SshConnectionProfileDraft,
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
    (field: keyof SshConnectionProfileDraft) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      onUpdate(field, event.target.value);
  return (
    <fieldset className="grid gap-3 rounded border border-[var(--color-border)] p-3 sm:grid-cols-2">
      <legend className="px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        SSH endpoint
      </legend>
      <SshForwardProfileField
        label="Connection name"
        error={errors.name}
        errorId="ssh-connection-name-error"
      >
        <input
          id="ssh-connection-name"
          ref={firstInput}
          className={inputClass}
          value={draft.name}
          onChange={input("name")}
          maxLength={64}
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={
            errors.name ? "ssh-connection-name-error" : undefined
          }
        />
      </SshForwardProfileField>
      <SshForwardProfileField
        label="SSH host"
        error={errors.sshHost}
        errorId="ssh-connection-host-error"
      >
        <input
          id="ssh-connection-host"
          className={inputClass}
          value={draft.sshHost}
          onChange={input("sshHost")}
          maxLength={253}
          autoComplete="off"
          aria-invalid={Boolean(errors.sshHost)}
          aria-describedby={
            errors.sshHost ? "ssh-connection-host-error" : undefined
          }
        />
      </SshForwardProfileField>
      <SshForwardProfileField
        label="SSH port"
        error={errors.sshPort}
        errorId="ssh-connection-port-error"
      >
        <input
          id="ssh-connection-port"
          className={inputClass}
          type="text"
          inputMode="numeric"
          maxLength={5}
          value={draft.sshPort}
          onChange={input("sshPort")}
          aria-invalid={Boolean(errors.sshPort)}
          aria-describedby={
            errors.sshPort ? "ssh-connection-port-error" : undefined
          }
        />
      </SshForwardProfileField>
      <SshForwardProfileField
        label="SSH user"
        error={errors.sshUser}
        errorId="ssh-connection-user-error"
      >
        <input
          id="ssh-connection-user"
          className={inputClass}
          value={draft.sshUser}
          onChange={input("sshUser")}
          maxLength={64}
          autoComplete="username"
          aria-invalid={Boolean(errors.sshUser)}
          aria-describedby={
            errors.sshUser ? "ssh-connection-user-error" : undefined
          }
        />
      </SshForwardProfileField>
    </fieldset>
  );
}
