import type { ConnectionSnapshot, ConnectionStatus } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import {
  terminalKey,
  type ConnectionRef,
  type TerminalRef,
} from "@/api/ownership.js";
import type {
  TraditionalTerminalAgentPresentation,
  TraditionalTerminalAgentRow,
} from "@/lib/traditional-terminal-agents.js";
import {
  buildTraditionalTerminalAgentRows,
  type BuildTraditionalTerminalAgentsInput,
} from "@/lib/traditional-terminal-agents.js";
import type { OsWindow } from "./types.js";
import type { AggregatedSessionInfo } from "@/hooks/use-aggregated-terminal-sessions.js";
import {
  proveNumericEvidenceJoin,
  type TerminalInventoryTerminationState,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";

export type AgentHubUrgency =
  | "needs-attention"
  | "working"
  | "idle"
  | "unavailable"
  | "unobserved";

export const AGENT_HUB_URGENCY_ORDER: readonly AgentHubUrgency[] = [
  "needs-attention",
  "working",
  "idle",
  "unavailable",
  "unobserved",
] as const;

export const AGENT_HUB_URGENCY_LABELS: Record<AgentHubUrgency, string> = {
  "needs-attention": "Needs Attention",
  working: "Working",
  idle: "Idle",
  unavailable: "Unavailable / Offline",
  unobserved: "Unobserved Sessions",
};

export type AgentHubPresentation = Omit<TraditionalTerminalAgentPresentation, "label"> & {
  readonly label: TraditionalTerminalAgentPresentation["label"] | "Unobserved";
};

export interface AgentHubItem {
  readonly key: string;
  readonly sessionId: string;
  readonly terminalRef: TerminalRef;
  readonly incarnation: number;
  readonly incarnationExact?: string;
  readonly terminationState?: TerminalInventoryTerminationState;
  readonly terminationTarget: TerminalTarget | null;
  readonly groupId: string;
  readonly projectLabel: string;
  readonly profileId: string;
  readonly profileLabel: string;
  readonly terminalTitle: string;
  readonly harnessLabel: "OMP" | "Codex" | "Claude" | "Terminal";
  readonly statusOwner: ConnectionRef;
  readonly availability: TraditionalTerminalAgentRow["availability"] | "unobserved";
  readonly status: TerminalAgentStatusRow | null;
  readonly presentation: AgentHubPresentation;
  readonly urgency: AgentHubUrgency;
  readonly connectionStatus: ConnectionStatus;
  readonly isConnected: boolean;
  readonly isAgent: boolean;
  readonly isBackground: boolean;
  readonly matchingWindow: {
    window: OsWindow;
    windowId: string;
    desktopId: string;
    minimized: boolean;
  } | null;
}

export interface AgentHubSummary {
  readonly total: number;
  readonly agentsCount: number;
  readonly backgroundCount: number;
  readonly needsAttention: number;
  readonly working: number;
  readonly idle: number;
  readonly unavailable: number;
  readonly unobserved: number;
  readonly connectedProfiles: number;
  readonly totalProfiles: number;
}

/**
 * Classify a presentation label into standard Agent Hub urgency.
 * Urgency order: Needs attention -> Working -> Idle -> Unavailable/Unknown -> Unobserved.
 * Note: Idle is explicitly NOT treated as success.
 * Unobserved != idle/safe to kill.
 */
export function classifyAgentUrgency(
  presentation: AgentHubPresentation,
  connectionStatus: ConnectionStatus,
): AgentHubUrgency {
  if (connectionStatus !== "connected") {
    return "unavailable";
  }

  switch (presentation.label) {
    case "Needs attention":
      return "needs-attention";
    case "Working":
      return "working";
    case "Idle":
      return "idle";
    case "Unknown":
    case "Unavailable":
    case "Platform unqualified":
    case "Unsupported":
    default:
      return "unavailable";
  }
}

/**
 * Pure urgency rank for stable ordering.
 */
export function getUrgencyRank(urgency: AgentHubUrgency): number {
  switch (urgency) {
    case "needs-attention":
      return 0;
    case "working":
      return 1;
    case "idle":
      return 2;
    case "unavailable":
      return 3;
    case "unobserved":
      return 4;
  }
}

/**
 * Matches terminal window membership across every session.windows entry by exact runtime target
 * (including generation, serverEpoch, terminalId, incarnation), not raw ID or active desktop only.
 * Windows without verified runtime target remain unverified, NEVER guessed as same PTY.
 */
export function findMatchingTerminalWindow(
  target: TerminalTarget | null,
  windows: Record<string, OsWindow>,
): {
  window: OsWindow;
  windowId: string;
  desktopId: string;
  minimized: boolean;
} | null {
  if (!target) return null;

  for (const win of Object.values(windows)) {
    if (win.appId !== "terminals") continue;

    // Direct in-memory verified runtime identity
    const runtimeTarget =
      win.runtimeIdentity?.kind === "terminal" ? win.runtimeIdentity.target : null;
    if (runtimeTarget) {
      if (
        runtimeTarget.profileId === target.profileId &&
        runtimeTarget.generation === target.generation &&
        runtimeTarget.serverEpoch === target.serverEpoch &&
        runtimeTarget.terminalId === target.terminalId &&
        runtimeTarget.incarnation === target.incarnation
      ) {
        return {
          window: win,
          windowId: win.id,
          desktopId: win.desktopId,
          minimized: win.minimized ?? false,
        };
      }
      continue;
    }

    // AppState captured terminal target
    const stateTarget = (win.appState?.target ?? win.appState?.terminalTarget) as
      | TerminalTarget
      | undefined;
    if (stateTarget) {
      if (
        stateTarget.profileId === target.profileId &&
        stateTarget.generation === target.generation &&
        stateTarget.serverEpoch === target.serverEpoch &&
        stateTarget.terminalId === target.terminalId &&
        stateTarget.incarnation === target.incarnation
      ) {
        return {
          window: win,
          windowId: win.id,
          desktopId: win.desktopId,
          minimized: win.minimized ?? false,
        };
      }
      continue;
    }

    // Windows without verified runtime target remain unverified
  }

  return null;
}


export interface BuildAgentHubItemsInput
  extends Partial<BuildTraditionalTerminalAgentsInput> {
  readonly connectedProfiles?: ReadonlySet<string>;
  readonly sessions?: readonly AggregatedSessionInfo[];
  readonly windows?: Record<string, OsWindow>;
}

/**
 * Builds inventory-first Agent Hub items from aggregate inventory and losslessly joined agent observations.
 *
 * Rules (Architecture Contracts C2 & C3):
 * 1. Inventory-first: Every inventory session produces a row.
 * 2. Join agent evidence by owner profileId, terminalId, and losslessly proven positive-safe incarnation:
 *    proveNumericEvidenceJoin(agentStatus.incarnation, exactIncarnationString).
 *    Unsafe numeric agent proof cannot be rounded or stringified.
 * 3. Unmatched inventory remains visible as unobserved sessions with valid exact End;
 *    agent-derived Review/urgency unavailable where proof is missing.
 *    Unobserved != idle/safe to kill.
 * 4. Background = no open qualified window anywhere in session.windows on ANY desktop.
 *    Minimized and other-desktop windows are open, not Background.
 */
export function buildAgentHubItems(
  input: BuildAgentHubItemsInput,
): readonly AgentHubItem[] {
  const windows = input.windows ?? {};
  const connections = input.connections ?? new Map<string, ConnectionSnapshot>();
  const profileLabels = input.profileLabels ?? new Map<string, string>();
  const statusProfiles = input.profiles ?? new Map();

  // Build a lookup map of agent status rows by `${profileId}:${terminalId}`
  // and traditional presentation if available
  const traditionalRows = input.groups
    ? buildTraditionalTerminalAgentRows({
        groups: input.groups,
        profiles: statusProfiles,
        connections,
        profileLabels,
      })
    : [];

  const traditionalRowMap = new Map<string, TraditionalTerminalAgentRow>();
  for (const row of traditionalRows) {
    traditionalRowMap.set(`${row.terminalRef.profileId}:${row.terminalRef.id}`, row);
  }

  const items: AgentHubItem[] = [];

  // If explicit aggregated sessions inventory is provided, use it directly (inventory-first)
  if (input.sessions && input.sessions.length > 0) {
    for (const s of input.sessions) {
      if (
        s.alive === false ||
        s.terminationState === "exited" ||
        s.terminationState === "restartCancelled" ||
        s.terminationState === "terminationRequested"
      ) {
        continue;
      }
      const profileId = s.profileId;
      const conn = connections.get(profileId);
      const connStatus: ConnectionStatus = conn?.status ?? "disconnected";
      const isConnected =
        connStatus === "connected" &&
        (s.generation === undefined || conn?.owner.generation === s.generation);

      const target = s.terminationTarget;
      const exactIncarnation = s.incarnationExact ?? (s.incarnation !== undefined ? String(s.incarnation) : "");

      // Check agent evidence join with lossless proof
      const profileStatusView = statusProfiles?.get(profileId);
      const agentStatusRow = profileStatusView?.rows.get(s.id) ?? null;

      let isAgent = false;
      let provenAgentStatus: TerminalAgentStatusRow | null = null;

      if (agentStatusRow && exactIncarnation) {
        if (proveNumericEvidenceJoin(agentStatusRow.incarnation, exactIncarnation)) {
          isAgent = true;
          provenAgentStatus = agentStatusRow;
        }
      }

      // Traditional row presentation lookup
      const tradRow = traditionalRowMap.get(`${profileId}:${s.id}`);

      let urgency: AgentHubUrgency;
      let presentation: AgentHubPresentation;
      let harnessLabel: "OMP" | "Codex" | "Claude" | "Terminal" = "Terminal";

      if (isAgent && provenAgentStatus) {
        harnessLabel =
          provenAgentStatus.agentKind === "codex"
            ? "Codex"
            : provenAgentStatus.agentKind === "claude"
              ? "Claude"
              : "OMP";

        if (tradRow) {
          presentation = isConnected
            ? tradRow.presentation
            : {
                ...tradRow.presentation,
                label: "Unavailable",
                reasonLabel: null,
                outcomeHint: null,
              };
          urgency = classifyAgentUrgency(
            tradRow.presentation,
            isConnected ? "connected" : "disconnected",
          );
        } else if (!isConnected || profileStatusView?.availability !== "ready") {
          isAgent = false;
          urgency = "unavailable";
          presentation = {
            label: "Unavailable",
            reasonLabel: null,
            outcomeHint: null,
            sourceLabel: "Lifecycle observation",
            coverageHint: null,
          };
        } else {
          // Synthesize presentation from status
          presentation = {
            label:
              provenAgentStatus.state === "working"
                ? "Working"
                : provenAgentStatus.state === "blocked"
                  ? "Needs attention"
                  : provenAgentStatus.state === "idle"
                    ? "Idle"
                    : "Unknown",
            reasonLabel: provenAgentStatus.reason
              ? ({ approval: "Approval", question: "Question", error: "Error" } as const)[provenAgentStatus.reason]
              : null,
            outcomeHint: null,
            sourceLabel: "Hook observation",
            coverageHint: null,
          };
          urgency = classifyAgentUrgency(
            presentation,
            isConnected ? "connected" : "disconnected",
          );
        }
      } else {
        // Unobserved session: not an agent or unproven incarnation
        isAgent = false;
        urgency = isConnected ? "unobserved" : "unavailable";
        presentation = {
          label: isConnected ? "Unobserved" : "Unavailable",
          reasonLabel: null,
          outcomeHint: null,
          sourceLabel: "Lifecycle observation",
          coverageHint: null,
        };
      }

      const matchingWin = findMatchingTerminalWindow(target, windows);
      const isBackground = matchingWin === null;

      const profileLabel = profileLabels.get(profileId) ?? profileId;
      const projectLabel = s.project || "default";
      const terminalTitle = s.name || s.id;
      const termRef: TerminalRef = { profileId, id: s.id };
      const itemKey = `${profileId}::${s.id}::${exactIncarnation || s.incarnation || 0}`;

      items.push({
        key: itemKey,
        sessionId: s.id,
        terminalRef: termRef,
        incarnation: typeof s.incarnation === "number" ? s.incarnation : 0,
        incarnationExact: s.incarnationExact,
        terminationState: s.terminationState,
        terminationTarget: target,
        groupId: `group-${profileId}-${projectLabel}`,
        projectLabel,
        profileId,
        profileLabel,
        terminalTitle,
        harnessLabel,
        statusOwner: {
          profileId,
          generation: s.generation ?? conn?.owner.generation ?? 0,
        },
        availability: isAgent ? (isConnected ? "ready" : "unavailable") : "unobserved",
        status: provenAgentStatus,
        presentation,
        urgency,
        connectionStatus: connStatus,
        isConnected,
        isAgent,
        isBackground,
        matchingWindow: matchingWin,
      });
    }
  } else {
    // Fallback when sessions not provided directly (e.g. from groups in unit tests)
    for (const row of traditionalRows) {
      const conn = connections.get(row.terminalRef.profileId);
      const connStatus: ConnectionStatus = conn?.status ?? "disconnected";
      const isConnected =
        connStatus === "connected" &&
        conn?.owner.generation === row.statusOwner.generation;

      const urgency = classifyAgentUrgency(
        row.presentation,
        isConnected ? "connected" : "disconnected",
      );

      const exactIncarnation = String(row.incarnation);
      const target: TerminalTarget | null = isConnected
        ? {
            profileId: row.terminalRef.profileId,
            generation: row.statusOwner.generation,
            serverEpoch: "00000000-0000-0000-0000-000000000000",
            terminalId: row.terminalRef.id,
            incarnation: exactIncarnation,
          }
        : null;

      const matchingWin = findMatchingTerminalWindow(target, windows);
      const isBackground = matchingWin === null;

      items.push({
        key: row.key,
        sessionId: row.sessionId,
        terminalRef: row.terminalRef,
        incarnation: row.incarnation,
        incarnationExact: exactIncarnation,
        terminationState: "live",
        terminationTarget: target,
        groupId: row.groupId,
        projectLabel: row.projectLabel,
        profileId: row.terminalRef.profileId,
        profileLabel: row.profileLabel,
        terminalTitle: row.terminalTitle,
        harnessLabel: row.harnessLabel,
        statusOwner: row.statusOwner,
        availability: isConnected ? row.availability : "unavailable",
        status: row.status,
        presentation: isConnected
          ? row.presentation
          : {
              ...row.presentation,
              label: "Unavailable",
              reasonLabel: null,
              outcomeHint: null,
            },
        urgency,
        connectionStatus: connStatus,
        isConnected,
        isAgent: true,
        isBackground,
        matchingWindow: matchingWin,
      });
    }
  }

  // Deterministic sorting: Urgency Rank -> Profile -> Project -> Title -> Key
  items.sort((a, b) => {
    const rankDiff = getUrgencyRank(a.urgency) - getUrgencyRank(b.urgency);
    if (rankDiff !== 0) return rankDiff;

    const profileComp = a.profileLabel.localeCompare(b.profileLabel);
    if (profileComp !== 0) return profileComp;

    const projectComp = a.projectLabel.localeCompare(b.projectLabel);
    if (projectComp !== 0) return projectComp;

    const titleComp = a.terminalTitle.localeCompare(b.terminalTitle);
    if (titleComp !== 0) return titleComp;

    return a.key.localeCompare(b.key);
  });

  return items;
}

/**
 * Computes top-level counts for filter pills (All, Agents, Background, and Urgency counts).
 */
export function computeAgentHubSummary(
  items: readonly AgentHubItem[],
  connections: ReadonlyMap<string, ConnectionSnapshot>,
): AgentHubSummary {
  let needsAttention = 0;
  let working = 0;
  let idle = 0;
  let unavailable = 0;
  let unobserved = 0;
  let agentsCount = 0;
  let backgroundCount = 0;

  for (const item of items) {
    if (item.isAgent) {
      agentsCount++;
    }
    if (item.isBackground) {
      backgroundCount++;
    }

    switch (item.urgency) {
      case "needs-attention":
        needsAttention++;
        break;
      case "working":
        working++;
        break;
      case "idle":
        idle++;
        break;
      case "unavailable":
        unavailable++;
        break;
      case "unobserved":
        unobserved++;
        break;
    }
  }

  let connectedProfiles = 0;
  for (const conn of connections.values()) {
    if (conn.status === "connected") {
      connectedProfiles++;
    }
  }

  return {
    total: items.length,
    agentsCount,
    backgroundCount,
    needsAttention,
    working,
    idle,
    unavailable,
    unobserved,
    connectedProfiles,
    totalProfiles: connections.size,
  };
}

