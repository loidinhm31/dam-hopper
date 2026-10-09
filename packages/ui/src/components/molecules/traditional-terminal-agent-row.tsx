import { useId, type JSX } from "react";
import { Activity, Ban, Circle, CircleAlert, CircleHelp, TriangleAlert, Unplug } from "lucide-react";
import type { TraditionalTerminalAgentRow as TraditionalTerminalAgentRowModel } from "@/lib/traditional-terminal-agents.js";
import { cn } from "@/lib/utils.js";

export interface TraditionalTerminalAgentRowProps {
  readonly row: TraditionalTerminalAgentRowModel;
  readonly active: boolean;
  readonly onSelectAgent: (sessionId: string) => void;
  readonly touchOptimized?: boolean;
}

const STATUS_STYLES = {
  Working: { Icon: Activity, className: "text-[var(--color-info)]" },
  Idle: { Icon: Circle, className: "text-[var(--color-text)]" },
  "Needs attention": { Icon: CircleAlert, className: "text-[var(--color-warning)]" },
  Unknown: { Icon: CircleHelp, className: "text-[var(--color-text-muted)] border-dashed" },
  Unavailable: { Icon: Unplug, className: "text-[var(--color-text-muted)]" },
  "Platform unqualified": { Icon: TriangleAlert, className: "text-[var(--color-warning)]" },
  Unsupported: { Icon: Ban, className: "text-[var(--color-text-muted)]" },
} as const;

/** Render only the caller's fenced presentation; never rejoin live status here. */
export function TraditionalTerminalAgentRow({
  row,
  active,
  onSelectAgent,
  touchOptimized = false,
}: TraditionalTerminalAgentRowProps): JSX.Element {
  const descriptionId = useId();
  const { label, reasonLabel, sourceLabel, coverageHint, outcomeHint } = row.presentation;
  const { Icon, className: statusClassName } = STATUS_STYLES[label];
  const context = `${row.harnessLabel}: ${row.terminalTitle}; Project: ${row.projectLabel}; Server profile: ${row.profileLabel}`;
  const sourceExplanation = coverageHint ?? sourceLabel;
  const outcomeExplanation = "Last turn ended; task success has not been verified.";

  return (
    <button
      type="button"
      aria-label={`${context}; ${label}${reasonLabel ? `: ${reasonLabel}` : ""}`}
      aria-describedby={descriptionId}
      aria-current={active ? "true" : undefined}
      title={context}
      onClick={() => onSelectAgent(row.sessionId)}
      className={cn(
        "flex min-h-11 min-w-11 w-full flex-col gap-1 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        touchOptimized && "min-h-12",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs font-medium">{row.harnessLabel}</span>
        <span className="min-w-0 truncate font-mono" title={row.terminalTitle}>
          {row.terminalTitle}
        </span>
      </span>
      <span className="w-full min-w-0 truncate text-xs" title={`Project: ${row.projectLabel}; Server profile: ${row.profileLabel}`}>
        {row.projectLabel} · {row.profileLabel}
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-1 text-xs">
        <span className={cn("inline-flex items-center gap-1 rounded-sm border border-[var(--color-border)] px-1 py-0.5 font-medium", statusClassName)}>
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {label}
        </span>
        {reasonLabel ? <span>{reasonLabel}</span> : null}
      </span>
      {outcomeHint ? (
        <span className="text-[11px] text-[var(--color-text-muted)]" title={outcomeExplanation}>
          {outcomeHint}
        </span>
      ) : null}
      <span className="w-full truncate text-[11px] text-[var(--color-text-muted)]" title={sourceExplanation}>
        {sourceLabel}
      </span>
      <span id={descriptionId} className="sr-only">
        {sourceLabel}. {coverageHint ? `${coverageHint}. ` : ""}
        {outcomeHint ? `${outcomeHint}. ${outcomeExplanation}` : ""}
      </span>
    </button>
  );
}
