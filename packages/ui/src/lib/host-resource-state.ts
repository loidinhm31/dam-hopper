import type {
  AlertSeverity,
  AlertState,
  Availability,
  BatteryStatus,
  ResourceAlertState,
} from "@/api/client.js";
import { formatBytes } from "@/lib/host-metrics-format.js";

const ALERT_LABELS: Record<AlertState | ResourceAlertState, string> = {
  healthy: "Healthy",
  reclaimableCacheHigh: "High reclaimable cache",
  elevatedNoPressure: "Elevated, no pressure",
  memoryPressure: "Memory pressure",
  oomRisk: "OOM risk",
  limitedData: "Limited data",
  temperatureHigh: "High temperature",
  diskFull: "Disk nearly full",
};

const AVAILABILITY_LABELS: Record<Availability["state"], string> = {
  available: "Available",
  unsupported: "Unsupported on this host",
  permissionDenied: "Permission denied",
  temporarilyUnavailable: "Temporarily unavailable",
  stale: "Stale data",
};

const BATTERY_STATUS_LABELS: Record<BatteryStatus, string> = {
  charging: "Charging",
  discharging: "Discharging",
  full: "Full",
  notCharging: "Not charging",
  unknown: "Unknown",
  mixed: "Mixed",
};

export function formatAlertState(
  state: AlertState | ResourceAlertState,
): string {
  return ALERT_LABELS[state];
}

export function formatAvailability(availability: Availability): string {
  return availability.detailCode
    ? `${AVAILABILITY_LABELS[availability.state]} (${availability.detailCode})`
    : AVAILABILITY_LABELS[availability.state];
}

export function formatOptionalBytes(bytes: number | null | undefined): string {
  return bytes == null ? "Unavailable" : formatBytes(bytes);
}

export function formatOptionalPercent(
  percent: number | null | undefined,
): string {
  return percent == null ? "Unavailable" : `${Math.round(percent)}%`;
}

export function formatBatteryStatus(
  status: BatteryStatus | null | undefined,
): string | undefined {
  return typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(BATTERY_STATUS_LABELS, status)
    ? BATTERY_STATUS_LABELS[status]
    : undefined;
}

export function formatBatteryCapacity(
  percent: number | null | undefined,
): string | undefined {
  if (!isFiniteNonNegative(percent) || percent > 100) return undefined;
  return `${formatCompactNumber(percent)}%`;
}

export function formatBatteryEnergy(
  energyWh: number | null | undefined,
): string | undefined {
  return formatBatteryMeasurement(energyWh, "Wh");
}

export function formatBatteryPower(
  powerW: number | null | undefined,
): string | undefined {
  return formatBatteryMeasurement(powerW, "W");
}

function formatBatteryMeasurement(
  value: number | null | undefined,
  unit: "Wh" | "W",
): string | undefined {
  if (!isFiniteNonNegative(value)) return undefined;
  return `${formatCompactNumber(value)} ${unit}`;
}

function isFiniteNonNegative(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function formatCompactNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function severityClass(severity: AlertSeverity): string {
  if (severity === "critical") return "text-[var(--color-danger)]";
  if (severity === "warning") return "text-[var(--color-warning)]";
  return "text-[var(--color-primary)]";
}
