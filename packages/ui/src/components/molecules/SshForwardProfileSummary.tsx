import { SshForwardSecurityCallout } from "@/components/molecules/SshForwardSecurityCallout.js";
import type {
  SshForwardProfile,
  SshForwardRuntime,
  WireCounter,
} from "@/lib/ssh-forward-host.js";

export function SshForwardProfileSummary({
  profile,
  runtime,
  generation,
}: {
  profile: SshForwardProfile;
  runtime?: SshForwardRuntime;
  generation: WireCounter;
}) {
  return (
    <>
      <div className="grid gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-2 lg:grid-cols-4">
        <Info
          label="Authentication"
          value={
            profile.auth.mode === "agent"
              ? "OS agent"
              : `Safe key · ${profile.auth.keyId}`
          }
        />
        <Info label="Generation" value={generation} />
        <Info
          label="Retry attempt"
          value={String(runtime?.retryAttempt ?? 0)}
        />
        <Info
          label="Active channels"
          value={String(runtime?.activeChannels ?? 0)}
        />
        <Info
          label="Auto-start"
          value={runtime?.autoStartDisposition ?? "notRequested"}
        />
        <Info
          label="Reconnect"
          value={
            profile.reconnect.enabled
              ? `up to ${profile.reconnect.maxAttempts}`
              : "disabled"
          }
        />
      </div>
      <SshForwardSecurityCallout localPort={profile.localPort} />
    </>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-[var(--color-text)]">{value}</span>
    </div>
  );
}
