import { useState } from "react";
import { getActiveProfileId } from "@/api/server-config.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import { Button } from "@/components/atoms/Button.js";
import { useLoginDevicesOwner, type LoginDevicesOwner } from "./login-devices-owner.js";
import { useLoginDevices } from "./use-login-devices.js";

/** Mount only inside an open settings dialog; legacy selection is captured once. */
export function LoginDevicesSection({
  profileId,
  onSelfRevoked,
  variant = "dialog",
}: {
  profileId?: string | null;
  onSelfRevoked?: (owner: LoginDevicesOwner) => void;
  variant?: "dialog" | "page";
}) {
  const [legacyProfileId] = useState(() => profileId === undefined ? getActiveProfileId() : null);
  const owner = useLoginDevicesOwner(profileId === undefined ? legacyProfileId : profileId);
  const devices = useLoginDevices(owner, onSelfRevoked);
  const needsLogin = owner?.authType === "basic" && !owner.token;
  const busy = devices.loading || devices.pending !== null || devices.cleanupRequired;

  return (
    <section
      aria-label="Login devices"
      className={`min-w-0 space-y-3 text-xs text-[var(--color-text)] ${
        variant === "page" ? "" : "border-t border-[var(--color-border)] pt-3"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Login devices</h3>
        {owner && !needsLogin && !devices.unavailable && (
          <Button size="sm" variant="secondary" onClick={devices.refresh} disabled={devices.pending !== null || devices.cleanupRequired}>
            Refresh
          </Button>
        )}
      </div>
      <p className="text-[var(--color-text-muted)]">
        Logins for your account on this saved server, across all projects. Browser/client hints are not verified device identities.
      </p>
      {!owner ? <p>Save and select a supported server profile to manage its logins.</p>
        : needsLogin ? <p>Log in and save this profile to manage its logins.</p>
        : devices.unavailable ? <p role="status">Login devices is unavailable on a server running without authentication.</p>
        : <>
          {devices.loading && <p role="status">Loading login devices…</p>}
          {devices.error && <div role="alert" className="space-y-2 break-words text-red-400">
            <p>{devices.error}</p>
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={devices.rows.length ? devices.more : devices.refresh}>Retry</Button>
          </div>}
          {!devices.loading && !devices.error && devices.rows.length === 0 && <p>No active logins found.</p>}
          <ul
            aria-label="Active logins"
            className={`min-w-0 space-y-2 ${
              variant === "page"
                ? ""
                : "max-h-64 overflow-y-auto overscroll-contain"
            }`}
          >
            {devices.rows.map((row) => <li key={row.id} data-session-id={row.id}
              className="min-w-0 space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {row.userAgent || "Unknown browser/client"}
              </p>
              {row.current && <p className="font-semibold text-[var(--color-primary)]">This session</p>}
              <p>Logged in: <time dateTime={row.issuedAt}>{new Date(row.issuedAt).toLocaleString()}</time></p>
              <p>Expires: <time dateTime={row.expiresAt}>{new Date(row.expiresAt).toLocaleString()}</time></p>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => devices.confirm(row)}>
                {devices.pending === row.id ? "Revoking…" : "Revoke access"}
              </Button>
            </li>)}
          </ul>
          {devices.cursor !== null && <Button size="sm" variant="secondary" disabled={busy} onClick={devices.more}>Load more</Button>}
          {devices.mutationError && <div role="alert" className="space-y-2 break-words text-red-400">
            <p>{devices.mutationError}{devices.cleanupRequired ? " The server has already revoked this login." : " Try revoking the login again."}</p>
            {devices.cleanupRequired && <Button size="sm" variant="secondary" onClick={devices.retryCleanup}>Retry local cleanup</Button>}
          </div>}
        </>}
      <ConfirmDialog open={devices.confirmation !== null} onClose={() => devices.confirm(null)}
        title={devices.confirmation?.current ? "End this login?" : "Revoke this login?"}
        description={devices.confirmation?.current
          ? "This ends this login and disconnects this saved server profile. You will need to log in again. Other logins are not affected."
          : "This login will lose access to your account on this server, across all projects. Your current login will stay connected."}
        confirmText="Revoke access" variant="danger" loading={devices.pending !== null} onConfirm={devices.revoke} />
    </section>
  );
}
