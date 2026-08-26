import type { UsageHealth } from "@/api/client.js";
import { AlertTriangle, CheckCircle2, PauseCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { formatUsageNumber } from "./UsageFormatters.js";

export interface UsageCoveragePanelProps {
  health: UsageHealth;
  className?: string;
}

export function UsageCoveragePanel({
  health,
  className,
}: UsageCoveragePanelProps) {
  const status = !health.available
    ? "unavailable"
    : health.paused
      ? "paused"
      : health.collector.running
        ? "collecting"
        : "idle";
  const statusMeta = {
    unavailable: {
      label: "Unavailable",
      icon: AlertTriangle,
      tone: "text-[var(--color-danger)]",
      copy: "Codex telemetry storage is unavailable.",
    },
    paused: {
      label: "Paused",
      icon: PauseCircle,
      tone: "text-[var(--color-warning)]",
      copy: "Collection is paused. Stored Codex summaries remain available.",
    },
    collecting: {
      label: "Collecting",
      icon: Radio,
      tone: "text-[var(--color-success)]",
      copy: "Codex response telemetry is collecting locally.",
    },
    idle: {
      label: "Idle",
      icon: Radio,
      tone: "text-[var(--color-text-muted)]",
      copy: "The Codex receiver is not currently running.",
    },
  }[status];
  const StatusIcon = statusMeta.icon;

  return (
    <aside
      aria-labelledby="usage-coverage-heading"
      className={cn(
        "rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="usage-coverage-heading"
            className="text-xs font-semibold text-[var(--color-text)]"
          >
            Codex receiver health
          </h3>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
            {statusMeta.copy}
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-[10px] font-medium",
            statusMeta.tone,
          )}
        >
          <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {statusMeta.label}
        </span>
      </div>
      {health.writerErrors > 0 || health.rejectedEvents > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 rounded bg-[var(--color-danger)]/10 px-2 py-1.5 text-[10px] leading-4 text-[var(--color-text)]">
          <AlertTriangle
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]"
          />
          {formatUsageNumber(health.writerErrors)} writer errors · {formatUsageNumber(health.rejectedEvents)} rejected events
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <CheckCircle2
            aria-hidden="true"
            className="h-3.5 w-3.5 text-[var(--color-success)]"
          />
          No writer or rejection errors reported.
        </p>
      )}
    </aside>
  );
}
