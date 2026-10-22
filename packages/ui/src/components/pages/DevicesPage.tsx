import { useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import {
  readServerProfiles,
  getActiveProfileId,
  type ServerProfile,
} from "@/api/server-config.js";
import { LoginDevicesSection } from "@/components/organisms/LoginDevicesSection.js";
import { ShieldCheck, Server } from "lucide-react";

export function DevicesPage() {
  const profilesResult = readServerProfiles();
  const profiles: ServerProfile[] =
    profilesResult.status === "available" ? profilesResult.profiles : [];
  const activeProfileId = getActiveProfileId();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    () => activeProfileId ?? profiles[0]?.id ?? null,
  );

  return (
    <AppLayout title="Devices">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                Active Logins & Device Sessions
              </h2>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              View and manage authenticated devices for your account on this server.
              Revoking a session immediately terminates its access across all projects.
            </p>
          </div>

          {profiles.length > 1 && (
            <div className="flex items-center gap-2 shrink-0">
              <Server className="h-4 w-4 text-[var(--color-text-muted)]" />
              <label
                htmlFor="devices-server-select"
                className="text-xs text-[var(--color-text-muted)]"
              >
                Server:
              </label>
              <select
                id="devices-server-select"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                value={selectedProfileId ?? ""}
                onChange={(e) => setSelectedProfileId(e.target.value || null)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.url})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/20 p-5">
          <LoginDevicesSection
            key={selectedProfileId ?? "default"}
            profileId={selectedProfileId}
            variant="page"
          />
        </div>
      </div>
    </AppLayout>
  );
}
