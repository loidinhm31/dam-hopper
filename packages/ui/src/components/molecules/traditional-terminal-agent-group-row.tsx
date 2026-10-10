import { useId, type JSX } from "react";
import { Activity, Ban, Circle, CircleAlert, CircleHelp, TriangleAlert, Unplug } from "lucide-react";
import {
  nextAgentSessionId,
  type TraditionalTerminalAgentStatusGroup,
} from "@/lib/traditional-terminal-agent-groups.js";
import { AgentHarnessBadge } from "@/components/atoms/AgentHarnessBadge.js";
import { ProfileBadge } from "@/components/atoms/ProfileBadge.js";
import { ProjectBadge } from "@/components/atoms/ProjectBadge.js";
import { cn } from "@/lib/utils.js";

export interface TraditionalTerminalAgentGroupRowProps {
  readonly group: TraditionalTerminalAgentStatusGroup;
  readonly activeSessionId?: string | null;
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

/**
 * One project + status item with an agent-count badge. Renders only the
 * caller's fenced presentation; activating it selects one exact member terminal
 * (cycling through members), never a project-level or remembered sibling.
 */
export function TraditionalTerminalAgentGroupRow({
  group,
  activeSessionId,
  onSelectAgent,
  touchOptimized = false,
}: TraditionalTerminalAgentGroupRowProps): JSX.Element {
  const descriptionId = useId();
  const { label, reasonLabel, outcomeHint, harnessLabels, rows } = group;
  const count = rows.length;
  const active = rows.some((row) => row.sessionId === activeSessionId);
  const { Icon, className: statusClassName } = STATUS_STYLES[label];
  const harnesses = harnessLabels.join(", ");
  const subject = count === 1 ? `${harnesses}: ${rows[0]!.terminalTitle}` : `${harnesses}: ${count} agents`;
  const where = `Project: ${group.projectLabel}; Server profile: ${group.profileLabel}`;
  const sourceLabel = group.sourceLabels.join(" · ");
  const sourceExplanation = group.coverageHints.join(" ") || sourceLabel;
  const outcomeExplanation = "Last turn ended; task success has not been verified.";

  return (
    <button
      type="button"
      aria-label={`${subject}; ${where}; ${label}${reasonLabel ? `: ${reasonLabel}` : ""}`}
      aria-describedby={descriptionId}
      aria-current={active ? "true" : undefined}
      title={`${subject}; ${where}`}
      onClick={() => onSelectAgent(nextAgentSessionId(group, activeSessionId))}
      className={cn(
        "flex min-h-11 min-w-11 w-full flex-col gap-1 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "bg-[var(--color-primary)]/12 text-[var(--color-text)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        touchOptimized && "min-h-12",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 items-center gap-1">
          {harnessLabels.map((harness) => (
            <AgentHarnessBadge key={harness} harness={harness} />
          ))}
        </span>
        {count === 1 ? (
          <span className="min-w-0 truncate font-mono text-xs text-[var(--color-text)]" title={rows[0]!.terminalTitle}>
            {rows[0]!.terminalTitle}
          </span>
        ) : null}
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5 text-xs" title={where}>
        <ProjectBadge name={group.projectLabel} />
        <ProfileBadge
          profileId={group.profileId}
          name={group.profileLabel}
          className="truncate max-w-[100px]"
        />
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-1 text-xs">
        <span className={cn("inline-flex items-center gap-1 rounded-sm border border-[var(--color-border)] px-1 py-0.5 font-medium", statusClassName)}>
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {label}
        </span>
        <span
          data-testid="agent-count-badge"
          title={`${count} ${count === 1 ? "agent" : "agents"}`}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-text)]"
        >
          {count}
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
        {sourceLabel}. {group.coverageHints.length ? `${group.coverageHints.join(". ")}. ` : ""}
        {outcomeHint ? `${outcomeHint}. ${outcomeExplanation}` : ""}
      </span>
    </button>
  );
}
