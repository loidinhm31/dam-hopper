import type { AlertSeverity, AlertState, Availability } from "@/api/client.js";
import { formatBytes } from "@/lib/host-metrics-format.js";

const ALERT_LABELS: Record<AlertState, string> = {
  healthy: "Healthy",
  reclaimableCacheHigh: "High reclaimable cache",
  elevatedNoPressure: "Elevated, no pressure",
  memoryPressure: "Memory pressure",
  oomRisk: "OOM risk",
  limitedData: "Limited data",
};

const AVAILABILITY_LABELS: Record<Availability["state"], string> = {
  available: "Available",
  unsupported: "Unsupported on this host",
  permissionDenied: "Permission denied",
  temporarilyUnavailable: "Temporarily unavailable",
  stale: "Stale data",
};

export function formatAlertState(state: AlertState): string {
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

export function severityClass(severity: AlertSeverity): string {
  if (severity === "critical") return "text-[var(--color-danger)]";
  if (severity === "warning") return "text-[var(--color-warning)]";
  return "text-[var(--color-primary)]";
}
