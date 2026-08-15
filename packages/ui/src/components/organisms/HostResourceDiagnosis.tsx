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
  formatOptionalBytes,
  normalizeProgressRatio,
} from "@/lib/host-resource-state.js";
import { formatPercent } from "@/lib/host-metrics-format.js";
import { HostResourceIncidentDetails } from "./HostResourceIncidentDetails.js";
import { HostResourceStorageDetails } from "./HostResourceStorageDetails.js";
import {
  HostResourceInfoRow,
  HostResourceMetric,
} from "./HostResourceDiagnosisRows.js";

interface Props {
  snapshot: HostResourceSnapshotV1;
  alerts: HostResourceAlertIncident[];
  legacyMetrics?: HostMetrics;
  pinnedMount?: string | null;
  onPin?: (mountPoint: string | null) => void;
  isPinPending?: boolean;
  pinError?: Error | null;
}

export function HostResourceDiagnosis({
  snapshot,
  alerts,
  legacyMetrics,
  pinnedMount,
  onPin = () => undefined,
  isPinPending = false,
  pinError = null,
}: Props) {
  const { memory, pressure, processes, mountContext } = snapshot;
  const visibleCgroups = snapshot.cgroups.filter(isUsableCgroup);
  const availableProgress = normalizeProgressRatio(
    memory.availableBytes,
    memory.totalBytes,
  );
  const battery = getBatteryPresentation(snapshot.battery);

  return (
    <div className="space-y-4">
      <HostResourceIncidentDetails snapshot={snapshot} alerts={alerts} />

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

      <HostResourceStorageDetails
        metrics={legacyMetrics}
        pinnedMount={pinnedMount}
        onPin={onPin}
        isPending={isPinPending}
        error={pinError}
      />

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

function formatPsi(some?: number | null, full?: number | null): string {
  const someValue = Number.isFinite(some)
    ? `${(some as number).toFixed(1)}%`
    : "Unavailable";
  const fullValue = Number.isFinite(full)
    ? `${(full as number).toFixed(1)}%`
    : "Unavailable";
  return someValue === "Unavailable" && fullValue === "Unavailable"
    ? "Unavailable"
    : `${someValue} / ${fullValue}`;
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
