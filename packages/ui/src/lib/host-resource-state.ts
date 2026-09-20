import type {
  AlertSeverity,
  AlertState,
  Availability,
  BatteryStatus,
  DiskMetrics,
  HostMetrics,
  HostResourceSnapshotV1,
  ResourceAlertState,
} from "@/api/client.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ConnectionStatus } from "@/api/connections.js";
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
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0
    ? formatBytes(bytes)
    : "Unavailable";
}

export function formatOptionalPercent(
  percent: number | null | undefined,
): string {
  const normalized = normalizeProgressPercent(percent);
  return normalized === undefined
    ? "Unavailable"
    : `${Math.round(normalized.value)}%`;
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
export function formatSampleAge(
  sampledAt: number | null | undefined,
  now: number = Date.now(),
): string | undefined {
  if (!isFiniteNonNegative(sampledAt) || sampledAt === 0) return undefined;
  const seconds = Math.max(0, Math.round((now - sampledAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function severityClass(severity: AlertSeverity): string {
  if (severity === "critical") return "text-[var(--color-danger)]";
  if (severity === "warning") return "text-[var(--color-warning)]";
  return "text-[var(--color-primary)]";
}

export type HostResourceStatusMode =
  | "terminal-unavailable"
  | "sampling"
  | "refresh-error"
  | "unavailable"
  | "stale-refreshing"
  | "stale"
  | "background-loading"
  | "current";

export type HostResourceStatusTone =
  | "critical"
  | "warning"
  | "info"
  | "success"
  | "danger";

export interface HostResourceStatusPresentation {
  label: string;
  baseLabel: string;
  mode: HostResourceStatusMode;
  rank: 0 | 1 | 2 | 3;
  tone: HostResourceStatusTone;
  icon: "alert" | "activity" | "healthy";
  triggerClassName: string;
  badgeClassName: string;
  statusClassName: string;
  statusIconClassName: string;
  badgeLabel?: string;
  badgeText?: string;
}

export interface HostResourceStatusInput {
  snapshot?: HostResourceSnapshotV1 | null;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  isStale?: boolean;
  unreadCount?: number;
}

interface HostResourceStatusVariant {
  icon: HostResourceStatusPresentation["icon"];
  triggerClassName: string;
  badgeClassName: string;
  statusClassName: string;
  statusIconClassName: string;
}

const STATUS_VARIANTS: Record<
  HostResourceStatusTone,
  HostResourceStatusVariant
> = {
  critical: {
    icon: "alert",
    triggerClassName: "text-[var(--color-danger)]",
    badgeClassName: "bg-[var(--color-danger)] text-[var(--color-background)]",
    statusClassName:
      "border-[var(--color-danger)] bg-[var(--color-background)]",
    statusIconClassName: "text-[var(--color-danger)]",
  },
  warning: {
    icon: "alert",
    triggerClassName: "text-[var(--color-warning)]",
    badgeClassName: "bg-[var(--color-warning)] text-[var(--color-background)]",
    statusClassName:
      "border-[var(--color-warning)] bg-[var(--color-background)]",
    statusIconClassName: "text-[var(--color-warning)]",
  },
  info: {
    icon: "activity",
    triggerClassName: "text-[var(--color-primary)]",
    badgeClassName: "bg-[var(--color-primary)] text-[var(--color-background)]",
    statusClassName:
      "border-[var(--color-primary)] bg-[var(--color-background)]",
    statusIconClassName: "text-[var(--color-primary)]",
  },
  success: {
    icon: "healthy",
    triggerClassName: "text-[var(--color-success)]",
    badgeClassName: "bg-[var(--color-success)] text-[var(--color-background)]",
    statusClassName:
      "border-[var(--color-success)] bg-[var(--color-background)]",
    statusIconClassName: "text-[var(--color-success)]",
  },
  danger: {
    icon: "alert",
    triggerClassName: "text-[var(--color-danger)]",
    badgeClassName: "bg-[var(--color-danger)] text-[var(--color-background)]",
    statusClassName:
      "border-[var(--color-danger)] bg-[var(--color-background)]",
    statusIconClassName: "text-[var(--color-danger)]",
  },
};

const SEVERITY_RANKS: Record<AlertSeverity, 1 | 2 | 3> = {
  info: 1,
  warning: 2,
  critical: 3,
};

export function normalizeProgressPercent(
  value: unknown,
): { value: number } | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return { value: Math.min(value, 100) };
}

export function normalizeProgressRatio(
  part: unknown,
  total: unknown,
): { value: number } | undefined {
  if (
    typeof part !== "number" ||
    typeof total !== "number" ||
    !Number.isFinite(part) ||
    !Number.isFinite(total) ||
    part < 0 ||
    total <= 0
  ) {
    return undefined;
  }
  return { value: Math.min((part / total) * 100, 100) };
}

export interface HostResourceMemoryProjection {
  value?: number;
  usedBytes?: number;
  totalBytes?: number;
  source: "compatibility" | "deep" | "unavailable";
  availability?: Availability;
}

export function resolveHostResourceMemory(
  metrics?: HostMetrics,
  snapshot?: HostResourceSnapshotV1 | null,
): HostResourceMemoryProjection {
  if (metrics) {
    const usedBytes = finiteNonNegative(metrics.memory?.usedBytes);
    const totalBytes = finitePositive(metrics.memory?.totalBytes);
    return {
      value: ratioPercent(usedBytes, totalBytes),
      usedBytes,
      totalBytes,
      source: "compatibility",
    };
  }

  const availability = snapshot?.memory.availability;
  if (
    !snapshot ||
    !availability ||
    (availability.state !== "available" && availability.state !== "stale")
  ) {
    return { source: "unavailable", availability };
  }

  const totalBytes = finitePositive(snapshot.memory.totalBytes);
  const availableBytes = finiteNonNegative(snapshot.memory.availableBytes);
  const usedBytes =
    totalBytes !== undefined && availableBytes !== undefined
      ? Math.max(totalBytes - availableBytes, 0)
      : undefined;
  return {
    value: ratioPercent(usedBytes, totalBytes),
    usedBytes,
    totalBytes,
    source: "deep",
    availability,
  };
}

export type HostResourceStorageResolution =
  | {
      state: "default" | "pinned";
      selected: DiskMetrics;
      overall: DiskMetrics;
      savedMount?: string;
    }
  | {
      state: "missing";
      selected?: undefined;
      overall?: DiskMetrics;
      savedMount: string;
    }
  | {
      state: "unavailable";
      selected?: undefined;
      overall?: DiskMetrics;
      savedMount?: string;
    };

export function resolveHostResourceStorage(
  metrics?: HostMetrics,
  pinnedMount?: string | null,
): HostResourceStorageResolution {
  const overall = metrics?.disk;
  if (!overall || typeof overall.mountPoint !== "string") {
    return {
      state: "unavailable",
      savedMount: pinnedMount || undefined,
    };
  }

  if (!pinnedMount) {
    return { state: "default", selected: overall, overall };
  }

  const disks =
    Array.isArray(metrics.disks) && metrics.disks.length > 0
      ? metrics.disks
      : [overall];
  const selected = disks.find((disk) => disk.mountPoint === pinnedMount);
  return selected
    ? { state: "pinned", selected, overall, savedMount: pinnedMount }
    : { state: "missing", overall, savedMount: pinnedMount };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function ratioPercent(
  part: number | undefined,
  total: number | undefined,
): number | undefined {
  return part === undefined || total === undefined
    ? undefined
    : Math.min((part / total) * 100, 100);
}

export function resolveHostResourceStatus({
  snapshot,
  isLoading = false,
  isFetching = false,
  isError = false,
  isStale = false,
  unreadCount = 0,
}: HostResourceStatusInput): HostResourceStatusPresentation {
  if (!snapshot) {
    if (isError) {
      return createStatusPresentation(
        "Snapshot unavailable",
        "Snapshot unavailable",
        "terminal-unavailable",
        0,
        "danger",
        unreadCount,
      );
    }
    if (isLoading || isFetching) {
      return createStatusPresentation(
        "Sampling host",
        "Sampling host",
        "sampling",
        0,
        "info",
        unreadCount,
      );
    }
    return createStatusPresentation(
      "Snapshot unavailable",
      "Snapshot unavailable",
      "terminal-unavailable",
      0,
      "danger",
      unreadCount,
    );
  }

  const { baseLabel, rank, tone: baseTone } = getBaseStatus(snapshot);
  let mode: HostResourceStatusMode = "current";
  let qualifier: string | undefined;

  if (isError) {
    mode = "refresh-error";
    qualifier = "refresh failed";
  } else if (
    snapshot.memory.availability.state === "unsupported" ||
    snapshot.memory.availability.state === "permissionDenied" ||
    snapshot.memory.availability.state === "temporarilyUnavailable"
  ) {
    mode = "unavailable";
    qualifier = "core data unavailable";
  } else if (snapshot.currentAlerts === undefined) {
    mode = "unavailable";
    qualifier = "resource alert status unavailable";
  } else if (
    (isStale || snapshot.memory.availability.state === "stale") &&
    (isLoading || isFetching)
  ) {
    mode = "stale-refreshing";
    qualifier = "stale, refreshing";
  } else if (isStale || snapshot.memory.availability.state === "stale") {
    mode = "stale";
    qualifier = "stale";
  } else if (isLoading || isFetching) {
    mode = "background-loading";
    qualifier = "refreshing";
  }

  const tone =
    rank > 0 || mode === "current" || mode === "background-loading"
      ? baseTone
      : "warning";
  return createStatusPresentation(
    qualifier ? `${baseLabel} · ${qualifier}` : baseLabel,
    baseLabel,
    mode,
    rank,
    tone,
    unreadCount,
  );
}

function getBaseStatus(snapshot: HostResourceSnapshotV1): {
  baseLabel: string;
  rank: 0 | 1 | 2 | 3;
  tone: HostResourceStatusTone;
} {
  let rank: 0 | 1 | 2 | 3 = 0;

  if (snapshot.alert && snapshot.alert.state !== "healthy") {
    rank = Math.max(rank, SEVERITY_RANKS[snapshot.alert.severity]) as 1 | 2 | 3;
  }
  for (const incident of snapshot.currentAlerts ?? []) {
    if (incident.resolvedAt == null) {
      rank = Math.max(rank, SEVERITY_RANKS[incident.severity]) as 1 | 2 | 3;
    }
  }

  if (rank === 3) {
    return { baseLabel: "Critical", rank, tone: "critical" };
  }
  if (rank === 2) {
    return { baseLabel: "Warning", rank, tone: "warning" };
  }
  if (rank === 1) {
    return { baseLabel: "Advisory", rank, tone: "info" };
  }
  if (snapshot.alert?.state === "healthy") {
    return { baseLabel: "Healthy", rank, tone: "success" };
  }
  return { baseLabel: "Monitoring", rank, tone: "info" };
}

function createStatusPresentation(
  label: string,
  baseLabel: string,
  mode: HostResourceStatusMode,
  rank: 0 | 1 | 2 | 3,
  tone: HostResourceStatusTone,
  unreadCount: number,
): HostResourceStatusPresentation {
  const variant = STATUS_VARIANTS[tone];
  const normalizedUnreadCount =
    Number.isFinite(unreadCount) && unreadCount > 0
      ? Math.floor(unreadCount)
      : 0;
  const hasBadge = normalizedUnreadCount > 0 || rank > 0;

  return {
    label,
    baseLabel,
    mode,
    rank,
    tone,
    ...variant,
    badgeLabel: hasBadge
      ? normalizedUnreadCount > 0
        ? `${normalizedUnreadCount} unread host incidents`
        : "Active host incident"
      : undefined,
    badgeText: hasBadge
      ? normalizedUnreadCount > 0
        ? `${Math.min(normalizedUnreadCount, 99)}`
        : "!"
      : undefined,
  };
}

export type HostResourceWatchReason =
  | "connected"
  | "auto-connect"
  | "connected-and-auto-connect";

export interface MultiHostResourceEntry {
  profile: ServerProfile;
  owner: ConnectionRef;
  connectionStatus: ConnectionStatus;
  connected: boolean;
  watchReason: HostResourceWatchReason;
  snapshot?: HostResourceSnapshotV1;
  status: HostResourceStatusPresentation;
  unreadCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isStale: boolean;
}

export interface HostResourceFleetSummary {
  watchedCount: number;
  connectedCount: number;
  attentionCount: number;
  unavailableCount: number;
  unreadCount: number;
  presentation: HostResourceStatusPresentation;
}

export interface UseMultiHostResourcesResult {
  configuredProfileCount: number;
  entries: MultiHostResourceEntry[];
  summary: HostResourceFleetSummary;
}

export function resolveHostResourceWatchReason(
  connected: boolean,
  autoConnect?: boolean,
): HostResourceWatchReason | undefined {
  if (connected && autoConnect) {
    return "connected-and-auto-connect";
  }
  if (connected) {
    return "connected";
  }
  if (autoConnect) {
    return "auto-connect";
  }
  return undefined;
}

export function resolveHostResourceEntryStatus({
  snapshot,
  connectionStatus,
  connected,
  isLoading = false,
  isFetching = false,
  isError = false,
  isStale = false,
  unreadCount = 0,
}: HostResourceStatusInput & {
  connectionStatus: ConnectionStatus;
  connected: boolean;
}): HostResourceStatusPresentation {
  if (!connected) {
    const connLabel =
      connectionStatus === "offline" ? "Offline" : "Disconnected";
    if (snapshot) {
      const { baseLabel, rank, tone } = getBaseStatus(snapshot);
      const qualifier = `last known (${connLabel.toLowerCase()})`;
      return createStatusPresentation(
        `${baseLabel} · ${qualifier}`,
        baseLabel,
        "unavailable",
        rank,
        rank > 0 ? tone : "warning",
        unreadCount,
      );
    }
    return createStatusPresentation(
      connLabel,
      connLabel,
      "terminal-unavailable",
      0,
      "warning",
      unreadCount,
    );
  }

  return resolveHostResourceStatus({
    snapshot,
    isLoading,
    isFetching,
    isError,
    isStale,
    unreadCount,
  });
}

export function resolveHostResourceFleetSummary(
  entries: readonly MultiHostResourceEntry[],
): HostResourceFleetSummary {
  const watchedCount = entries.length;
  let connectedCount = 0;
  let attentionCount = 0;
  let unavailableCount = 0;
  let unreadCount = 0;

  let highestRank: 0 | 1 | 2 | 3 = 0;
  let hasSampling = false;
  let hasStale = false;
  let allHealthy = entries.length > 0;

  for (const entry of entries) {
    if (entry.connected) {
      connectedCount++;
    }

    if (entry.status.rank > 0) {
      attentionCount++;
      if (entry.status.rank > highestRank) {
        highestRank = entry.status.rank;
      }
    }

    const isEntryUnavailable =
      !entry.connected ||
      entry.isError ||
      entry.status.mode === "terminal-unavailable" ||
      entry.status.mode === "unavailable" ||
      entry.status.mode === "refresh-error";

    if (isEntryUnavailable) {
      unavailableCount++;
    }

    if (
      entry.isLoading ||
      entry.isFetching ||
      entry.status.mode === "sampling" ||
      entry.status.mode === "background-loading"
    ) {
      hasSampling = true;
    }

    if (
      entry.isStale ||
      entry.status.mode === "stale" ||
      entry.status.mode === "stale-refreshing"
    ) {
      hasStale = true;
    }

    if (
      entry.status.rank > 0 ||
      isEntryUnavailable ||
      entry.status.baseLabel !== "Healthy"
    ) {
      allHealthy = false;
    }

    unreadCount += entry.unreadCount;
  }

  let presentation: HostResourceStatusPresentation;

  if (entries.length === 0) {
    presentation = createStatusPresentation(
      "No watched profiles",
      "No watched profiles",
      "terminal-unavailable",
      0,
      "info",
      0,
    );
  } else if (highestRank === 3) {
    presentation = createStatusPresentation(
      "Critical",
      "Critical",
      "current",
      3,
      "critical",
      unreadCount,
    );
  } else if (highestRank === 2) {
    presentation = createStatusPresentation(
      "Warning",
      "Warning",
      "current",
      2,
      "warning",
      unreadCount,
    );
  } else if (highestRank === 1) {
    presentation = createStatusPresentation(
      "Advisory",
      "Advisory",
      "current",
      1,
      "info",
      unreadCount,
    );
  } else if (unavailableCount > 0) {
    const label =
      unavailableCount === watchedCount
        ? "Fleet unavailable"
        : `${unavailableCount} host${unavailableCount === 1 ? "" : "s"} unavailable`;
    presentation = createStatusPresentation(
      label,
      "Unavailable",
      "unavailable",
      0,
      "warning",
      unreadCount,
    );
  } else if (hasSampling) {
    presentation = createStatusPresentation(
      "Sampling fleet",
      "Sampling fleet",
      "sampling",
      0,
      "info",
      unreadCount,
    );
  } else if (hasStale) {
    presentation = createStatusPresentation(
      "Fleet data stale",
      "Fleet data stale",
      "stale",
      0,
      "warning",
      unreadCount,
    );
  } else if (allHealthy) {
    presentation = createStatusPresentation(
      "Healthy",
      "Healthy",
      "current",
      0,
      "success",
      unreadCount,
    );
  } else {
    presentation = createStatusPresentation(
      "Monitoring",
      "Monitoring",
      "current",
      0,
      "info",
      unreadCount,
    );
  }

  return {
    watchedCount,
    connectedCount,
    attentionCount,
    unavailableCount,
    unreadCount,
    presentation,
  };
}

