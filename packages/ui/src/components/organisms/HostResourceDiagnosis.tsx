import type {
  HostMetrics,
  HostResourceAlertIncident,
  HostResourceSnapshotV1,
} from "@/api/client.js";
import {
  formatBatteryCapacity,
  formatBatteryEnergy,
  formatBatteryPower,
  formatBatteryStatus,
  formatAvailability,
  formatAlertState,
  formatOptionalBytes,
  formatOptionalPercent,
  normalizeProgressRatio,
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
  const availableProgress = normalizeProgressRatio(
    memory.availableBytes,
    memory.totalBytes,
  );
  const battery = getBatteryPresentation(snapshot.battery);

  return (
    <div className="space-y-4">
      {alert && (
        <section
          aria-label="Current host alert"
          className="rounded border border-[var(--color-border)] border-l-2 bg-[var(--color-surface)] p-2.5"
        >
          <p className={cn("text-xs font-bold", severityClass(alert.severity))}>
            {formatAlertState(alert.state)}
          </p>
          <p className="mt-1 min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
            {alert.durationSeconds}s · {alert.confidence} confidence ·{" "}
            {alert.scope} scope
          </p>
          <p className="mt-1.5 min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
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

      {snapshot.currentAlerts && snapshot.currentAlerts.length > 0 && (
        <section
          aria-label="Current resource incidents"
          className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Current resource incidents
          </p>
          <ul className="space-y-1.5">
            {snapshot.currentAlerts.slice(0, 5).map((incident) => (
              <li
                key={incident.incidentId}
                className="min-w-0 space-y-0.5 text-[10px]"
              >
                <p
                  className={cn(
                    "min-w-0 [overflow-wrap:anywhere] font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)} · {incident.scope}
                </p>
                <p className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
                  Evidence: {formatResourceEvidence(incident)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Core host metrics" className="space-y-3">
        <HostResourceMetric
          label="Memory available"
          value={
            availableProgress === undefined
              ? "Unavailable"
              : formatPercent(availableProgress.value)
          }
          detail={`${formatOptionalBytes(memory.availableBytes)} free of ${formatOptionalBytes(memory.totalBytes)}`}
          availability={memory.availability}
          progress={availableProgress}
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
          <HostResourceMetric
            label="File cache"
            value={formatOptionalBytes(memory.fileCacheBytes)}
            detail="Reported separately"
            availability={memory.availability}
          />
          <HostResourceMetric
            label="Anonymous memory"
            value={formatOptionalBytes(memory.anonBytes)}
            detail="Reported separately"
            availability={memory.availability}
          />
          <HostResourceMetric
            label="Reclaimable slab"
            value={formatOptionalBytes(memory.reclaimableSlabBytes)}
            detail="Kernel memory eligible for reclamation"
            availability={memory.availability}
          />
          <HostResourceMetric
            label="Swap used"
            value={formatOptionalBytes(memory.swapUsedBytes)}
            detail="Context only"
            availability={memory.availability}
          />
          <HostResourceMetric
            label="PSI memory"
            value={formatPsi(
              pressure.memory.some?.avg10,
              pressure.memory.full?.avg10,
            )}
            detail="some / full avg10"
            availability={pressure.memory.availability}
          />
        </div>
        <p className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-[10px] leading-relaxed text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
          Memory categories are reported separately and are not additive;
          reclaimable slab is kernel memory eligible for reclamation; swap is
          context, not a pressure verdict; PSI is some/full avg10.
        </p>
      </section>

      {battery && <BatterySection battery={battery} />}

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
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-3 text-[10px]"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text)]">
                  {process.name} · {process.pid}
                </span>
                <span className="shrink-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
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
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-3 text-[10px]"
              >
                <span className="min-w-0 [overflow-wrap:anywhere] text-[var(--color-text)]">
                  {cgroup.path}
                </span>
                <span className="shrink-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
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

      {alerts.length > 0 && (
        <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Recent incidents
          </p>
          <ul className="space-y-1" aria-label="Recent host incidents">
            {alerts.slice(0, 5).map((incident) => (
              <li
                key={incident.incidentId}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-3 text-[10px]"
              >
                <span
                  className={cn(
                    "min-w-0 [overflow-wrap:anywhere] font-medium",
                    severityClass(incident.severity),
                  )}
                >
                  {formatAlertState(incident.state)}
                </span>
                <span className="shrink-0 [overflow-wrap:anywhere] text-[var(--color-text-muted)]">
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

interface BatteryPresentation {
  availability: HostResourceSnapshotV1["memory"]["availability"];
  count?: string;
  status?: string;
  capacity?: string;
  energy?: string;
  power?: string;
}

function getBatteryPresentation(
  battery: HostResourceSnapshotV1["battery"],
): BatteryPresentation | undefined {
  const count =
    battery &&
    Number.isFinite(battery.count) &&
    Number.isInteger(battery.count) &&
    battery.count > 0
      ? `${battery.count}`
      : undefined;
  if (!battery || !count || battery.availability.state === "unsupported") {
    return undefined;
  }

  const status = formatBatteryStatus(battery.status);
  const capacity = formatBatteryCapacity(battery.capacityPercent);
  const energy = formatBatteryEnergy(battery.remainingEnergyWh);
  const power = formatBatteryPower(battery.instantaneousPowerW);

  if (!count && !status && !capacity && !energy && !power) return undefined;
  return {
    availability: battery.availability,
    count,
    status,
    capacity,
    energy,
    power,
  };
}

function BatterySection({ battery }: { battery: BatteryPresentation }) {
  const availability = formatAvailability(battery.availability);
  return (
    <section
      aria-label="Battery"
      className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-[10px]"
    >
      <p className="font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
        Battery
      </p>
      <div className="space-y-1">
        {battery.count && (
          <HostResourceInfoRow
            label="Batteries"
            value={`${battery.count} · ${availability}`}
          />
        )}
        {battery.status && (
          <HostResourceInfoRow
            label="Status"
            value={`${battery.status} · ${availability}`}
          />
        )}
        {battery.capacity && (
          <HostResourceInfoRow
            label="Capacity"
            value={`${battery.capacity} · ${availability}`}
          />
        )}
        {battery.energy && (
          <HostResourceInfoRow
            label="Remaining energy (Wh)"
            value={`${battery.energy} · ${availability}`}
          />
        )}
        {battery.power && (
          <HostResourceInfoRow
            label="Instantaneous power (W)"
            value={`${battery.power} · ${availability}`}
          />
        )}
      </div>
    </section>
  );
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
