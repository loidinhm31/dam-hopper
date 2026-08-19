import { Copy } from "lucide-react";
import { SSH_FORWARD_REMEDIATION_COPY } from "@/lib/ssh-forward-error-copy.js";
import {
  buildTrustRepairRemoveCommand,
  buildTrustRepairRestoreCommand,
} from "@/lib/ssh-forward-trust-repair-command.js";
import type {
  SshConnectionProfile,
  SshForwardProfile,
  SshForwardTrustRepairMetadata,
} from "@/lib/ssh-forward-host.js";

interface Props {
  profile: Pick<
    SshForwardProfile | SshConnectionProfile,
    "scopeId" | "sshHost" | "sshPort"
  >;
  metadata?: SshForwardTrustRepairMetadata;
  fixedError?: string;
}

export function SshHostKeyChangedPanel({
  profile,
  metadata,
  fixedError,
}: Props) {
  const removeCommand = metadata
    ? buildTrustRepairRemoveCommand(metadata.executablePath, profile)
    : null;
  const restoreCommand = metadata
    ? buildTrustRepairRestoreCommand(metadata.executablePath, profile.scopeId)
    : null;
  return (
    <div className="space-y-3">
      <p className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
        {SSH_FORWARD_REMEDIATION_COPY}
      </p>
      {fixedError ? (
        <p className="text-xs text-[var(--color-text-muted)]">{fixedError}</p>
      ) : null}
      {metadata ? (
        <>
          <dl className="grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3 text-xs">
            <Detail label="Resolved trust path" value={metadata.trustPath} />
            <Detail label="Signed executable" value={metadata.executablePath} />
          </dl>
          <CommandBlock
            label="Run from Command Prompt after quitting DamHopper"
            command={removeCommand}
          />
          <CommandBlock
            label={`Recovery command for backup ID (scope ${profile.scopeId})`}
            command={restoreCommand}
          />
        </>
      ) : (
        <p className="text-xs text-[var(--color-danger)]">
          Trust-repair metadata is unavailable. Keep the app closed and contact
          the administrator; no trust override is offered.
        </p>
      )}
      <p className="text-xs text-[var(--color-text-muted)]">
        The repair creates a protected backup and may quarantine removed public
        records. Keep the backup ID, then reopen, compare the new unknown
        fingerprint exactly, approve it, and press Connect.
      </p>
    </div>
  );
}

function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string | null;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      {command ? (
        <div className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-[var(--color-text)]">
            {command}
          </code>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            aria-label={`Copy ${label}`}
            onClick={() => void navigator.clipboard?.writeText(command)}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-danger)]">Unavailable.</p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="break-all font-mono text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
