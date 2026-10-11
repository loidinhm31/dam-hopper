import type {
  TraditionalAgentStatusLabel,
  TraditionalTerminalAgentPresentation,
  TraditionalTerminalAgentRow,
} from "@/lib/traditional-terminal-agents.js";

/**
 * One sidebar item: every observed agent of one project that currently shows
 * the same primary status (label + reason). `rows` keeps the exact per-terminal
 * models so activation still resolves a concrete, fenced session.
 */
export interface TraditionalTerminalAgentStatusGroup {
  readonly key: string;
  readonly groupId: string;
  readonly profileId?: string;
  readonly projectLabel: string;
  readonly profileLabel: string;
  readonly label: TraditionalAgentStatusLabel;
  readonly reasonLabel: TraditionalTerminalAgentPresentation["reasonLabel"];
  /** Shown only when every member carries the hint; never implied for a mixed set. */
  readonly outcomeHint: TraditionalTerminalAgentPresentation["outcomeHint"];
  readonly harnessLabels: readonly TraditionalTerminalAgentRow["harnessLabel"][];
  readonly sourceLabels: readonly TraditionalTerminalAgentPresentation["sourceLabel"][];
  readonly coverageHints: readonly string[];
  /** Non-empty, in terminal tab order. */
  readonly rows: readonly TraditionalTerminalAgentRow[];
}

/** Most actionable first; fixed so item order does not depend on tab order. */
const STATUS_ORDER: readonly TraditionalAgentStatusLabel[] = [
  "Needs attention",
  "Working",
  "Idle",
  "Unknown",
  "Unavailable",
  "Platform unqualified",
  "Unsupported",
];
const HARNESS_ORDER = ["OMP", "Codex", "Claude"] as const;

/**
 * Collapse per-terminal rows into one item per (project, status). Pure and
 * order-stable: projects keep the builder's order, statuses use STATUS_ORDER.
 */
export function groupTraditionalTerminalAgentRows(
  rows: readonly TraditionalTerminalAgentRow[],
): readonly TraditionalTerminalAgentStatusGroup[] {
  const byKey = new Map<string, TraditionalTerminalAgentRow[]>();
  const projectOrder = new Map<string, number>();
  for (const row of rows) {
    const { label, reasonLabel } = row.presentation;
    const key = JSON.stringify([row.groupId, label, reasonLabel]);
    const members = byKey.get(key);
    if (members) members.push(row);
    else byKey.set(key, [row]);
    if (!projectOrder.has(row.groupId)) projectOrder.set(row.groupId, projectOrder.size);
  }
  const groups: TraditionalTerminalAgentStatusGroup[] = [];
  for (const [key, members] of byKey) {
    const first = members[0]!;
    const { label, reasonLabel, outcomeHint } = first.presentation;
    groups.push({
      key,
      groupId: first.groupId,
      profileId: first.terminalRef.profileId,
      projectLabel: first.projectLabel,
      profileLabel: first.profileLabel,
      label,
      reasonLabel,
      outcomeHint: members.every((row) => row.presentation.outcomeHint === outcomeHint)
        ? outcomeHint
        : null,
      harnessLabels: HARNESS_ORDER.filter((harness) =>
        members.some((row) => row.harnessLabel === harness),
      ),
      sourceLabels: [...new Set(members.map((row) => row.presentation.sourceLabel))],
      coverageHints: [
        ...new Set(
          members.flatMap((row) =>
            row.presentation.coverageHint ? [row.presentation.coverageHint] : [],
          ),
        ),
      ],
      rows: members,
    });
  }
  return groups.sort(
    (a, b) =>
      projectOrder.get(a.groupId)! - projectOrder.get(b.groupId)! ||
      STATUS_ORDER.indexOf(a.label) - STATUS_ORDER.indexOf(b.label) ||
      (a.reasonLabel ?? "").localeCompare(b.reasonLabel ?? ""),
  );
}

/**
 * Activation target for a multi-agent item: the member after the active one,
 * wrapping; the first member when the active terminal is outside the item.
 */
export function nextAgentSessionId(
  group: Pick<TraditionalTerminalAgentStatusGroup, "rows">,
  activeSessionId: string | null | undefined,
): string {
  const index = group.rows.findIndex((row) => row.sessionId === activeSessionId);
  return group.rows[(index + 1) % group.rows.length]!.sessionId;
}
