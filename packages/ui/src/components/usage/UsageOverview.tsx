import { Clock3, MessageSquare, Sigma } from "lucide-react";
import type { UsageSummary } from "@/api/client.js";
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
  return (
    <section
      id="usage-overview-panel"
      role="tabpanel"
      aria-labelledby="usage-overview-tab"
      className="space-y-4"
    >
      {loading ? (
        <p className="rounded glass-card p-6 text-sm text-[var(--color-text-muted)]">
          Loading Codex usage…
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
          <UsageCoveragePanel health={summary.health} />
          <section
            aria-label="Codex aggregate metrics"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <UsageMetricCard
              label="Total tokens"
              value={formatTokenTotal(summary.codex)}
              icon={Sigma}
              tone="primary"
              unavailable={!hasTokenTotal(summary.codex)}
              description="Uncached input, output, and reasoning tokens."
            />
            <UsageMetricCard
              label="Responses"
              value={formatUsageNumber(summary.codex?.responseCount)}
              icon={MessageSquare}
              unavailable={summary.codex?.responseCount == null}
              description="Codex response completions in this range."
            />
            <UsageMetricCard
              label="Response time"
              value={formatDuration(summary.codex?.durationMs)}
              icon={Clock3}
              unavailable={summary.codex?.durationMs == null}
              description="Sum of durations reported by Codex completions."
            />
            <UsageMetricCard
              label="Cache ratio"
              value={formatPercent(
                summary.codex?.cachedInputTokens,
                summary.codex?.inputTokens,
              )}
              unavailable={!summary.codex}
              description="Cached input divided by reported input tokens."
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
          </section>
          <UsageTrendChart
            series={summary.timeSeries}
            bucket={summary.range.bucket}
            metric="tokens"
            title="Codex tokens over time"
          />
        </>
      ) : null}
    </section>
  );
}
