import { useCallback, useContext, useMemo } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { Activity, AlertTriangle, Moon, ShieldAlert } from "lucide-react";
import { useHostMetrics, useIdleSuspendStatus } from "@/api/queries.js";
import { useMultiHostResources } from "@/hooks/use-multi-host-resources.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { dispatchIntent, createIntent } from "./intents.js";

export interface MonitorTrayProps {
  onOpenMonitor?: (profileId?: string, incidentId?: string) => void;
  className?: string;
}

export function MonitorTray(props: MonitorTrayProps) {
  const qc = useContext(QueryClientContext);
  if (!qc) {
    return null;
  }
  return <MonitorTrayInner {...props} />;
}

function MonitorTrayInner({ onOpenMonitor, className = "" }: MonitorTrayProps) {
  const multiResources = useMultiHostResources({ enabled: true });
  const activeProfile = useServerProfile();
  const cognitoActive = useCognitoModeStore((state) => state.active);
  const idleStatus = useIdleSuspendStatus(Boolean(activeProfile?.id), activeProfile ? { profileId: activeProfile.id } : undefined);
  const unreadIds = useHostResourceAlertPresentationStore((state) => state.unreadIds);
  const byProfile = useHostResourceAlertPresentationStore((state) => state.byProfile);

  // Active or first monitored host
  const activeEntry = useMemo(() => {
    if (activeProfile?.id) {
      const match = multiResources.entries.find((e) => e.profile.id === activeProfile.id);
      if (match) return match;
    }
    return multiResources.entries[0] ?? null;
  }, [activeProfile, multiResources.entries]);

  // First unread alert target if any
  let alertTarget: { profileId: string; incidentId: string } | null = null;
  if (unreadIds.length > 0) {
    for (const [profId, data] of Object.entries(byProfile)) {
      if (data.unreadIds.length > 0) {
        alertTarget = { profileId: profId, incidentId: data.unreadIds[0] };
        break;
      }
    }
    if (!alertTarget && activeEntry?.profile.id) {
      alertTarget = { profileId: activeEntry.profile.id, incidentId: unreadIds[0] };
    }
  }

  const handleOpen = useCallback(
    (profileId?: string, incidentId?: string) => {
      if (onOpenMonitor) {
        onOpenMonitor(profileId, incidentId);
        return;
      }
      if (profileId && incidentId) {
        void dispatchIntent(
          createIntent("monitor:alert", {
            profileId,
            incidentId,
          }),
        );
      } else {
        void dispatchIntent(
          createIntent("system:monitor", {
            profileId: profileId ?? activeEntry?.profile.id,
          }),
        );
      }
    },
    [onOpenMonitor, activeEntry?.profile.id],
  );

  const isConnected = activeEntry?.connected ?? false;
  const isStale = isConnected ? (activeEntry?.isStale ?? false) : false;
  const hostMetrics = useHostMetrics(Boolean(activeEntry && isConnected), activeEntry?.owner);
  const cpuPercent = hostMetrics.data?.cpu?.usagePercent;
  const memoryBytes = activeEntry?.snapshot?.memory;

  const memPercent = useMemo(() => {
    if (!memoryBytes || !memoryBytes.totalBytes || memoryBytes.availableBytes == null) {
      return undefined;
    }
    const used = memoryBytes.totalBytes - memoryBytes.availableBytes;
    return Math.max(0, Math.min(100, (used / memoryBytes.totalBytes) * 100));
  }, [memoryBytes]);

  // Honest status text and color
  const statusDisplay = useMemo(() => {
    if (!activeEntry || !isConnected) {
      return { label: "Offline", dotColor: "bg-neutral-500", live: false };
    }
    const mode = activeEntry.status?.mode;
    if (mode === "terminal-unavailable" || mode === "unavailable") {
      return { label: "Offline", dotColor: "bg-neutral-500", live: false };
    }
    if (mode === "stale-refreshing" || isStale) {
      return { label: "Stale", dotColor: "bg-yellow-500", live: false };
    }
    if (mode === "sampling" || mode === "background-loading") {
      return { label: "Connecting", dotColor: "bg-blue-500", live: false };
    }
    if (mode === "refresh-error") {
      return { label: "Error", dotColor: "bg-red-500", live: false };
    }
    return { label: "Live", dotColor: "bg-emerald-500", live: true };
  }, [activeEntry, isConnected, isStale]);

  const profileLabel = cognitoActive
    ? "Protected"
    : activeEntry?.profile.name ?? activeEntry?.profile.id ?? "Host";

  const cpuText = cognitoActive
    ? "●●●"
    : typeof cpuPercent === "number"
      ? `${Math.round(cpuPercent)}%`
      : "—";

  const memText = cognitoActive
    ? "●●●"
    : typeof memPercent === "number"
      ? `${Math.round(memPercent)}%`
      : "—";

  return (
    <div
      data-testid="os-monitor-tray"
      className={`flex items-center gap-1.5 select-none ${className}`}
    >
      {/* Alert Dot Button (Opens Monitor at exact incident) */}
      {alertTarget && (
        <button
          type="button"
          aria-label={
            cognitoActive
              ? "System Alert: active incident"
              : `System Alert: ${unreadIds.length} unread host incident(s)`
          }
          title={
            cognitoActive
              ? "System Alert: active incident"
              : `Alert on ${alertTarget.profileId}: click to inspect incident`
          }
          onClick={() => handleOpen(alertTarget.profileId, alertTarget.incidentId)}
          className="relative flex items-center justify-center p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-danger)] transition-colors animate-pulse"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--color-danger)]" />
        </button>
      )}

      {/* Main Mini Meters Pill */}
      <button
        type="button"
        aria-label={
          cognitoActive
            ? "System Monitor Tray (Protected)"
            : `System Monitor: ${profileLabel} (${statusDisplay.label}), CPU ${cpuText}, MEM ${memText}`
        }
        title={
          cognitoActive
            ? "System Monitor: Protected"
            : `${profileLabel} [${statusDisplay.label}] · CPU ${cpuText} · MEM ${memText}`
        }
        onClick={() => handleOpen(activeEntry?.profile.id)}
        className="flex items-center gap-2 px-2 py-0.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-primary)] text-[10px] font-mono text-[var(--color-text)] transition-colors max-w-[190px] sm:max-w-none"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDisplay.dotColor}`}
        />
        {idleStatus.data?.state === "armed" && (
          <span
            title="Host idle suspend armed"
            aria-label="Host idle suspend armed"
            className="flex items-center text-[var(--color-warning)]"
          >
            <Moon className="h-3 w-3" />
          </span>
        )}

        {cognitoActive ? (
          <span className="flex items-center gap-1 text-[var(--color-text-muted)] text-[9px]">
            <ShieldAlert className="h-2.5 w-2.5" />
            <span>PROTECTED</span>
          </span>
        ) : !isConnected ? (
          <span className="text-[var(--color-text-muted)]">{statusDisplay.label}</span>
        ) : (
          <div className="flex items-center gap-2 text-[10px]">
            {/* CPU meter */}
            <span className="inline-flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">C:</span>
              <span
                className={
                  typeof cpuPercent === "number" && cpuPercent > 85
                    ? "text-[var(--color-danger)] font-bold"
                    : "text-[var(--color-text)]"
                }
              >
                {cpuText}
              </span>
            </span>

            {/* MEM meter */}
            <span className="inline-flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">M:</span>
              <span
                className={
                  typeof memPercent === "number" && memPercent > 85
                    ? "text-[var(--color-warning)] font-bold"
                    : "text-[var(--color-text)]"
                }
              >
                {memText}
              </span>
            </span>
          </div>
        )}
      </button>
    </div>
  );
}
