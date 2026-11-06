import { describe, expect, it } from "vitest";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import { terminalKey, type ConnectionRef, type TerminalRef } from "@/api/ownership.js";
import type { DisplayTabEntry, MountedSession } from "@/components/organisms/TerminalTabBar.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { AgentStatusProfilesView } from "@/lib/traditional-terminal-agents.js";
import {
  buildAgentHubItems,
  classifyAgentUrgency,
  computeAgentHubSummary,
  getUrgencyRank,
  findMatchingTerminalWindow,
  type AgentHubItem,
} from "./agent-hub.js";
import { MAX_U64_STRING } from "@/api/terminal-session-contract.js";
import type { OsWindow } from "./types.js";

type ProfileView = AgentStatusProfilesView extends ReadonlyMap<string, infer Profile>
  ? Profile
  : never;

type Group = TraditionalTerminalProjectGroup<DisplayTabEntry>;

interface TestFixture {
  group: Group;
  tab: DisplayTabEntry;
  mounted: MountedSession;
  status: TerminalAgentStatusRow;
  profile: ProfileView;
  profiles: Map<string, ProfileView>;
  connections: Map<string, ConnectionSnapshot>;
  profileLabels: Map<string, string>;
}

function makeStatus(patch: Partial<TerminalAgentStatusRow> = {}): TerminalAgentStatusRow {
  return {
    id: "term-1",
    incarnation: 1,
    agentKind: "omp",
    agentSessionId: "agent-session-1",
    reporterEpoch: 1,
    state: "idle",
    source: "lifecycle",
    attentionRevision: 0,
    ...patch,
  };
}

function createFixture(
  patch: Partial<TerminalAgentStatusRow> = {},
  profileId = "server-a",
  termId = "term-1",
): TestFixture {
  const status = makeStatus({ id: termId, ...patch });
  const terminalRef: TerminalRef = { profileId, id: status.id };
  const tab: DisplayTabEntry = {
    sessionId: terminalKey(terminalRef),
    terminalRef,
    profileId,
    label: "Terminal Tab",
    title: { baseLabel: "Terminal Tab", ordinal: 1, fullText: `Terminal ${termId}` },
    session: {
      id: status.id,
      incarnation: status.incarnation,
      alive: true,
      command: "bash",
      cwd: "/home/project",
      type: "shell",
      startedAt: 1000,
    },
  };
  const mounted: MountedSession = {
    sessionId: tab.sessionId,
    terminalRef,
    profileId,
  };
  const group: Group = {
    id: `group-${profileId}`,
    label: `Project on ${profileId}`,
    kind: "project",
    projectRef: { profileId, project: "main-project" },
    profileId,
    mountedSessions: [mounted],
    terminalTabs: [tab],
  };
  const owner: ConnectionRef = { profileId, generation: 1 };
  const profile: ProfileView = {
    owner,
    epoch: 1,
    revision: 1,
    availability: "ready",
    rows: new Map([[status.id, status]]),
    cursors: new Map(),
  };
  const connection: ConnectionSnapshot = {
    owner,
    status: "connected",
    intent: true,
    serverUrl: "http://localhost:4801",
    error: null,
  };

  return {
    group,
    tab,
    mounted,
    status,
    profile,
    profiles: new Map([[profileId, profile]]),
    connections: new Map([[profileId, connection]]),
    profileLabels: new Map([[profileId, profileId.toUpperCase()]]),
  };
}

describe("agent-hub", () => {
  describe("classifyAgentUrgency and ranking", () => {
    it("preserves strict urgency order: Needs attention -> Working -> Idle -> Unavailable", () => {
      const pAttention = {
        label: "Needs attention" as const,
        reasonLabel: "Approval" as const,
        outcomeHint: null,
        sourceLabel: "Hook observation" as const,
        coverageHint: null,
      };
      const pWorking = {
        label: "Working" as const,
        reasonLabel: null,
        outcomeHint: null,
        sourceLabel: "Lifecycle observation" as const,
        coverageHint: null,
      };
      const pIdle = {
        label: "Idle" as const,
        reasonLabel: null,
        outcomeHint: "Done (turn ended)" as const,
        sourceLabel: "Hook observation" as const,
        coverageHint: null,
      };
      const pUnknown = {
        label: "Unknown" as const,
        reasonLabel: null,
        outcomeHint: null,
        sourceLabel: "Lifecycle observation" as const,
        coverageHint: null,
      };

      expect(classifyAgentUrgency(pAttention, "connected")).toBe("needs-attention");
      expect(classifyAgentUrgency(pWorking, "connected")).toBe("working");
      expect(classifyAgentUrgency(pIdle, "connected")).toBe("idle");
      expect(classifyAgentUrgency(pUnknown, "connected")).toBe("unavailable");

      // Disconnected overrides presentation to unavailable
      expect(classifyAgentUrgency(pAttention, "disconnected")).toBe("unavailable");

      // Verify strict ranking order
      expect(getUrgencyRank("needs-attention")).toBeLessThan(getUrgencyRank("working"));
      expect(getUrgencyRank("working")).toBeLessThan(getUrgencyRank("idle"));
      expect(getUrgencyRank("idle")).toBeLessThan(getUrgencyRank("unavailable"));
    });
  });

  describe("buildAgentHubItems multi-profile fan-in", () => {
    it("fans in >=2 profiles with urgent items first and deterministic sorting", () => {
      const fixA = createFixture({ state: "idle" }, "server-a", "term-a1");
      const fixB = createFixture(
        { state: "blocked", reason: "approval", agentKind: "codex" },
        "server-b",
        "term-b1",
      );

      const combinedGroups = [fixA.group, fixB.group];
      const combinedProfiles = new Map([...fixA.profiles, ...fixB.profiles]);
      const combinedConnections = new Map([...fixA.connections, ...fixB.connections]);
      const combinedLabels = new Map([...fixA.profileLabels, ...fixB.profileLabels]);

      const items = buildAgentHubItems({
        groups: combinedGroups,
        profiles: combinedProfiles,
        connections: combinedConnections,
        profileLabels: combinedLabels,
      });

      expect(items).toHaveLength(2);
      // Needs attention (server-b) must sort ahead of Idle (server-a)
      expect(items[0].profileId).toBe("server-b");
      expect(items[0].urgency).toBe("needs-attention");
      expect(items[0].harnessLabel).toBe("Codex");

      expect(items[1].profileId).toBe("server-a");
      expect(items[1].urgency).toBe("idle");
      expect(items[1].harnessLabel).toBe("OMP");
    });

    it("honestly marks disconnected or generation-stale profile items as unavailable", () => {
      const fix = createFixture({ state: "working" }, "server-a", "term-a1");
      // Simulate disconnected server
      fix.connections.set("server-a", {
        ...fix.connections.get("server-a")!,
        status: "disconnected",
      });

      const items = buildAgentHubItems({
        groups: [fix.group],
        profiles: fix.profiles,
        connections: fix.connections,
        profileLabels: fix.profileLabels,
      });

      expect(items).toHaveLength(1);
      expect(items[0].urgency).toBe("unavailable");
      expect(items[0].isConnected).toBe(false);
      expect(items[0].presentation.label).toBe("Unavailable");
    });
  });

  describe("computeAgentHubSummary", () => {
    it("computes accurate summary counts across urgency groups", () => {
      const fixA = createFixture({ state: "idle" }, "server-a", "term-a1");
      const fixB = createFixture(
        { state: "blocked", reason: "question" },
        "server-b",
        "term-b1",
      );
      const items = buildAgentHubItems({
        groups: [fixA.group, fixB.group],
        profiles: new Map([...fixA.profiles, ...fixB.profiles]),
        connections: new Map([...fixA.connections, ...fixB.connections]),
        profileLabels: new Map([...fixA.profileLabels, ...fixB.profileLabels]),
      });

      const summary = computeAgentHubSummary(items, new Map([...fixA.connections, ...fixB.connections]));
      expect(summary.total).toBe(2);
      expect(summary.needsAttention).toBe(1);
      expect(summary.working).toBe(0);
      expect(summary.idle).toBe(1);
      expect(summary.unavailable).toBe(0);
      expect(summary.connectedProfiles).toBe(2);
    });
  });
  describe("Architecture Contract C2 & C3: Inventory-first, Proof, and Background", () => {
    it("includes unobserved sessions from aggregate inventory even without agent evidence", () => {
      const owner: ConnectionRef = { profileId: "server-a", generation: 1 };
      const conn: ConnectionSnapshot = {
        owner,
        status: "connected",
        intent: true,
        serverUrl: "http://localhost:4801",
        error: null,
      };

      const items = buildAgentHubItems({
        sessions: [
          {
            id: "term-raw-1",
            name: "Raw Terminal",
            command: "htop",
            cwd: "/home/user",
            type: "shell",
            startedAt: 1000,
            alive: true,
            incarnation: 1,
            incarnationExact: "1",
            profileId: "server-a",
            generation: 1,
            terminationState: "live",
            terminationTarget: {
              profileId: "server-a",
              generation: 1,
              serverEpoch: "00000000-0000-0000-0000-000000000001",
              terminalId: "term-raw-1",
              incarnation: "1",
            },
          },
        ],
        connections: new Map([["server-a", conn]]),
        profiles: new Map(), // No agent status!
        windows: {},
      });

      expect(items).toHaveLength(1);
      expect(items[0].isAgent).toBe(false);
      expect(items[0].isBackground).toBe(true);
      expect(items[0].urgency).toBe("unobserved");
      expect(items[0].terminationTarget).not.toBeNull();
      expect(items[0].terminationTarget?.terminalId).toBe("term-raw-1");
    });

    it("rejects unsafe numeric agent proof (> MAX_SAFE_INTEGER) while preserving valid exact End target", () => {
      const owner: ConnectionRef = { profileId: "server-a", generation: 1 };
      const conn: ConnectionSnapshot = {
        owner,
        status: "connected",
        intent: true,
        serverUrl: "http://localhost:4801",
        error: null,
      };

      // Agent status with unsafe number (or safe number that cannot equal max-u64)
      const agentStatus: TerminalAgentStatusRow = makeStatus({
        id: "term-max-u64",
        incarnation: 9007199254740992, // Unsafe number!
      });

      const profileView: ProfileView = {
        owner,
        epoch: 1,
        revision: 1,
        availability: "ready",
        rows: new Map([["term-max-u64", agentStatus]]),
        cursors: new Map(),
      };

      const items = buildAgentHubItems({
        sessions: [
          {
            id: "term-max-u64",
            name: "Max U64 Session",
            command: "worker",
            cwd: "/data",
            type: "shell",
            startedAt: 1000,
            alive: true,
            incarnationExact: MAX_U64_STRING,
            profileId: "server-a",
            generation: 1,
            terminationState: "live",
            terminationTarget: {
              profileId: "server-a",
              generation: 1,
              serverEpoch: "00000000-0000-0000-0000-000000000001",
              terminalId: "term-max-u64",
              incarnation: MAX_U64_STRING,
            },
          },
        ],
        connections: new Map([["server-a", conn]]),
        profiles: new Map([["server-a", profileView]]),
        windows: {},
      });

      expect(items).toHaveLength(1);
      // Agent join proof must fail due to unsafe number
      expect(items[0].isAgent).toBe(false);
      expect(items[0].urgency).toBe("unobserved");
      // Target remains eligible with max-u64 exact string!
      expect(items[0].terminationTarget?.incarnation).toBe(MAX_U64_STRING);
    });

    it("matches terminal windows strictly by exact runtime target tuple across desktops", () => {
      const target = {
        profileId: "server-a",
        generation: 1,
        serverEpoch: "00000000-0000-0000-0000-000000000001",
        terminalId: "term-1",
        incarnation: "5",
      };

      const windows: Record<string, OsWindow> = {
        "win-matched": {
          id: "win-matched",
          appId: "terminals",
          title: "Terminal 1",
          ctx: { profileId: "server-a" },
          mode: "tile",
          desktopId: "desktop-2", // Other desktop!
          maximized: false,
          minimized: true,
          runtimeIdentity: {
            kind: "terminal",
            target,
          },
        },
        "win-unverified": {
          id: "win-unverified",
          appId: "terminals",
          title: "Stale Terminal",
          ctx: { profileId: "server-a" },
          mode: "tile",
          desktopId: "desktop-1",
          maximized: false,
          minimized: false,
          appState: { sessionId: "term-1" }, // Raw ID only, no verified runtime target!
        },
      };

      const match = findMatchingTerminalWindow(target, windows);
      expect(match).not.toBeNull();
      expect(match?.windowId).toBe("win-matched");
      expect(match?.desktopId).toBe("desktop-2");
      expect(match?.minimized).toBe(true);

      // Stale target without runtimeIdentity does NOT match
      const staleTarget = {
        ...target,
        incarnation: "6", // different incarnation
      };
      expect(findMatchingTerminalWindow(staleTarget, windows)).toBeNull();
    });
  });
});
