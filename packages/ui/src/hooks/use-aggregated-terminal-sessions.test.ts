// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import { profileQueryKey } from "@/api/query-client.js";
import { useAggregatedTerminalSessions } from "./use-aggregated-terminal-sessions.js";

const state = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  snapshots: new Map<string, { owner: ConnectionRef; status: string }>(),
  invoke: vi.fn(),
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => [{ id: "a" }, { id: "b" }],
  subscribeToProfileChanges: () => () => {},
  getProfileChangeVersion: () => 1,
}));
vi.mock("@/api/connections.js", () => ({
  subscribeConnections: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
  getConnectionSnapshot: (id: string) => state.snapshots.get(id) ?? null,
  isCurrentConnection: (owner: ConnectionRef) => {
    const snapshot = state.snapshots.get(owner.profileId);
    return snapshot?.status === "connected" && snapshot.owner.generation === owner.generation;
  },
  getTransport: (owner: ConnectionRef) => ({
    invoke: () => state.invoke(owner),
  }),
}));

const session = (marker: string) => ({
  id: "shared-session",
  project: "shared-project",
  command: marker,
  alive: true,
  startedAt: 100,
  incarnation: 1,
  incarnationExact: "1",
  terminationState: "live" as const,
});

describe("useAggregatedTerminalSessions", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let captured: ReturnType<typeof useAggregatedTerminalSessions>;

  function Harness() {
    captured = useAggregatedTerminalSessions();
    return null;
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function connect(id: string, generation: number, status = "connected") {
    await act(async () => {
      state.snapshots.set(id, { owner: { profileId: id, generation }, status });
      state.listeners.forEach((listener) => listener());
    });
    await flush();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    state.snapshots.clear();
    state.listeners.clear();
    state.invoke.mockReset().mockImplementation(async (owner: ConnectionRef) => ({
      sessions: [session(`${owner.profileId}-${owner.generation}`)],
      termination: {
        version: 1,
        serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
      },
    }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Harness)));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.useRealTimers();
  });

  it("enables profiles independently and refreshes only the event owner despite colliding IDs", async () => {
    await connect("a", 1);
    await connect("b", 1);
    expect(captured.sessions.map(({ id, profileId, command }) => ({ id, profileId, command }))).toEqual([
      { id: "shared-session", profileId: "a", command: "a-1" },
      { id: "shared-session", profileId: "b", command: "b-1" },
    ]);
    state.invoke.mockImplementation(async (owner: ConnectionRef) => ({
      sessions: [session(`${owner.profileId}-updated`)],
      termination: {
        version: 1,
        serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
      },
    }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: profileQueryKey({ profileId: "a", generation: 1 }, "terminal-sessions") });
    });
    await flush();
    expect(captured.sessions.map((item) => item.command)).toEqual(["a-updated", "b-1"]);
  });

  it("rebuilds query specs for status and generation changes while keeping healthy peers", async () => {
    await connect("a", 1, "connecting");
    await connect("b", 1);
    expect(captured.sessions.map((item) => item.profileId)).toEqual(["b"]);
    await connect("a", 1);
    expect(captured.sessions.map((item) => item.command)).toEqual(["a-1", "b-1"]);
    await connect("a", 2, "offline");
    expect(captured.sessions.map((item) => item.command)).toEqual(["b-1"]);
    await connect("a", 2);
    expect(captured.sessions.map((item) => item.command)).toEqual(["a-2", "b-1"]);
    await connect("a", 3);
    expect(captured.sessions.map((item) => item.command)).toEqual(["a-3", "b-1"]);
  });

  it("rejects a delayed old-generation response without poisoning the replacement", async () => {
    const oldDeferred = Promise.withResolvers<unknown>();
    state.invoke.mockImplementation((owner: ConnectionRef) =>
      owner.profileId === "a" && owner.generation === 1
        ? oldDeferred.promise
        : Promise.resolve({
            sessions: [session(`${owner.profileId}-${owner.generation}`)],
            termination: {
              version: 1,
              serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
            },
          }),
    );
    await connect("a", 1);
    await connect("b", 1);
    await connect("a", 2);
    await act(async () =>
      oldDeferred.resolve({
        sessions: [session("stale")],
        termination: {
          version: 1,
          serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
        },
      }),
    );
    await flush();
    expect(captured.sessions.map((item) => item.command)).toEqual(["a-2", "b-1"]);
    expect(client.getQueryData(profileQueryKey({ profileId: "a", generation: 1 }, "terminal-sessions"))).toBeUndefined();
  });
  it("projects observations and attaches valid terminationTarget on aggregated rows", async () => {
    await connect("a", 1);
    expect(captured.observations).toHaveLength(1);
    expect(captured.observations[0].owner?.profileId).toBe("a");
    expect(captured.sessions[0].terminationTarget).toEqual({
      profileId: "a",
      generation: 1,
      serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
      terminalId: "shared-session",
      incarnation: "1",
    });
  });
});
