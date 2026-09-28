import type { TerminalRef } from "@/api/ownership.js";
import type { AgentState } from "@/api/agent-status-types.js";
import {
  useAgentStatusAvailability,
  useTerminalAgentStatus,
} from "@/stores/agent-status.js";

const STATE_PRESENTATION: Record<
  AgentState,
  { label: string; shortLabel: string; className: string }
> = {
  unknown: {
    label: "Unknown",
    shortLabel: "?",
    className: "text-[var(--color-text-muted)]",
  },
  idle: {
    label: "Idle",
    shortLabel: "Idle",
    className: "text-[var(--color-text-muted)]",
  },
  working: {
    label: "Running",
    shortLabel: "Run",
    className: "text-[var(--color-success)]",
  },
  blocked: {
    label: "Needs attention",
    shortLabel: "!",
    className: "text-[var(--color-warning)]",
  },
};

interface Props {
  terminalRef?: TerminalRef;
  incarnation?: number;
}

/** Semantic agent state is deliberately separate from output and process activity. */
export function AgentStatusBadge({ terminalRef, incarnation }: Props) {
  const row = useTerminalAgentStatus(terminalRef, incarnation);
  const availability = useAgentStatusAvailability(terminalRef?.profileId);

  // Without an owner and a concrete PTY incarnation, never show another
  // terminal's status after a restart or a profile switch. Plain shells have no row.
  if (!terminalRef || incarnation === undefined || !row) return null;

  const presentation =
    availability === "unavailable" || availability === null
      ? {
          label: "Unavailable",
          shortLabel: "Off",
          className: "text-[var(--color-text-muted)]",
        }
      : availability === "platform-unqualified"
        ? {
            label: "Platform unqualified",
            shortLabel: "Unqual",
            className: "text-[var(--color-text-muted)]",
          }
        : availability === "unsupported"
          ? {
              label: "Unsupported",
              shortLabel: "Unsup",
              className: "text-[var(--color-text-muted)]",
            }
          : STATE_PRESENTATION[row.state];
  const agent = row.agentKind.toUpperCase();
  const description = `${agent} agent: ${presentation.label}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm border border-[var(--color-border)] px-1 py-0.5 font-mono text-[10px] leading-none ${presentation.className}`}
      role="img"
      title={description}
      aria-label={description}
    >
      <span aria-hidden="true">{agent}</span>
      <span aria-hidden="true">· {presentation.shortLabel}</span>
    </span>
  );
}
