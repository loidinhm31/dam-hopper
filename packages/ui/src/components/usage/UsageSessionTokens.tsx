import type { UsageTokens } from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import {
  formatCompactUsageNumber,
  formatDuration,
  formatUsageNumber,
  formatTokenTotal,
} from "./UsageFormatters.js";

export interface UsageSessionTokensProps {
  tokens: UsageTokens;
  compact?: boolean;
  className?: string;
}

export function UsageSessionTokens({
  tokens,
  compact = false,
  className,
}: UsageSessionTokensProps) {
  if (compact) {
    return (
      <dl
        className={cn(
          "flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-[var(--color-text-muted)]",
          className,
        )}
      >
        <div>
          <dt className="sr-only">Total tokens</dt>
          <dd>
            <span className="font-medium text-[var(--color-text)]">
              {formatTokenTotal(tokens)}
            </span>{" "}
            tokens
          </dd>
        </div>
        <div>
          <dt className="sr-only">Responses</dt>
          <dd>
            Responses: <span className="tabular-nums text-[var(--color-text)]">{tokens.responseCount ?? "—"}</span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Response duration</dt>
          <dd>
            Duration: <span className="tabular-nums text-[var(--color-text)]">{formatDuration(tokens.durationMs)}</span>
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4", className)}>
      <div>
        <dt className="text-[var(--color-text-muted)]">Total tokens</dt>
        <dd className="font-medium tabular-nums text-[var(--color-text)]">{formatTokenTotal(tokens)}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Responses</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{tokens.responseCount ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Response time</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{formatDuration(tokens.durationMs)}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Cached input</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{formatCompactUsageNumber(tokens.cachedInputTokens)}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Input</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{formatUsageNumber(tokens.inputTokens)}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Output</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{formatUsageNumber(tokens.outputTokens)}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-text-muted)]">Reasoning</dt>
        <dd className="tabular-nums text-[var(--color-text)]">{formatUsageNumber(tokens.reasoningTokens)}</dd>
      </div>
    </dl>
  );
}
