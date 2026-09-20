// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { HostResourceResourceAlert, HostResourceSnapshotV1 } from "@/api/client.js";
import { profileQueryKey } from "@/api/query-client.js";
import { useHostResourceAlertPresentationStore } from "./use-host-resource-alert-presentation.js";
import {
  useMultiHostResources,
  type UseMultiHostResourcesResult,
} from "./use-multi-host-resources.js";

const state = vi.hoisted(() => ({
  profileVersion: 1,
  profiles: [] as ServerProfile[],
  profileListeners: new Set<() => void>(),
  connectionListeners: new Set<() => void>(),
  snapshots: new Map<string, ConnectionSnapshot>(),
  resourceSnapshots: new Map<string, HostResourceSnapshotV1 | (() => Promise<HostResourceSnapshotV1>)>(),
  apiCalls: new Map<string, number>(),
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => state.profiles,
  subscribeToProfileChanges: (listener: () => void) => {
    state.profileListeners.add(listener);
    return () => state.profileListeners.delete(listener);
  },
  getProfileChangeVersion: () => state.profileVersion,
}));

vi.mock("@/api/connections.js", () => ({
  subscribeConnections: (listener: () => void) => {
    state.connectionListeners.add(listener);
    return () => state.connectionListeners.delete(listener);
  },
  getConnectionSnapshot: (id: string) => state.snapshots.get(id) ?? null,
  isCurrentConnection: (owner: ConnectionRef) => {
    const snap = state.snapshots.get(owner.profileId);
    return snap?.status === "connected" && snap.owner.generation === owner.generation;
  },
}));

vi.mock("@/api/queries.js", () => ({
  resolveTargetOwner: (options?: unknown) => {
    if (typeof options === "string") {
      const snap = state.snapshots.get(options);
      return snap ? snap.owner : { profileId: options, generation: 1 };
    }
    return options as ConnectionRef | undefined;
  },
  getBoundApiClient: (owner: ConnectionRef) => ({
    system: {
      resourceSnapshot: async (): Promise<HostResourceSnapshotV1> => {
        const count = state.apiCalls.get(owner.profileId) ?? 0;
        state.apiCalls.set(owner.profileId, count + 1);

        const handler = state.resourceSnapshots.get(owner.profileId);
        if (!handler) {
          throw new Error(`No mock snapshot for ${owner.profileId}`);
        }
        if (typeof handler === "function") {
          return handler();
        }
        return handler;
      },
    },
  }),
}));

const makeSnapshot = (
  overrides: Partial<HostResourceSnapshotV1> = {},
): HostResourceSnapshotV1 =>
  ({
    host: {
      hostname: "test-host",
      os: "Linux",
      platform: "linux",
      uptimeSeconds: 1000,
    },
    memory: {
      totalBytes: 16_000_000_000,
      availableBytes: 8_000_000_000,
      usedBytes: 8_000_000_000,
      usagePercent: 50,
      availability: { state: "available", sampledAt: 1 },
    },
    battery: null,
    alert: overrides.alert ?? { state: "healthy", severity: "info" },
    currentAlerts: overrides.currentAlerts ?? [],
    ...overrides,
  }) as HostResourceSnapshotV1;

describe("useMultiHostResources", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let captured: UseMultiHostResourcesResult;

  function Harness({ enabled = true }: { enabled?: boolean }) {
    captured = useMultiHostResources({ enabled });
    return null;
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }

  function setProfileConnection(
    profileId: string,
    status: ConnectionSnapshot["status"],
    generation = 1,
  ) {
    state.snapshots.set(profileId, {
      status,
      intent: status === "connected",
      owner: { profileId, generation },
      error: null,
    } as ConnectionSnapshot);
  }

  function notifyConnections() {
    state.connectionListeners.forEach((l) => l());
  }

  beforeEach(() => {
    vi.useFakeTimers();
    useHostResourceAlertPresentationStore.getState().reset();
    state.profiles = [];
    state.snapshots.clear();
    state.resourceSnapshots.clear();
    state.apiCalls.clear();
    state.profileListeners.clear();
    state.connectionListeners.clear();
    state.profileVersion = 1;

    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it("handles empty configured profiles", async () => {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await flush();

    expect(captured.configuredProfileCount).toBe(0);
    expect(captured.entries).toEqual([]);
    expect(captured.summary.watchedCount).toBe(0);
    expect(captured.summary.presentation.label).toBe("No watched profiles");
  });

  it("filters profiles: connected manual, connected auto-connect, and offline auto-connect in; disconnected manual out", async () => {
    state.profiles = [
      { id: "p1", name: "Manual Connected", url: "http://p1", authType: "token", createdAt: 0, autoConnect: false },
      { id: "p2", name: "Auto Connected", url: "http://p2", authType: "token", createdAt: 0, autoConnect: true },
      { id: "p3", name: "Auto Disconnected", url: "http://p3", authType: "token", createdAt: 0, autoConnect: true },
      { id: "p4", name: "Manual Disconnected", url: "http://p4", authType: "token", createdAt: 0, autoConnect: false },
    ];

    setProfileConnection("p1", "connected", 1);
    setProfileConnection("p2", "connected", 1);
    setProfileConnection("p3", "disconnected", 1);
    setProfileConnection("p4", "disconnected", 1);

    state.resourceSnapshots.set("p1", makeSnapshot());
    state.resourceSnapshots.set("p2", makeSnapshot());

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await flush();

    expect(captured.configuredProfileCount).toBe(4);
    expect(captured.entries.length).toBe(3);
    expect(captured.entries.map((e) => e.profile.id)).toEqual(["p1", "p2", "p3"]);

    expect(captured.entries[0].watchReason).toBe("connected");
    expect(captured.entries[0].connected).toBe(true);

    expect(captured.entries[1].watchReason).toBe("connected-and-auto-connect");
    expect(captured.entries[1].connected).toBe(true);

    expect(captured.entries[2].watchReason).toBe("auto-connect");
    expect(captured.entries[2].connected).toBe(false);

    expect(state.apiCalls.get("p1")).toBe(1);
    expect(state.apiCalls.get("p2")).toBe(1);
    expect(state.apiCalls.get("p3")).toBeUndefined();
    expect(state.apiCalls.get("p4")).toBeUndefined();
  });

  it("isolates partial query failures so healthy peers continue operating", async () => {
    state.profiles = [
      { id: "p1", name: "Healthy Host", url: "http://p1", authType: "token", createdAt: 0 },
      { id: "p2", name: "Failing Host", url: "http://p2", authType: "token", createdAt: 0 },
    ];

    setProfileConnection("p1", "connected", 1);
    setProfileConnection("p2", "connected", 1);

    state.resourceSnapshots.set("p1", makeSnapshot());
    state.resourceSnapshots.set("p2", () => Promise.reject(new Error("Network timeout")));

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await flush();

    expect(captured.entries.length).toBe(2);
    expect(captured.entries[0].isError).toBe(false);
    expect(captured.entries[0].snapshot).toBeDefined();
    expect(captured.entries[0].status.baseLabel).toBe("Healthy");

    expect(captured.entries[1].isError).toBe(true);
    expect(captured.entries[1].snapshot).toBeUndefined();
    expect(captured.entries[1].status.mode).toBe("terminal-unavailable");

    expect(captured.summary.watchedCount).toBe(2);
    expect(captured.summary.connectedCount).toBe(2);
    expect(captured.summary.unavailableCount).toBe(1);
    expect(captured.summary.presentation.label).toBe("1 host unavailable");
  });

  it("fences stale generation results and rejects late data from replaced owners", async () => {
    state.profiles = [
      { id: "p1", name: "Host 1", url: "http://p1", authType: "token", createdAt: 0 },
    ];
    setProfileConnection("p1", "connected", 1);

    let resolveGen1: ((snap: HostResourceSnapshotV1) => void) | null = null;
    let resolveGen2: ((snap: HostResourceSnapshotV1) => void) | null = null;
    let callCount = 0;

    state.resourceSnapshots.set("p1", () => {
      callCount++;
      if (callCount === 1) {
        return new Promise<HostResourceSnapshotV1>((res) => {
          resolveGen1 = res;
        });
      }
      return new Promise<HostResourceSnapshotV1>((res) => {
        resolveGen2 = res;
      });
    });

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await flush();
    expect(state.apiCalls.get("p1")).toBe(1);

    // p1 generation changes while gen 1 query is in flight
    await act(async () => {
      setProfileConnection("p1", "connected", 2);
      notifyConnections();
    });
    await flush();
    expect(state.apiCalls.get("p1")).toBe(2);

    // Now gen 1 late response resolves
    await act(async () => {
      resolveGen1?.(
        makeSnapshot({
          host: { hostname: "old-host", os: "Linux", platform: "linux", uptimeSeconds: 1 },
        }),
      );
    });
    await flush();

    // The late response from generation 1 must be rejected with error
    const queryKeyGen1 = profileQueryKey({ profileId: "p1", generation: 1 }, "system", "resource-snapshot");
    const queryStateGen1 = client.getQueryState(queryKeyGen1);
    expect(queryStateGen1?.status).toBe("error");
    expect(queryStateGen1?.error).toBeInstanceOf(Error);

    // Now gen 2 resolves with current host data
    await act(async () => {
      resolveGen2?.(
        makeSnapshot({
          host: { hostname: "current-host", os: "Linux", platform: "linux", uptimeSeconds: 200 },
        }),
      );
    });
    await flush();

    expect(captured.entries[0].snapshot?.host.hostname).toBe("current-host");
    expect(captured.entries[0].owner.generation).toBe(2);
  });

  it("feeds snapshot alerts into byProfile store and calculates fleet unread correctly", async () => {
    state.profiles = [
      { id: "p1", name: "Host 1", url: "http://p1", authType: "token", createdAt: 0 },
      { id: "p2", name: "Host 2", url: "http://p2", authType: "token", createdAt: 0 },
    ];

    setProfileConnection("p1", "connected", 1);
    setProfileConnection("p2", "connected", 1);

    state.resourceSnapshots.set(
      "p1",
      makeSnapshot({
        alert: { state: "memoryPressure", severity: "warning" },
        currentAlerts: [
          {
            incidentId: "inc-1",
            state: "memoryPressure",
            severity: "warning",
            resolvedAt: null,
          } as unknown as HostResourceResourceAlert,
        ],
      }),
    );

    state.resourceSnapshots.set(
      "p2",
      makeSnapshot({
        alert: { state: "oomRisk", severity: "critical" },
        currentAlerts: [
          {
            // Same incident ID across two servers must not merge or overwrite each other
            incidentId: "inc-1",
            state: "oomRisk",
            severity: "critical",
            resolvedAt: null,
          } as unknown as HostResourceResourceAlert,
        ],
      }),
    );

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await flush();

    expect(captured.entries[0].unreadCount).toBe(1);
    expect(captured.entries[1].unreadCount).toBe(1);
    expect(captured.summary.unreadCount).toBe(2);
    expect(captured.summary.attentionCount).toBe(2);
    expect(captured.summary.presentation.rank).toBe(3);
    expect(captured.summary.presentation.tone).toBe("critical");
    expect(captured.summary.presentation.badgeText).toBe("2");
  });

  it("respects enabled: false and performs zero network requests", async () => {
    state.profiles = [
      { id: "p1", name: "Host 1", url: "http://p1", authType: "token", createdAt: 0 },
    ];
    setProfileConnection("p1", "connected", 1);
    state.resourceSnapshots.set("p1", makeSnapshot());

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Harness, { enabled: false }),
        ),
      );
    });
    await flush();

    expect(state.apiCalls.get("p1")).toBeUndefined();
    expect(captured.entries.length).toBe(1);
    expect(captured.entries[0].isLoading).toBe(false);
  });
});
