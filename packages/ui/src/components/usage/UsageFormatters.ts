import type { UsageTokens } from "@/api/client.js";

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsageNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? numberFormatter.format(value)
    : "—";
}

export function formatCompactUsageNumber(
  value: number | null | undefined,
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? compactNumberFormatter.format(value)
    : "—";
}

export function formatDuration(
  milliseconds: number | null | undefined,
): string {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds))
    return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000)
    return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  if (milliseconds < 3_600_000) {
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.round((milliseconds % 60_000) / 1_000);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.round((milliseconds % 3_600_000) / 60_000);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function formatPercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): string {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function hasTokenTotal(tokens: UsageTokens | null | undefined): boolean {
  if (!tokens) return false;
  return [tokens.inputTokens, tokens.outputTokens, tokens.reasoningTokens].some(
    (value) => value !== null && value !== undefined,
  );
}

export function hasUsageValue(value: number | null | undefined): boolean {
  return value !== null && value !== undefined;
}

export function formatTokenTotal(
  tokens: UsageTokens | null | undefined,
): string {
  if (!tokens || !hasTokenTotal(tokens)) return "—";
  const uncachedInput = Math.max(
    0,
    (tokens.inputTokens ?? 0) - (tokens.cachedInputTokens ?? 0),
  );
  return formatCompactUsageNumber(
    uncachedInput + (tokens.outputTokens ?? 0) + (tokens.reasoningTokens ?? 0),
  );
}

export function formatUsageBucketLabel(
  startUtcMs: number,
  bucket: "hour" | "day",
): string {
  const date = new Date(startUtcMs);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(bucket === "hour" ? { hour: "numeric" as const } : {}),
  }).format(date);
}
