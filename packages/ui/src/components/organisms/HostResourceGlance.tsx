import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import {
  formatAvailability,
  normalizeProgressPercent,
  resolveHostResourceMemory,
  resolveHostResourceStorage,
} from "@/lib/host-resource-state.js";
import { formatBytes, formatPercent } from "@/lib/host-metrics-format.js";
import {
  BatteryRow,
  MetricRow,
  TemperatureRows,
  type HostResourceGlanceMetric,
} from "./HostResourceGlanceRows.js";

export interface HostResourceGlanceProps {
  metrics?: HostMetrics | null;
  legacyMetrics?: HostMetrics | null;
  snapshot?: HostResourceSnapshotV1 | null;
  pinnedMount?: string | null;
  metricsStale?: boolean;
  metricsError?: boolean;
}

type Projection = Omit<HostResourceGlanceMetric, "label">;

export function HostResourceGlance({
  metrics: compatibilityMetrics,
  legacyMetrics,
  snapshot,
  pinnedMount = null,
  metricsStale = false,
  metricsError = false,
}: HostResourceGlanceProps) {
  const metrics = compatibilityMetrics ?? legacyMetrics ?? null;
  const compatibilityStatus = getCompatibilityStatus(
    metricsStale,
    metricsError,
  );
  const memory = addStatus(
    resolveMemory(metrics, snapshot),
    compatibilityStatus,
  );
  const storage = addStatus(
    resolveStorage(metrics, pinnedMount),
    compatibilityStatus,
  );
  const cpu = progress(metrics?.cpu?.usagePercent);
  const rows: HostResourceGlanceMetric[] = [
    { label: "Memory used", ...memory, meterLabel: "Memory used percentage" },
    {
      label: "CPU",
      value: cpu.text,
      detail: metrics
        ? compatibilityStatus
          ? addStatusText("Compatibility usage reading", compatibilityStatus)
          : "Compatibility usage reading"
        : "CPU unavailable",
      meterValue: cpu.value,
      meterLabel: "CPU usage percentage",
    },
    {
      label: "Storage used",
      ...storage,
      meterLabel: "Selected storage usage percentage",
    },
  ];

  return (
    <section aria-label="Host resource glance" className="space-y-2.5">
      {rows.map((row) => (
        <MetricRow key={row.label} {...row} />
      ))}
      {compatibilityStatus && (
        <p className="text-[10px] text-[var(--color-warning)]">
          {compatibilityStatus}
        </p>
      )}
      <TemperatureRows temperatures={metrics?.temperatures ?? []} />
      <BatteryRow battery={snapshot?.battery} />
    </section>
  );
}

function getCompatibilityStatus(
  stale: boolean,
  error: boolean,
): string | undefined {
  if (error) return "Compatibility metrics refresh failed; showing last sample";
  return stale ? "Compatibility metrics are stale" : undefined;
}

function addStatus(projection: Projection, status?: string): Projection {
  return status
    ? { ...projection, detail: addStatusText(projection.detail, status) }
    : projection;
}

function addStatusText(detail: string | undefined, status: string): string {
  return detail ? `${detail} · ${status}` : status;
}

function resolveMemory(
  metrics: HostMetrics | null,
  snapshot: HostResourceSnapshotV1 | null | undefined,
): Projection {
  const projection = resolveHostResourceMemory(metrics ?? undefined, snapshot);
  if (
    projection.value === undefined ||
    projection.usedBytes === undefined ||
    projection.totalBytes === undefined
  ) {
    return {
      value: "Unavailable",
      detail:
        projection.source === "compatibility"
          ? "Compatibility memory reading is invalid"
          : projection.availability
            ? formatAvailability(projection.availability)
            : "Memory unavailable",
    };
  }
  const detail = `${formatBytes(projection.usedBytes)} / ${formatBytes(projection.totalBytes)}`;
  const sourceDetail =
    projection.source === "deep"
      ? ` · derived from deep total − available · ${projection.availability ? formatAvailability(projection.availability) : "Memory unavailable"}`
      : "";
  return {
    value: formatPercent(projection.value),
    detail: `${detail}${sourceDetail}`,
    meterValue: projection.value,
  };
}

function resolveStorage(
  metrics: HostMetrics | null,
  pinnedMount: string | null,
): Projection {
  const resolution = resolveHostResourceStorage(
    metrics ?? undefined,
    pinnedMount,
  );
  if (resolution.state === "unavailable") {
    return {
      value: "Unavailable",
      detail: resolution.savedMount
        ? `${resolution.savedMount} · missing`
        : "Storage metrics unavailable",
    };
  }
  if (resolution.state === "missing") {
    return {
      value: "Unavailable",
      detail: `${resolution.savedMount} · missing · (overall ${progress(resolution.overall?.usagePercent).text})`,
    };
  }
  const meter = progress(resolution.selected.usagePercent);
  return {
    value: meter.text,
    detail: `${resolution.selected.mountPoint || "mount unavailable"} · (overall ${progress(resolution.overall.usagePercent).text})`,
    meterValue: meter.value,
  };
}

function progress(value: number | null | undefined): {
  text: string;
  value?: number;
} {
  const normalized = normalizeProgressPercent(value);
  return normalized
    ? { text: formatPercent(normalized.value), value: normalized.value }
    : { text: "Unavailable" };
}
