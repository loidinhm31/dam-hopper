import type {
  HostMetrics,
  HostResourceAlertIncident,
  HostResourceSnapshotV1,
} from "@/api/client.js";
import {
  formatAvailability,
  formatAlertState,
  formatOptionalBytes,
  formatOptionalPercent,
  severityClass,
} from "@/lib/host-resource-state.js";
import { formatPercent } from "@/lib/host-metrics-format.js";
import { cn } from "@/lib/utils.js";
import {
  HostResourceInfoRow,
  HostResourceLegacyMetrics,
  HostResourceMetric,
} from "./HostResourceDiagnosisRows.js";

interface Props {
  snapshot: HostResourceSnapshotV1;
  alerts: HostResourceAlertIncident[];
  legacyMetrics?: HostMetrics;
}

export function HostResourceDiagnosis({
  snapshot,
  alerts,
  legacyMetrics,
}: Props) {
  const { memory, pressure, processes, mountContext } = snapshot;
  const visibleCgroups = snapshot.cgroups.filter(isUsableCgroup);
  const alert = snapshot.alert;
  const availablePercent = percentage(memory.availableBytes, memory.totalBytes);

  return (
    <div className="space-y-4">
      <section className="space-y-1 border-b border-[var(--color-border)] pb-3">
        <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          {snapshot.host.hostname ?? "Host"}
        </p>
        <p className="truncate text-[10px] text-[var(--color-text-muted)]">
          {snapshot.host.osName ?? "System"} · sampled{" "}
          {formatSampleAge(snapshot.sampledAt)} ago
        </p>
      </section>

      {alert && (
        <section
          aria-label="Current host alert"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2.5"
        >
          <p className={cn("text-xs font-bold", severityClass(alert.severity))}>
            {formatAlertState(alert.state)}
          </p>
          <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
            {alert.durationSeconds}s · {alert.confidence} confidence ·{" "}
            {alert.scope} scope
          </p>
          <p className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
            Operator guidance: {alert.nextAction}
          </p>
          <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
            <HostResourceInfoRow label="Threshold" value={alert.threshold} />
            <HostResourceInfoRow
              label="Available"
              value={formatOptionalPercent(alert.evidence.availablePercent)}
            />
            <HostResourceInfoRow
              label="Reclaimable"
              value={formatOptionalPercent(alert.evidence.reclaimablePercent)}
            />
            <HostResourceInfoRow
              label="PSI some / full"
              value={`${formatOptionalPercent(alert.evidence.psiSomeAvg10)} / ${formatOptionalPercent(alert.evidence.psiFullAvg10)}`}
            />
            <HostResourceInfoRow
              label="Cgroup OOM event"
              value={
                alert.evidence.cgroupOomDelta ? "Observed" : "Not observed"
              }
            />
          </div>
        </section>
      )}

      <HostResourceMetric
        label="Memory available"
        value={
          availablePercent === undefined
            ? "Unavailable"
            : formatPercent(availablePercent)
        }
        detail={`${formatOptionalBytes(memory.availableBytes)} free of ${formatOptionalBytes(memory.totalBytes)}`}
        availability={memory.availability}
        percent={availablePercent}
      />
      <HostResourceMetric
        label="File cache"
        value={formatOptionalBytes(memory.fileCacheBytes)}
        detail="Reported separately; memory categories are not additive."
        availability={memory.availability}
      />
      <HostResourceMetric
        label="Anonymous memory"
        value={formatOptionalBytes(memory.anonBytes)}
        detail="Reported separately; memory categories are not additive."
        availability={memory.availability}
      />
      <HostResourceMetric
        label="Reclaimable slab"
        value={formatOptionalBytes(memory.reclaimableSlabBytes)}
        detail="Kernel slab eligible for reclamation when available."
        availability={memory.availability}
      />
      <HostResourceMetric
        label="Swap used"
        value={formatOptionalBytes(memory.swapUsedBytes)}
        detail="Swap activity is context, not a pressure verdict."
        availability={memory.availability}
      />
      <HostResourceMetric
        label="PSI memory"
        value={formatPsi(
          pressure.memory.some?.avg10,
          pressure.memory.full?.avg10,
        )}
        detail="some / full, 10-second average"
        availability={pressure.memory.availability}
      />

      {legacyMetrics && <HostResourceLegacyMetrics metrics={legacyMetrics} />}

      <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-[10px]">
        <p className="font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          Scope and availability
        </p>
        <HostResourceInfoRow
          label="Deep metrics"
          value={formatAvailability(snapshot.capabilities.linuxDeepMetrics)}
        />
        <HostResourceInfoRow
          label="Processes"
          value={`${processes.scannedCount} scanned${processes.truncated ? ", truncated" : ""} · ${formatAvailability(processes.availability)}`}
        />
        <HostResourceInfoRow
          label="Cgroups"
          value={formatVisibleCgroups(
            snapshot.cgroups,
            snapshot.capabilities.linuxDeepMetrics,
          )}
        />
        <HostResourceInfoRow
          label="Mount"
          value={`${mountContext.mountPoint} · ${mountContext.cacheAttribution.label} (${mountContext.cacheAttribution.confidence}, ${formatOptionalBytes(mountContext.cacheAttribution.bytes)}, ${mountContext.cacheAttribution.method})`}
        />
        <HostResourceInfoRow
          label="Mount availability"
          value={formatAvailability(mountContext.availability)}
        />
      </section>

      {processes.processes.length > 0 && (
        <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Largest observed processes
          </p>
          <ul className="space-y-1" aria-label="Observed processes">
            {processes.processes.slice(0, 3).map((process) => (
              <li
                key={`${process.pid}-${process.startTicks ?? "unknown"}`}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span className="min-w-0 truncate text-[var(--color-text)]">
                  {process.name} · {process.pid}
                </span>
                <span className="shrink-0 text-[var(--color-text-muted)]">
                  {formatOptionalBytes(process.rssBytes)} RSS
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visibleCgroups.length > 0 && (
        <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Observed cgroups
          </p>
          <ul className="space-y-1" aria-label="Observed cgroups">
            {visibleCgroups.slice(0, 3).map((cgroup) => (
              <li
                key={`${cgroup.namespace}-${cgroup.path}`}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span className="min-w-0 truncate text-[var(--color-text)]">
                  {cgroup.path}
                </span>
                <span className="shrink-0 text-[var(--color-text-muted)]">
                  {formatOptionalBytes(cgroup.currentBytes)} /{" "}
                  {cgroup.maxUnlimited
                    ? "max"
                    : formatOptionalBytes(cgroup.maxBytes)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {snapshot.currentAlerts && snapshot.currentAlerts.length > 0 && (
        <section
          aria-label="Current resource incidents"
          className="space-y-1.5 border-t border-[var(--color-border)] pt-3"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Current resource incidents
          </p>
          <ul className="space-y-1.5">
            {snapshot.currentAlerts.slice(0, 5).map((incident) => (
              <li key={incident.incidentId} className="space-y-0.5 text-[10px]">
                <p
                  className={cn(
                    "font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)} · {incident.scope}
                </p>
                <p className="text-[var(--color-text-muted)]">
                  Evidence: {formatResourceEvidence(incident)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {alerts.length > 0 && (
        <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Recent incidents
          </p>
          <ul className="space-y-1" aria-label="Recent host incidents">
            {alerts.slice(0, 5).map((incident) => (
              <li
                key={incident.incidentId}
                className="flex items-center justify-between gap-3 text-[10px]"
              >
                <span
                  className={cn(
                    "min-w-0 truncate font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)}
                </span>
                <span className="shrink-0 text-[var(--color-text-muted)]">
                  {incident.resolvedAt != null
                    ? "resolved"
                    : `${incident.durationSeconds}s`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function percentage(
  part?: number | null,
  total?: number | null,
): number | undefined {
  return part != null && total != null && total > 0
    ? (part / total) * 100
    : undefined;
}

function formatResourceEvidence(
  incident: NonNullable<HostResourceSnapshotV1["currentAlerts"]>[number],
): string {
  if (incident.kind === "temperature") {
    const source = incident.evidence.temperatureSource ?? "source unavailable";
    const value = Number.isFinite(incident.evidence.temperatureCelsius)
      ? `${Math.round(incident.evidence.temperatureCelsius ?? 0)}°C`
      : "unavailable";
    return `${incident.evidence.temperatureLabel ?? source} · ${value}`;
  }
  const mount = incident.evidence.diskMountPoint ?? "mount unavailable";
  const percent = Number.isFinite(incident.evidence.diskUsagePercent)
    ? `${Math.round(incident.evidence.diskUsagePercent ?? 0)}% used`
    : "usage unavailable";
  return `${incident.evidence.diskName ?? mount} · ${mount} · ${percent}`;
}

function formatPsi(some?: number | null, full?: number | null): string {
  return some == null && full == null
    ? "Unavailable"
    : `${some?.toFixed(1) ?? "—"}% / ${full?.toFixed(1) ?? "—"}%`;
}

function formatSampleAge(sampledAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - sampledAt) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function isUsableCgroup(
  cgroup: HostResourceSnapshotV1["cgroups"][number],
): boolean {
  return (
    cgroup.path.length > 0 &&
    (cgroup.availability.state === "available" ||
      cgroup.availability.state === "stale")
  );
}

function formatVisibleCgroups(
  cgroups: HostResourceSnapshotV1["cgroups"],
  fallback: HostResourceSnapshotV1["capabilities"]["linuxDeepMetrics"],
): string {
  const visible = cgroups.filter(isUsableCgroup);
  if (visible.length > 0) {
    return `${visible.length} visible · ${formatAvailability(visible[0].availability)}`;
  }
  const degraded = cgroups.find(
    (cgroup) => cgroup.availability.state !== "available",
  );
  return degraded
    ? formatAvailability(degraded.availability)
    : fallback.state === "available"
      ? "No cgroup data"
      : formatAvailability(fallback);
}
