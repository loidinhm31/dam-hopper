import { Activity, Clock3 } from "lucide-react";
import type { UsageSummary } from "@/api/client.js";
import { UsageBreakdown } from "./UsageBreakdown.js";
import { UsageCoveragePanel } from "./UsageCoveragePanel.js";
import {
  formatDuration,
  formatPercent,
  formatTokenTotal,
  formatUsageNumber,
  hasTokenTotal,
  hasUsageValue,
} from "./UsageFormatters.js";
import { UsageMetricCard } from "./UsageMetricCard.js";
import { UsageTrendChart } from "./UsageTrendChart.js";

export interface UsageOverviewProps {
  summary?: UsageSummary;
  loading: boolean;
  errorMessage?: string;
}

export function UsageOverview({
  summary,
  loading,
  errorMessage,
}: UsageOverviewProps) {
  const detail = summary?.detailMetrics;
  return (
    <section
      id="usage-overview-panel"
      role="tabpanel"
      aria-labelledby="usage-overview-tab"
      className="space-y-4"
    >
      {loading ? (
        <p className="rounded glass-card p-6 text-sm text-[var(--color-text-muted)]">
          Loading aggregate usage…
        </p>
      ) : null}
      {errorMessage ? (
        <p
          role="alert"
          className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-4 text-sm text-[var(--color-text)]"
        >
          {errorMessage}
        </p>
      ) : null}
      {summary ? (
        <>
          <UsageCoveragePanel
            coverage={summary.coverage}
            health={summary.health}
          />
          <section
            aria-label="Terminal aggregate metrics"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <UsageMetricCard
              label="Commands"
              value={formatUsageNumber(summary.terminal.commandCount)}
              icon={Activity}
              tone="primary"
              description={`${formatUsageNumber(summary.terminal.succeededCount)} succeeded · ${formatUsageNumber(summary.terminal.failedCount)} failed`}
            />
            <UsageMetricCard
              label="Active execution"
              value={formatDuration(summary.terminal.durationMsSum)}
              icon={Clock3}
              description="Total command execution time in this range."
            />
            <UsageMetricCard
              label="P50 duration"
              value={formatDuration(detail?.durationP50Ms)}
              unavailable={!detail}
              description={
                detail
                  ? "Median completed command duration."
                  : "Available only within detail retention."
              }
            />
            <UsageMetricCard
              label="P95 duration"
              value={formatDuration(detail?.durationP95Ms)}
              unavailable={!detail}
              description={
                detail
                  ? "Nearest-rank 95th percentile."
                  : "Available only within detail retention."
              }
            />
            <UsageMetricCard
              label="Repeated commands"
              value={formatUsageNumber(detail?.repeatedCommandCount)}
              unavailable={!detail}
              description={
                detail
                  ? "Additional occurrences of a retained command fingerprint."
                  : "Available only within detail retention."
              }
            />
          </section>
          <section className="grid gap-3 lg:grid-cols-2">
            <UsageTrendChart
              series={summary.timeSeries}
              bucket={summary.range.bucket}
              metric="commands"
              title="Terminal commands over time"
            />
            <UsageTrendChart
              series={summary.timeSeries}
              bucket={summary.range.bucket}
              metric="tokens"
              title="Codex tokens over time"
            />
          </section>
          <section
            aria-label="Terminal breakdowns"
            className="grid gap-3 lg:grid-cols-2"
          >
            <UsageBreakdown title="Categories" entries={summary.categories} />
            <UsageBreakdown title="Projects" entries={summary.projects} />
          </section>
          <section
            aria-label="Codex aggregate metrics"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-semibold text-[var(--color-text)]">
                Codex usage
              </h2>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                No cost estimates
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UsageMetricCard
                label="Total tokens"
                value={formatTokenTotal(summary.codex)}
                unavailable={!hasTokenTotal(summary.codex)}
                description="Input, output, and reasoning token components."
              />
              <UsageMetricCard
                label="Input tokens"
                value={formatUsageNumber(summary.codex?.inputTokens)}
                unavailable={!hasUsageValue(summary.codex?.inputTokens)}
              />
              <UsageMetricCard
                label="Cached input"
                value={formatUsageNumber(summary.codex?.cachedInputTokens)}
                unavailable={!hasUsageValue(summary.codex?.cachedInputTokens)}
              />
              <UsageMetricCard
                label="Output tokens"
                value={formatUsageNumber(summary.codex?.outputTokens)}
                unavailable={!hasUsageValue(summary.codex?.outputTokens)}
              />
              <UsageMetricCard
                label="Reasoning tokens"
                value={formatUsageNumber(summary.codex?.reasoningTokens)}
                unavailable={!hasUsageValue(summary.codex?.reasoningTokens)}
              />
              <UsageMetricCard
                label="Cache ratio"
                value={formatPercent(
                  summary.codex?.cachedInputTokens,
                  summary.codex?.inputTokens,
                )}
                unavailable={!summary.codex}
                description="Cached input ÷ reported input tokens."
              />
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
