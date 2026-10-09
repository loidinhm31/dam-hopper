import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import {
  parseTerminalKey,
  terminalInstanceKey,
  terminalKey,
  type ConnectionRef,
  type TerminalRef,
} from "@/api/ownership.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type {
  AgentStatusPresentationAvailability,
  useAgentStatusStore,
} from "@/stores/agent-status.js";

export type AgentStatusProfilesView =
  ReturnType<typeof useAgentStatusStore.getState>["profiles"];
export type TraditionalAgentStatusLabel =
  | "Working" | "Idle" | "Needs attention" | "Unknown"
  | "Unavailable" | "Platform unqualified" | "Unsupported";
export interface TraditionalTerminalAgentPresentation {
  readonly label: TraditionalAgentStatusLabel;
  readonly reasonLabel: "Approval" | "Question" | "Error" | null;
  readonly outcomeHint: "Done (turn ended)" | null;
  readonly sourceLabel: "Lifecycle observation" | "Hook observation";
  readonly coverageHint: string | null;
}
export interface TraditionalTerminalAgentRow {
  readonly key: string;
  readonly sessionId: string;
  readonly terminalRef: TerminalRef;
  readonly incarnation: number;
  readonly groupId: string;
  readonly projectLabel: string;
  readonly profileLabel: string;
  readonly terminalTitle: string;
  readonly harnessLabel: "OMP" | "Codex" | "Claude";
  readonly statusOwner: ConnectionRef;
  readonly availability: AgentStatusPresentationAvailability | null;
  readonly status: TerminalAgentStatusRow;
  readonly presentation: TraditionalTerminalAgentPresentation;
}
export interface BuildTraditionalTerminalAgentsInput {
  readonly groups: readonly TraditionalTerminalProjectGroup<DisplayTabEntry>[];
  readonly profiles: AgentStatusProfilesView;
  readonly connections: ReadonlyMap<string, ConnectionSnapshot>;
  readonly profileLabels: ReadonlyMap<string, string>;
  readonly nowMs: number;
}

const HARNESS_LABELS = { omp: "OMP", codex: "Codex", claude: "Claude" } as const;
const REASON_LABELS = { approval: "Approval", question: "Question", error: "Error" } as const;

/** Only canonical qualified keys can corroborate optional ownership metadata. */
function qualifiedRef(
  entry: Pick<DisplayTabEntry, "sessionId" | "terminalRef" | "profileId">,
): TerminalRef | null {
  const parsed = parseTerminalKey(entry.sessionId);
  const ref = entry.terminalRef ?? parsed;
  if (
    !parsed || !ref || entry.sessionId !== terminalKey(ref) ||
    parsed.profileId !== ref.profileId || parsed.id !== ref.id ||
    (entry.profileId !== undefined && entry.profileId !== ref.profileId)
  ) return null;
  return ref;
}

function present(
  status: TerminalAgentStatusRow,
  availability: AgentStatusPresentationAvailability | null,
  nowMs: number,
): TraditionalTerminalAgentPresentation {
  let label: TraditionalAgentStatusLabel = "Unavailable";
  let reasonLabel: TraditionalTerminalAgentPresentation["reasonLabel"] = null;
  let outcomeHint: TraditionalTerminalAgentPresentation["outcomeHint"] = null;
  if (availability === "platform-unqualified") label = "Platform unqualified";
  else if (availability === "unsupported") label = "Unsupported";
  else if (availability === "ready") {
    if (status.expiresAtMs !== undefined && status.expiresAtMs <= nowMs) {
      label = "Unknown";
    } else {
      switch (status.state) {
        case "unknown": label = "Unknown"; break;
        case "working": label = "Working"; break;
        case "blocked":
          label = "Needs attention";
          reasonLabel = status.reason === undefined ? null : REASON_LABELS[status.reason];
          break;
        case "idle":
          label = "Idle";
          if (status.lastOutcome === "ended" && status.turnId === undefined) {
            outcomeHint = "Done (turn ended)";
          }
          break;
      }
    }
  }
  return {
    label,
    reasonLabel,
    outcomeHint,
    sourceLabel: status.source === "hook" ? "Hook observation" : "Lifecycle observation",
    coverageHint: status.source === "hook"
      ? "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)"
      : null,
  };
}

/** Readonly alternate index of observations, never a status or notification authority. */
export function buildTraditionalTerminalAgentRows(
  input: BuildTraditionalTerminalAgentsInput,
): readonly TraditionalTerminalAgentRow[] {
  const rows: TraditionalTerminalAgentRow[] = [];
  const emitted = new Set<string>();
  for (const group of input.groups) {
    // Index exact qualified membership once; never borrow the project's bare-ID fallback.
    const mountedBySessionId = new Map<string, TerminalRef>();
    for (const mounted of group.mountedSessions) {
      const ref = qualifiedRef(mounted);
      if (ref) mountedBySessionId.set(mounted.sessionId, ref);
    }
    for (const tab of group.terminalTabs) {
      const ref = qualifiedRef(tab);
      if (!ref || !input.profileLabels.has(ref.profileId)) continue;
      const mountedRef = mountedBySessionId.get(tab.sessionId);
      if (
        !mountedRef || mountedRef.profileId !== ref.profileId || mountedRef.id !== ref.id ||
        (group.profileId !== undefined && group.profileId !== ref.profileId) ||
        (group.projectRef?.profileId !== undefined && group.projectRef.profileId !== ref.profileId)
      ) continue;
      const session = tab.session;
      if (
        !session || session.id !== ref.id || !session.alive ||
        session.incarnation === undefined || !Number.isSafeInteger(session.incarnation) ||
        session.incarnation < 0
      ) continue;
      const profile = input.profiles.get(ref.profileId);
      if (!profile || profile.owner.profileId !== ref.profileId) continue;
      const status = profile.rows.get(ref.id);
      if (!status || status.id !== ref.id || status.incarnation !== session.incarnation) continue;
      const key = terminalInstanceKey({ ...ref, incarnation: session.incarnation });
      if (emitted.has(key)) continue;
      emitted.add(key);

      const connection = input.connections.get(ref.profileId);
      const current = connection?.status === "connected" &&
        connection.owner.profileId === ref.profileId &&
        connection.owner.generation === profile.owner.generation;
      // Rebinding an owner retains rows, but does not establish a ready baseline.
      const availability = !current || (profile.availability === "ready" && profile.epoch === null)
        ? "unavailable"
        : profile.availability;
      rows.push({
        key,
        sessionId: tab.sessionId,
        terminalRef: ref,
        incarnation: session.incarnation,
        groupId: group.id,
        projectLabel: group.label,
        profileLabel: input.profileLabels.get(ref.profileId) || ref.profileId,
        terminalTitle: tab.title.fullText,
        harnessLabel: HARNESS_LABELS[status.agentKind],
        statusOwner: profile.owner,
        availability,
        status,
        presentation: present(status, availability, input.nowMs),
      });
    }
  }
  return rows;
}
