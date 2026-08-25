import type { RefObject } from "react";
import { CheckCircle2 } from "lucide-react";
import type { HostKeyChallenge } from "@/lib/ssh-forward-host.js";

interface Props {
  challenge: HostKeyChallenge;
  approved: boolean;
  pending: boolean;
  firstAction: RefObject<HTMLButtonElement | null>;
  onApprove: () => void;
}

export function SshHostKeyUnknownPanel({
  challenge,
  approved,
  pending,
  firstAction,
  onApprove,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-text-muted)]">
        Verify this fingerprint with the server administrator or another trusted
        out-of-band channel before approving it.
      </p>
      <dl className="grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3 text-xs sm:grid-cols-2">
        <Detail
          label="Endpoint"
          value={`${challenge.sshHost}:${challenge.sshPort}`}
        />
        <Detail label="Algorithm" value={challenge.algorithm} />
        <Detail label="SHA-256 fingerprint" value={challenge.fingerprint} />
        <Detail label="Runtime generation" value={challenge.generation} />
        <Detail label="Expires" value={challenge.expiresAt} />
      </dl>
      {approved ? (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-[var(--color-success)]"
        >
          <CheckCircle2 className="h-4 w-4" />
          Approved; press Connect to establish this SSH connection.
        </p>
      ) : (
        <button
          ref={firstAction}
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onApprove}
          disabled={pending}
        >
          {pending ? "Approving…" : "Approve exact fingerprint"}
        </button>
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
