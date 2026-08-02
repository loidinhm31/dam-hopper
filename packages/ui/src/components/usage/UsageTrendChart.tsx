import type { UsageBucket, UsageTimeBucket } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import {
  formatCompactUsageNumber,
  formatUsageBucketLabel,
  formatUsageNumber,
} from "./UsageFormatters.js";

export type UsageTrendMetric = "commands" | "duration" | "tokens";

export interface UsageTrendChartProps {
  series: readonly UsageTimeBucket[];
  bucket: UsageBucket;
  metric?: UsageTrendMetric;
  title?: string;
  className?: string;
}

function valueFor(bucket: UsageTimeBucket, metric: UsageTrendMetric): number {
  if (metric === "duration") return bucket.terminal.durationMsSum;
  if (metric === "tokens") {
    const tokens = bucket.codex;
    return tokens
      ? Math.max(
          0,
          (tokens.inputTokens ?? 0) - (tokens.cachedInputTokens ?? 0),
        ) +
          (tokens.outputTokens ?? 0) +
          (tokens.reasoningTokens ?? 0)
      : 0;
  }
  return bucket.terminal.commandCount;
}

function metricLabel(metric: UsageTrendMetric) {
  if (metric === "duration") return "duration";
  if (metric === "tokens") return "tokens";
  return "commands";
}

export function UsageTrendChart({
  series,
  bucket,
  metric = "commands",
  title = "Usage over time",
  className,
}: UsageTrendChartProps) {
  const ordered = [...series].sort((a, b) => a.startUtcMs - b.startUtcMs);
  const values = ordered.map((entry) => valueFor(entry, metric));
  const max = Math.max(...values, 0);
  const width = 640;
  const height = 180;
  const padding = { top: 16, right: 12, bottom: 26, left: 12 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const points = ordered
    .map((entry, index) => {
      const x =
        padding.left +
        (ordered.length <= 1
          ? innerWidth / 2
          : (index / (ordered.length - 1)) * innerWidth);
      const y =
        padding.top +
        innerHeight -
        (max === 0 ? 0 : (valueFor(entry, metric) / max) * innerHeight);
      return `${x},${y}`;
    })
    .join(" ");
  const labels =
    ordered.length <= 4
      ? ordered
      : ([
          ordered[0],
          ordered[Math.floor(ordered.length / 2)],
          ordered.at(-1),
        ].filter(Boolean) as UsageTimeBucket[]);
  const describedBy = `usage-trend-summary-${metric}`;

  return (
    <section
      className={cn(
        "rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-[var(--color-text)]">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {metricLabel(metric)}
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="flex min-h-40 items-center justify-center rounded border border-dashed border-[var(--color-border)] px-4 text-center text-xs text-[var(--color-text-muted)]">
          No aggregate buckets in this range.
        </p>
      ) : (
        <>
          <p id={describedBy} className="sr-only">
            {title}. {ordered.length} {bucket} buckets. Peak{" "}
            {formatUsageNumber(max)} {metricLabel(metric)}.
          </p>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={describedBy}
            className="block h-44 w-full overflow-visible"
            preserveAspectRatio="none"
          >
            {[0, 0.5, 1].map((position) => {
              const y = padding.top + innerHeight - innerHeight * position;
              return (
                <line
                  key={position}
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            <polyline
              points={points}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {ordered.map((entry, index) => {
              const [x, y] = points.split(" ")[index].split(",");
              return (
                <circle
                  key={entry.startUtcMs}
                  cx={x}
                  cy={y}
                  r="3"
                  fill="var(--color-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${formatUsageBucketLabel(entry.startUtcMs, bucket)}: ${formatUsageNumber(valueFor(entry, metric))} ${metricLabel(metric)}`}</title>
                </circle>
              );
            })}
            {labels.map((entry) => {
              const index = ordered.indexOf(entry);
              const x =
                padding.left +
                (ordered.length <= 1
                  ? innerWidth / 2
                  : (index / (ordered.length - 1)) * innerWidth);
              return (
                <text
                  key={entry.startUtcMs}
                  x={x}
                  y={height - 4}
                  textAnchor="middle"
                  fill="var(--color-text-muted)"
                  fontSize="10"
                >
                  {formatUsageBucketLabel(entry.startUtcMs, bucket)}
                </text>
              );
            })}
          </svg>
          <div className="sr-only">
            <table>
              <caption>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">{metricLabel(metric)}</th>
                  <th scope="col">Commands</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((entry) => (
                  <tr key={entry.startUtcMs}>
                    <th scope="row">
                      {formatUsageBucketLabel(entry.startUtcMs, bucket)}
                    </th>
                    <td>{formatCompactUsageNumber(valueFor(entry, metric))}</td>
                    <td>{formatUsageNumber(entry.terminal.commandCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
