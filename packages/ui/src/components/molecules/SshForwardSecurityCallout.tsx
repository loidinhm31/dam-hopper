import { ShieldAlert } from "lucide-react";

interface Props {
  localPort: number;
}

export function SshForwardSecurityCallout({ localPort }: Props) {
  return (
    <aside
      role="note"
      className="flex gap-3 rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
      <div className="space-y-1 text-[var(--color-text-muted)]">
        <p className="font-medium text-[var(--color-text)]">
          Local process access is not isolated.
        </p>
        <p>
          Any process on this computer can connect to{" "}
          <code className="font-mono text-[var(--color-text)]">
            127.0.0.1:{localPort}
          </code>{" "}
          and use this forward. Loopback prevents LAN access; it does not
          isolate other local processes.
        </p>
        <p>
          SSH encryption begins inside the native SSH client toward the SSH
          server; the local process-to-listener hop is not encrypted.
        </p>
      </div>
    </aside>
  );
}
