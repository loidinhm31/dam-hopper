import type { ConnectionSnapshot, ConnectionStatus } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import type { ConnectionRef, TerminalRef } from "@/api/ownership.js";
import type {
  TraditionalTerminalAgentPresentation,
  TraditionalTerminalAgentRow,
} from "@/lib/traditional-terminal-agents.js";
import { buildTraditionalTerminalAgentRows, type BuildTraditionalTerminalAgentsInput } from "@/lib/traditional-terminal-agents.js";
import type { OsWindow, WindowContext } from "./types.js";

export type AgentHubUrgency =
  | "needs-attention"
  | "working"
  | "idle"
  | "unavailable";

export const AGENT_HUB_URGENCY_ORDER: readonly AgentHubUrgency[] = [
  "needs-attention",
  "working",
  "idle",
  "unavailable",
] as const;

export const AGENT_HUB_URGENCY_LABELS: Record<AgentHubUrgency, string> = {
  "needs-attention": "Needs Attention",
  working: "Working",
  idle: "Idle",
  unavailable: "Unavailable / Offline",
};

export interface AgentHubItem {
  readonly key: string;
  readonly sessionId: string;
  readonly terminalRef: TerminalRef;
  readonly incarnation: number;
  readonly groupId: string;
  readonly projectLabel: string;
  readonly profileId: string;
  readonly profileLabel: string;
  readonly terminalTitle: string;
  readonly harnessLabel: "OMP" | "Codex" | "Claude";
  readonly statusOwner: ConnectionRef;
  readonly availability: TraditionalTerminalAgentRow["availability"];
  readonly status: TerminalAgentStatusRow;
  readonly presentation: TraditionalTerminalAgentPresentation;
  readonly urgency: AgentHubUrgency;
  readonly connectionStatus: ConnectionStatus;
  readonly isConnected: boolean;
}

export interface AgentHubSummary {
  readonly total: number;
  readonly needsAttention: number;
  readonly working: number;
  readonly idle: number;
  readonly unavailable: number;
  readonly connectedProfiles: number;
  readonly totalProfiles: number;
}

/**
 * Classify a presentation label into standard Agent Hub urgency.
 * Urgency order: Needs attention -> Working -> Idle -> Unavailable/Unknown.
 * Note: Idle is explicitly NOT treated as success.
 */
export function classifyAgentUrgency(
  presentation: TraditionalTerminalAgentPresentation,
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
  }
}

export interface BuildAgentHubItemsInput extends BuildTraditionalTerminalAgentsInput {
  readonly connectedProfiles?: ReadonlySet<string>;
}

/**
 * Build aggregated agent hub items from qualified terminal agent rows.
 * Disconnected or retired profiles are honestly preserved as unavailable rows.
 */
export function buildAgentHubItems(
  input: BuildAgentHubItemsInput,
): readonly AgentHubItem[] {
  const traditionalRows = buildTraditionalTerminalAgentRows(input);
  const items: AgentHubItem[] = [];

  for (const row of traditionalRows) {
    const conn = input.connections.get(row.terminalRef.profileId);
    const connStatus: ConnectionStatus = conn?.status ?? "disconnected";
    const isConnected =
      connStatus === "connected" &&
      conn?.owner.generation === row.statusOwner.generation;

    const urgency = classifyAgentUrgency(row.presentation, isConnected ? "connected" : "disconnected");

    items.push({
      key: row.key,
      sessionId: row.sessionId,
      terminalRef: row.terminalRef,
      incarnation: row.incarnation,
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
    });
  }

  // Sort items deterministically: Urgency Rank -> Profile -> Project -> Title -> Key
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
 * Computes top-level counts for urgency filter pills.
 */
export function computeAgentHubSummary(
  items: readonly AgentHubItem[],
  connections: ReadonlyMap<string, ConnectionSnapshot>,
): AgentHubSummary {
  let needsAttention = 0;
  let working = 0;
  let idle = 0;
  let unavailable = 0;

  for (const item of items) {
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
    needsAttention,
    working,
    idle,
    unavailable,
    connectedProfiles,
    totalProfiles: connections.size,
  };
}

export interface AgentHubFilterOptions {
  urgency?: AgentHubUrgency | "all";
  profileId?: string | "all";
  searchQuery?: string;
  harness?: "OMP" | "Codex" | "Claude" | "all";
}

/**
 * Filter items by user-selected urgency, profile, harness, or search terms.
 */
export function filterAgentHubItems(
  items: readonly AgentHubItem[],
  filters: AgentHubFilterOptions,
): readonly AgentHubItem[] {
  const query = filters.searchQuery?.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.urgency && filters.urgency !== "all" && item.urgency !== filters.urgency) {
      return false;
    }

    if (filters.profileId && filters.profileId !== "all" && item.profileId !== filters.profileId) {
      return false;
    }

    if (filters.harness && filters.harness !== "all" && item.harnessLabel !== filters.harness) {
      return false;
    }

    if (query) {
      const match =
        item.terminalTitle.toLowerCase().includes(query) ||
        item.projectLabel.toLowerCase().includes(query) ||
        item.profileLabel.toLowerCase().includes(query) ||
        item.sessionId.toLowerCase().includes(query) ||
        item.harnessLabel.toLowerCase().includes(query) ||
        (item.presentation.reasonLabel &&
          item.presentation.reasonLabel.toLowerCase().includes(query));
      if (!match) return false;
    }

    return true;
  });
}

export interface FencedJumpValidationResult {
  valid: boolean;
  reason?: string;
  existingWindowId?: string;
  targetDesktopId?: string;
  targetContext?: WindowContext;
}

/**
 * Validates a jump intent target with exact owner and generation fencing.
 * Rejects stale jumps and retired profile targets.
 * NEVER authorizes creating a fresh terminal or replacing an existing session.
 */
export type LiveTerminalSnapshotMap = ReadonlyMap<
  string,
  ReadonlyMap<string, { alive: boolean; incarnation?: number }>
>;

export function validateAgentHubJump(
  item: AgentHubItem,
  connections: ReadonlyMap<string, ConnectionSnapshot>,
  windows: Record<string, OsWindow>,
  aliveTerminalIdsByProfile?: LiveTerminalSnapshotMap | ReadonlyMap<string, ReadonlySet<string>>,
): FencedJumpValidationResult {
  const conn = connections.get(item.profileId);
  if (!conn || conn.status !== "connected") {
    return {
      valid: false,
      reason: `Target profile "${item.profileLabel}" is disconnected or unavailable`,
    };
  }

  if (conn.owner.generation !== item.statusOwner.generation) {
    return {
      valid: false,
      reason: `Target profile "${item.profileLabel}" generation changed (expected ${item.statusOwner.generation}, actual ${conn.owner.generation})`,
    };
  }

  // Check live session existence and incarnation match
  if (aliveTerminalIdsByProfile) {
    const profileAlive = aliveTerminalIdsByProfile.get(item.profileId);
    if (!profileAlive) {
      return {
        valid: false,
        reason: `Terminal session "${item.terminalRef.id}" is no longer alive on host`,
      };
    }

    if (profileAlive instanceof Set) {
      if (!profileAlive.has(item.terminalRef.id)) {
        return {
          valid: false,
          reason: `Terminal session "${item.terminalRef.id}" is no longer alive on host`,
        };
      }
    } else {
      const snap = (profileAlive as ReadonlyMap<string, { alive: boolean; incarnation?: number }>).get(
        item.terminalRef.id,
      );
      if (!snap || !snap.alive) {
        return {
          valid: false,
          reason: `Terminal session "${item.terminalRef.id}" is no longer alive on host`,
        };
      }
      if (
        snap.incarnation !== undefined &&
        item.incarnation !== undefined &&
        snap.incarnation !== item.incarnation
      ) {
        return {
          valid: false,
          reason: `Terminal session "${item.terminalRef.id}" incarnation changed (expected ${item.incarnation}, live ${snap.incarnation})`,
        };
      }
    }
  }
  // Look for existing window containing this terminal session
  const windowList = Object.values(windows);
  const existingWindow = windowList.find(
    (w) =>
      w.appId === "terminals" &&
      w.ctx.profileId === item.profileId &&
      ((w.appState?.sessionId as string | undefined) === item.sessionId ||
        (w.appState?.sessionId as string | undefined) === item.terminalRef.id ||
        (w.appState?.terminalId as string | undefined) === item.terminalRef.id),
  );

  if (existingWindow) {
    return {
      valid: true,
      existingWindowId: existingWindow.id,
      targetDesktopId: existingWindow.desktopId,
      targetContext: existingWindow.ctx,
    };
  }

  // No window currently displays it, but live session is verified. Target can be opened in terminals app.
  return {
    valid: true,
    targetContext: {
      profileId: item.profileId,
      generation: item.statusOwner.generation,
    },
  };
}
