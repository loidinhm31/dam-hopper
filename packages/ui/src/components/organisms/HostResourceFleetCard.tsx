import { Activity, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import type { MultiHostResourceEntry } from "@/hooks/use-multi-host-resources.js";
import {
  formatBatteryCapacity,
  formatBatteryStatus,
  formatSampleAge,
  resolveHostResourceMemory,
  type HostResourceStatusPresentation,
} from "@/lib/host-resource-state.js";
import { formatBytes } from "@/lib/host-metrics-format.js";
import { cn } from "@/lib/utils.js";

export interface HostResourceFleetCardProps {
  entry: MultiHostResourceEntry;
  selected?: boolean;
  onInspect: (profileId: string) => void;
}

export function HostResourceFleetCard({
  entry,
  selected = false,
  onInspect,
}: HostResourceFleetCardProps) {
  const { profile, connected, connectionStatus, watchReason, snapshot, status, unreadCount } =
    entry;

  const memory = resolveHostResourceMemory(undefined, snapshot);
  const battery = snapshot?.battery;
  const batteryCapacity = formatBatteryCapacity(battery?.capacityPercent);
  const batteryStatus = formatBatteryStatus(battery?.status);

  const sampleAge = formatSampleAge(snapshot?.sampledAt);
  const sampleLabel = sampleAge
    ? connected
      ? `Sampled ${sampleAge} ago`
      : `Last known · sampled ${sampleAge} ago`
    : !connected && snapshot
      ? "Last known snapshot"
      : undefined;

  const hostIdentity = [snapshot?.host?.hostname, snapshot?.host?.osName]
    .filter(Boolean)
    .join(" · ");

  const connectionLabel = connected
    ? "Connected"
    : connectionStatus === "offline"
      ? watchReason === "auto-connect" ? "Offline · Auto-connect" : "Offline"
      : connectionStatus === "connecting"
        ? "Connecting"
        : watchReason === "auto-connect" ? "Disconnected · Auto-connect" : "Disconnected";

  const inspectAriaLabel = `Inspect host resources for ${profile.name}: ${status.label}`;

  const facts: string[] = [];
  if (memory.value !== undefined) {
    const memPercent = `${Math.round(memory.value)}%`;
    if (memory.usedBytes !== undefined && memory.totalBytes !== undefined) {
      facts.push(`Memory: ${memPercent} (${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)})`);
    } else {
      facts.push(`Memory: ${memPercent}`);
    }
  }
  if (batteryCapacity || batteryStatus) {
    const batteryText = [batteryCapacity, batteryStatus].filter(Boolean).join(" · ");
    facts.push(`Battery: ${batteryText}`);
  }

  const cardContent = (
    <div className="flex flex-col gap-2 p-3">
      {/* Header: Profile Name & Connection Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[var(--color-text)] [overflow-wrap:anywhere] break-words text-sm leading-snug">
            {profile.name}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere] break-words">
            {profile.url}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            connected
              ? "bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30"
              : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
          )}
        >
          {connectionLabel}
        </span>
      </div>

      {/* Status Tone & Unread Incidents */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusIcon presentation={status} />
          <span
            className={cn(
              "font-medium truncate",
              status.statusClassName,
            )}
          >
            {status.label}
          </span>
        </div>
        {unreadCount > 0 && (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
              status.badgeClassName,
            )}
          >
            {unreadCount} unread
          </span>
        )}
      </div>

      {/* Host Identity & Sample Age */}
      {(hostIdentity || sampleLabel) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
          {hostIdentity && (
            <span className="[overflow-wrap:anywhere] break-words font-mono text-[10px]">
              {hostIdentity}
            </span>
          )}
          {hostIdentity && sampleLabel && <span aria-hidden="true">·</span>}
          {sampleLabel && <span>{sampleLabel}</span>}
        </div>
      )}

      {/* Optional Facts: Memory & Battery */}
      {facts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)]/60 pt-2">
          {facts.map((fact) => (
            <span key={fact} className="font-mono text-[11px]">
              {fact}
            </span>
          ))}
        </div>
      )}

      {/* Action Affordance or Disconnected Explanation */}
      {connected ? (
        <div className="flex items-center justify-end gap-1 text-[11px] font-medium text-[var(--color-primary)] pt-1">
          <span>Inspect</span>
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-text-muted)] pt-1 italic">
          Connect profile to inspect live resources
        </div>
      )}
    </div>
  );

  return (
    <article
      data-profile-id={profile.id}
      className={cn(
        "rounded-md border bg-[var(--color-surface)] transition-colors",
        selected
          ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]"
          : "border-[var(--color-border)]",
        connected && "hover:border-[var(--color-primary)]/60",
      )}
    >
      {connected ? (
        <button
          type="button"
          onClick={() => onInspect(profile.id)}
          aria-label={inspectAriaLabel}
          className="min-h-11 w-full text-left rounded-md focus-visible:outline-2 focus-visible:outline-[var(--color-ring)] focus-visible:outline-offset-2 hover:bg-[var(--color-surface-2)]/50 transition-colors"
        >
          {cardContent}
        </button>
      ) : (
        cardContent
      )}
    </article>
  );
}

function StatusIcon({ presentation }: { presentation: HostResourceStatusPresentation }) {
  const Icon =
    presentation.icon === "healthy" ? CheckCircle2 : presentation.icon === "alert" ? AlertTriangle : Activity;
  return <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", presentation.statusIconClassName)} />;
}
