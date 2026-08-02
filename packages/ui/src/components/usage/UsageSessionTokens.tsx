import type { UsageSessionCoverage, UsageTokens } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import {
  formatCompactUsageNumber,
  formatDuration,
  formatUsageNumber,
  formatTokenTotal,
} from "./UsageFormatters.js";

export interface UsageSessionTokensProps {
  tokens: UsageTokens;
  mainTokenShare?: number | null;
  compact?: boolean;
  className?: string;
}

export interface UsageSessionCoverageProps {
  coverage: UsageSessionCoverage;
  className?: string;
}

const coverageLabels = {
  lineage: {
    exact: "Lineage exact",
    partial: "Lineage partial",
    lineage_unavailable: "Lineage unavailable",
  },
  tokens: {
    exact: "Token coverage exact",
    partial: "Token coverage partial",
    token_data_unavailable: "Token data unavailable",
  },
  correlation: {
    exact: "Correlation exact",
    approximate: "Correlation approximate",
    unattributed: "Correlation unavailable",
  },
} as const;

export function UsageSessionTokens({
  tokens,
  mainTokenShare,
  compact = false,
  className,
}: UsageSessionTokensProps) {
  const primaryTotal = formatTokenTotal(tokens);
  const share =
    typeof mainTokenShare === "number" && Number.isFinite(mainTokenShare)
      ? `${Math.round(mainTokenShare * 100)}%`
      : "—";

  if (compact) {
    return (
      <dl
        className={cn(
          "flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-[var(--color-text-muted)]",
          className,
        )}
      >
        <div>
          <dt className="sr-only">Primary tokens</dt>
          <dd>
            <span className="font-medium text-[var(--color-text)]">
              {primaryTotal}
            </span>{" "}
            primary tokens
          </dd>
        </div>
        <div>
          <dt className="sr-only">Responses</dt>
          <dd>
            Responses:{" "}
            <span className="tabular-nums text-[var(--color-text)]">
              {tokens.responseCount ?? "—"}
            </span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Response duration</dt>
          <dd>
            Response time:{" "}
            <span className="tabular-nums text-[var(--color-text)]">
              {formatDuration(tokens.durationMs)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Cached input</dt>
          <dd>
            Cached input:{" "}
            <span className="tabular-nums text-[var(--color-text)]">
              {formatCompactUsageNumber(tokens.cachedInputTokens)}
            </span>
          </dd>
        </div>
        {mainTokenShare !== undefined ? (
          <div>
            <dt className="sr-only">Main share</dt>
            <dd>
              Main share:{" "}
              <span className="tabular-nums text-[var(--color-text)]">
                {share}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    );
  }

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4",
        className,
      )}
    >
      <div>
        <dt className="text-[var(--color-text-muted)]">Primary tokens</dt>
        <dd className="font-medium tabular-nums text-[var(--color-text)]">
          {primaryTotal}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Responses</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {tokens.responseCount ?? "—"}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Response time</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {formatDuration(tokens.durationMs)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Cached input</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {formatUsageNumber(tokens.cachedInputTokens)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Input</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {formatUsageNumber(tokens.inputTokens)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Output</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {formatUsageNumber(tokens.outputTokens)}
        </dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Reasoning</dt>
        <dd className="tabular-nums text-[var(--color-text)]">
          {formatUsageNumber(tokens.reasoningTokens)}
        </dd>
      </div>
      {mainTokenShare !== undefined ? (
        <div>
          <dt className="text-[var(--color-text-muted)]">Main share</dt>
          <dd className="tabular-nums text-[var(--color-text)]">{share}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function UsageSessionCoverage({
  coverage,
  className,
}: UsageSessionCoverageProps) {
  return (
    <ul
      aria-label="Coverage"
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      <li className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
        {coverageLabels.lineage[coverage.lineage]}
      </li>
      <li className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
        {coverageLabels.tokens[coverage.tokens]}
      </li>
      <li className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
        {coverageLabels.correlation[coverage.correlation]}
      </li>
    </ul>
  );
}
