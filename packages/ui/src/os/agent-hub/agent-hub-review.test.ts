import { describe, it, expect, vi } from "vitest";
import {
  requestAgentHubReview,
  type RequestAgentHubReviewDependencies,
} from "./agent-hub-review.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";

function createMockItem(overrides?: Partial<AgentHubItem>): AgentHubItem {
  const target: TerminalTarget = {
    profileId: "profile-1",
    generation: 2,
    terminalId: "term-123",
    incarnation: "inc-abc-1",
    serverEpoch: "epoch-100",
  };

  return {
    key: "item-1",
    sessionId: "term-123",
    terminalRef: { profileId: "profile-1", id: "term-123" },
    incarnation: 1,
    incarnationExact: "inc-abc-1",
    terminationTarget: target,
    groupId: "group-1",
    projectLabel: "dam-hopper",
    profileId: "profile-1",
    profileLabel: "Local Host",
    terminalTitle: "bash",
    harnessLabel: "OMP",
    statusOwner: { profileId: "profile-1", generation: 2 },
    availability: "alive",
    status: {
      agentSessionId: "omp-session-456",
      status: "idle",
      updatedAt: 123456,
    },
    presentation: {
      badge: "idle",
      label: "Idle",
      reasonLabel: null,
      outcomeHint: null,
      color: "neutral",
    },
    urgency: "idle",
    connectionStatus: "connected",
    isConnected: true,
    isAgent: true,
    isBackground: false,
    matchingWindow: null,
    ...overrides,
  };
}

function createMockSnapshot(overrides?: Partial<ConnectionSnapshot>): ConnectionSnapshot {
  return {
    status: "connected",
    owner: { profileId: "profile-1", generation: 2 },
    serverEpoch: "epoch-100",
    worktrees: [],
    projects: [],
    ...overrides,
  } as unknown as ConnectionSnapshot;
}

describe("requestAgentHubReview", () => {
  it("rejects when item is not an agent or evidence is missing", async () => {
    const itemNotAgent = createMockItem({ isAgent: false });
    const res1 = await requestAgentHubReview(itemNotAgent, "win-1");
    expect(res1.ok).toBe(false);
    expect(res1.notice).toContain("Agent evidence proof missing");

    const itemNoStatus = createMockItem({ status: undefined });
    const res2 = await requestAgentHubReview(itemNoStatus, "win-1");
    expect(res2.ok).toBe(false);
    expect(res2.notice).toContain("Agent evidence proof missing");

    const itemNoTarget = createMockItem({ terminationTarget: null });
    const res3 = await requestAgentHubReview(itemNoTarget, "win-1");
    expect(res3.ok).toBe(false);
    expect(res3.notice).toContain("Agent evidence proof missing");
  });

  it("rejects when target profile is disconnected or missing", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => null,
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toBe('Review unavailable: Target profile "Local Host" is disconnected.');
  });

  it("rejects when profile generation mismatches target generation pre-await", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot({ owner: { profileId: "profile-1", generation: 3 } }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("generation changed (expected 2, live 3)");
  });

  it("rejects when server sessionChangesEnabled is false", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: false } }),
        },
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("Session changes tracking is disabled on server");
  });

  it("rejects when connection is retired or generation changes during status resolution (post-await)", async () => {
    const item = createMockItem();
    let callCount = 0;
    const deps = {
      getConnectionSnapshot: () => {
        callCount++;
        if (callCount === 1) return createMockSnapshot({ owner: { profileId: "profile-1", generation: 2 } });
        return createMockSnapshot({ owner: { profileId: "profile-1", generation: 3 } });
      },
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "ready",
          rootId: "root-1",
          baselineId: "base-1",
          serverEpoch: "epoch-100",
        }),
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("Connection retired or changed during status resolution.");
  });

  it("rejects when status terminalIncarnation mismatches target", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-different",
          state: "ready",
          rootId: "root-1",
          baselineId: "base-1",
          serverEpoch: "epoch-100",
        }),
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("Incarnation mismatch (status inc-different, target inc-abc-1)");
  });

  it("rejects when session changes is currently initializing", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "initializing",
          rootId: "root-1",
          baselineId: "base-1",
          serverEpoch: "epoch-100",
        }),
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("Session changes is currently initializing");
  });

  it("rejects when rootId or baselineId is missing", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "ready",
          rootId: undefined,
          baselineId: "base-1",
          serverEpoch: "epoch-100",
        }),
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toContain("No session changes baseline has been established yet.");
  });

  it("rejects when serverEpoch is missing or mismatches authority", async () => {
    const item = createMockItem();
    const depsMissing = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "ready",
          rootId: "root-1",
          baselineId: "base-1",
          serverEpoch: undefined,
        }),
      }),
    };
    const res1 = await requestAgentHubReview(item, "win-1", depsMissing);
    expect(res1.ok).toBe(false);
    expect(res1.notice).toContain("Missing server epoch in session changes status.");

    const depsMismatch = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "ready",
          rootId: "root-1",
          baselineId: "base-1",
          serverEpoch: "epoch-999",
        }),
      }),
    };
    const res2 = await requestAgentHubReview(item, "win-1", depsMismatch);
    expect(res2.ok).toBe(false);
    expect(res2.notice).toContain("Server epoch mismatch (status epoch-999, target epoch-100)");
  });

  it("catches and surfaces network/API errors cleanly", async () => {
    const item = createMockItem();
    const deps = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => {
            throw new Error("RPC failed: connection reset");
          },
        },
      }),
    };
    const res = await requestAgentHubReview(item, "win-1", deps);
    expect(res.ok).toBe(false);
    expect(res.notice).toBe("Review unavailable: RPC failed: connection reset");
  });

  it("dispatches session-changes:open intent with frozen ReviewTarget on success", async () => {
    const item = createMockItem();
    const dispatchedIntents: { type: string; sourceWindowId: string; payload: unknown }[] = [];
    const deps: RequestAgentHubReviewDependencies = {
      getConnectionSnapshot: () => createMockSnapshot(),
      getApi: () => ({
        config: {
          get: async () => ({ server: { sessionChangesEnabled: true } }),
        },
      }),
      createSessionChangesClient: () => ({
        getStatus: async () => ({
          terminalIncarnation: "inc-abc-1",
          state: "ready",
          rootId: "root-10",
          baselineId: "base-20",
          serverEpoch: "epoch-100",
        }),
      }),
      dispatchIntent: (intent: unknown) => {
        dispatchedIntents.push(intent as { type: string; sourceWindowId: string; payload: unknown });
        return { handled: true };
      },
    };

    const res = await requestAgentHubReview(item, "win-hub-1", deps);
    expect(res.ok).toBe(true);
    expect(res.notice).toBeUndefined();
    expect(dispatchedIntents).toHaveLength(1);
    expect(dispatchedIntents[0]).toMatchObject({
      action: "session-changes:open",
      sourceWindowId: "win-hub-1",
      payload: {
        profileId: "profile-1",
        generation: 2,
        terminalId: "term-123",
        terminalIncarnation: "inc-abc-1",
        ompSessionId: "omp-session-456",
        serverEpoch: "epoch-100",
        rootId: "root-10",
        baselineId: "base-20",
      },
    });
    const firstIntent = dispatchedIntents[0];
    expect(firstIntent && Object.isFrozen(firstIntent.payload)).toBe(true);
  });
});
