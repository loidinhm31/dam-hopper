import type { UsageHealth, UsageSummary } from "@/api/client.js";
import { AlertTriangle, CheckCircle2, PauseCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { formatUsageNumber } from "./UsageFormatters.js";

export interface UsageCoveragePanelProps {
  coverage: UsageSummary["coverage"];
  health: UsageHealth;
  className?: string;
}

export function UsageCoveragePanel({ coverage, health, className }: UsageCoveragePanelProps) {
  const correlation = coverage.codexCorrelation;
  const status = !health.available ? "unavailable" : health.paused ? "paused" : health.collector.running ? "collecting" : "idle";
  const statusMeta = {
    unavailable: { label: "Unavailable", icon: AlertTriangle, tone: "text-[var(--color-danger)]", copy: "Telemetry storage is unavailable. Displayed usage may be incomplete." },
    paused: { label: "Paused", icon: PauseCircle, tone: "text-[var(--color-warning)]", copy: "Collection is paused. Existing aggregates remain available." },
    collecting: { label: "Collecting", icon: Radio, tone: "text-[var(--color-success)]", copy: "Aggregate telemetry is collecting locally." },
    idle: { label: "Idle", icon: Radio, tone: "text-[var(--color-text-muted)]", copy: "The collector is not currently running." },
  }[status];
  const StatusIcon = statusMeta.icon;

  return (
    <aside aria-labelledby="usage-coverage-heading" className={cn("rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="usage-coverage-heading" className="text-xs font-semibold text-[var(--color-text)]">Coverage & collection</h3>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">{coverage.detailOnly ? "This range is backed by detail retention." : "This range includes retained rollups; percentile and repeat details may be unavailable."}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 text-[10px] font-medium", statusMeta.tone)}><StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />{statusMeta.label}</span>
      </div>
      <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-text-muted)]">{statusMeta.copy}</p>
      {coverage.captureQualityFilter ? <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Capture filter: <span className="text-[var(--color-text)]">{coverage.captureQualityFilter}</span></p> : null}
      {correlation ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3 text-center">
          <div><dt className="text-[10px] text-[var(--color-text-muted)]">Exact</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatUsageNumber(correlation.exact)}</dd></div>
          <div><dt className="text-[10px] text-[var(--color-text-muted)]">Approx.</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatUsageNumber(correlation.approximate)}</dd></div>
          <div><dt className="text-[10px] text-[var(--color-text-muted)]">Unattributed</dt><dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatUsageNumber(correlation.unattributed)}</dd></div>
        </dl>
      ) : <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-[10px] text-[var(--color-text-muted)]">No Codex correlation data for this selection.</p>}
      {(health.writerErrors > 0 || health.rejectedEvents > 0) ? <p className="mt-3 flex items-center gap-1.5 rounded bg-[var(--color-danger)]/10 px-2 py-1.5 text-[10px] leading-4 text-[var(--color-text)]"><AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />{formatUsageNumber(health.writerErrors)} writer errors · {formatUsageNumber(health.rejectedEvents)} rejected events</p> : <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]"><CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-success)]" />No writer or rejection errors reported.</p>}
    </aside>
  );
}
