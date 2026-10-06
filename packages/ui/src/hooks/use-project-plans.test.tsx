// @vitest-environment jsdom
// Tests for useProjectPlans hook — Phase 03
// Aligned with contracts.md section 7 and phase-03-owner-bound-client-and-refresh.md

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ApiClient } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import type {
  PlanFoldersResponse,
  SelectedPlanResponse,
} from "@/api/project-plans-types.js";
import {
  useProjectPlans,
  type UseProjectPlansOptions,
  type UseProjectPlansResult,
} from "./use-project-plans.js";
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockOwner: ConnectionRef = {
  profileId: "test-profile-1",
  generation: 1,
};

const mockTarget = {
  project: "dam-hopper",
  worktreePath: null,
};

const mockFoldersData: PlanFoldersResponse = {
  target: {
    project: "dam-hopper",
    worktreePath: null,
    targetKey: '["dam-hopper",null]',
  },
  path: "plans",
  kind: "collection",
  folderState: "present",
  folders: [
    { path: "plans/261006-plan-a", name: "261006-plan-a" },
    { path: "plans/261006-plan-b", name: "261006-plan-b" },
  ],
  listing: {
    complete: true,
    entriesVisited: 2,
    limitsReached: [],
  },
  watchPaths: [".", "plans"],
  diagnostics: [],
};

const mockPlanData: SelectedPlanResponse = {
  target: {
    project: "dam-hopper",
    worktreePath: null,
    targetKey: '["dam-hopper",null]',
  },
  plan: {
    id: "plans/261006-plan-a",
    title: "Plan Alpha",
    description: "First test plan",
    metadata: {
      priority: "P2",
      effort: "40h",
      issue: null,
      branch: null,
      tags: [],
    },
    documents: {
      plan: {
        path: "plans/261006-plan-a/plan.md",
        state: "readable",
        sizeBytes: 100,
        modifiedAt: "2026-10-06T10:00:00Z",
      },
      progress: {
        path: "plans/261006-plan-a/progress.md",
        state: "readable",
        sizeBytes: 50,
        modifiedAt: "2026-10-06T10:01:00Z",
      },
    },
    reportedStatus: {
      value: "in-progress",
      authority: "progress",
      raw: "In Progress",
      evidence: [],
      captured: [],
    },
    phases: [],
    completion: {
      declared: 0,
      completed: 0,
      unknown: 0,
      conflicted: 0,
      fraction: null,
    },
    dates: {
      created: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    },
    lastDocumentUpdate: "2026-10-06T10:01:00Z",
    diagnostics: [],
  },
  watchPaths: [".", "plans", "plans/261006-plan-a"],
  diagnostics: [],
};

describe("useProjectPlans hook", () => {
  let qc: QueryClient;
  let container: HTMLDivElement;
  let root: Root;

  let activeSubIdCounter = 100;
  let subscribedPaths: string[] = [];
  let unsubscribedIds: number[] = [];
  let eventCallbacks: Map<number, (ev: unknown) => void> = new Map();
  let overflowCallbacks: Map<number, (msg: string) => void> = new Map();

  let mockTransport: Transport & {
    fsSubscribeTree: (
      target: unknown,
      path: string,
      opts?: { watchOnly?: boolean },
    ) => Promise<{ sub_id: number }>;
    fsUnsubscribeTree: (sub_id: number) => void;
    onFsEvent: (sub_id: number, cb: (ev: unknown) => void) => () => void;
    onFsOverflow: (sub_id: number, cb: (msg: string) => void) => () => void;
  };

  let mockClient: ApiClient;

  beforeEach(() => {
    resetConnections();
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    activeSubIdCounter = 100;
    subscribedPaths = [];
    unsubscribedIds = [];
    eventCallbacks.clear();
    overflowCallbacks.clear();

    mockTransport = {
      invoke: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      onTerminalData: vi.fn(() => () => {}),
      onTerminalExit: vi.fn(() => () => {}),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      uploadBrowserDebugPng: vi.fn(),
      fsSubscribeTree: vi.fn(async (_target, path) => {
        const sub_id = ++activeSubIdCounter;
        subscribedPaths.push(path);
        return { sub_id };
      }),
      fsUnsubscribeTree: vi.fn((sub_id: number) => {
        unsubscribedIds.push(sub_id);
      }),
      onFsEvent: vi.fn((sub_id: number, cb: (ev: unknown) => void) => {
        eventCallbacks.set(sub_id, cb);
        return () => {
          eventCallbacks.delete(sub_id);
        };
      }),
      onFsOverflow: vi.fn((sub_id: number, cb: (msg: string) => void) => {
        overflowCallbacks.set(sub_id, cb);
        return () => {
          overflowCallbacks.delete(sub_id);
        };
      }),
    };

    mockClient = {
      plans: {
        folders: vi.fn(async () => mockFoldersData),
        read: vi.fn(async () => mockPlanData),
      },
      fs: {
        read: vi.fn(async () => ({
          ok: true,
          content: btoa("# Test Plan Document"),
          binary: false,
        })),
      },
    } as unknown as ApiClient;

    __setConnectionSnapshotForTests(mockOwner.profileId, {
      owner: mockOwner,
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
      transport: mockTransport,
      api: mockClient,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    qc.clear();
    resetConnections();
  });

  function renderHookHelper(initialOptions: UseProjectPlansOptions) {
    let latestResult: UseProjectPlansResult | undefined;

    function TestComponent(props: { options: UseProjectPlansOptions }) {
      latestResult = useProjectPlans(props.options);
      return null;
    }

    const render = async (options: UseProjectPlansOptions) => {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client: qc },
            createElement(TestComponent, { options }),
          ),
        );
      });
    };

    return {
      render,
      get result() {
        return latestResult!;
      },
    };
  }

  it("reports unsupported coverage and disables queries when disabled or missing owner", async () => {
    const harness = renderHookHelper({
      enabled: false,
      owner: null,
      target: mockTarget,
      browsePath: "plans",
    });

    await harness.render({
      enabled: false,
      owner: null,
      target: mockTarget,
      browsePath: "plans",
    });

    expect(harness.result.coverage.status).toBe("unsupported");
    expect(harness.result.isFoldersLoading).toBe(false);
    expect(mockTransport.fsSubscribeTree).not.toHaveBeenCalled();
  });

  it("mounts folder browsing and reaches live coverage", async () => {
    const harness = renderHookHelper({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    // Subscribed to root and plans
    expect(mockTransport.fsSubscribeTree).toHaveBeenCalledWith(
      expect.anything(),
      ".",
      { watchOnly: true },
    );
    expect(harness.result.coverage.status).toBe("live");
    expect(harness.result.foldersData).toEqual(mockFoldersData);
  });

  it("switches to selected plan and reconciles watch set", async () => {
    const harness = renderHookHelper({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      selectedPlanPath: null,
      client: mockClient,
      transport: mockTransport,
    });

    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      selectedPlanPath: null,
      client: mockClient,
      transport: mockTransport,
    });

    expect(harness.result.foldersData).toBeDefined();

    // Now select plan
    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      selectedPlanPath: "plans/261006-plan-a",
      client: mockClient,
      transport: mockTransport,
    });

    expect(mockTransport.fsSubscribeTree).toHaveBeenCalledWith(
      expect.anything(),
      "plans/261006-plan-a",
      { watchOnly: true },
    );
    expect(harness.result.selectedPlanData).toEqual(mockPlanData);
  });

  it("immediately unsubscribes if unmounted before delayed subscription completes", async () => {
    const { promise, resolve } = Promise.withResolvers<{ sub_id: number }>();
    mockTransport.fsSubscribeTree = vi.fn(async () => promise);

    const harness = renderHookHelper({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    // Unmount before subscription finishes
    await act(async () => {
      root.unmount();
    });

    // Now subscription resolves late
    await act(async () => {
      resolve({ sub_id: 888 });
    });

    // Originating transport must receive immediate unsubscribe call
    expect(mockTransport.fsUnsubscribeTree).toHaveBeenCalledWith(888);
  });

  it("handles filesystem overflow by disposing handle, invalidating, and reconciling", async () => {
    const harness = renderHookHelper({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    expect(overflowCallbacks.size).toBeGreaterThan(0);

    // Pick first registered subId and fire overflow
    const firstSubId = Array.from(overflowCallbacks.keys())[0];
    const overflowFn = overflowCallbacks.get(firstSubId)!;

    await act(async () => {
      overflowFn("queue full");
    });

    // Handle disposed
    expect(unsubscribedIds).toContain(firstSubId);
  });

  it("limits excessive churn to degraded coverage and recovers with manual refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const harness = renderHookHelper({
        enabled: true,
        owner: mockOwner,
        target: mockTarget,
        browsePath: "plans",
        client: mockClient,
        transport: mockTransport,
      });

      await harness.render({
        enabled: true,
        owner: mockOwner,
        target: mockTarget,
        browsePath: "plans",
        client: mockClient,
        transport: mockTransport,
      });

      const firstSubId = Array.from(eventCallbacks.keys())[0];
      const eventFn = eventCallbacks.get(firstSubId)!;

      // Fire 4 rapid event bursts past MAX_CHURN_RECONCILE_PASSES (3)
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          eventFn({ kind: "modify" });
          await vi.advanceTimersByTimeAsync(60);
        });
      }

      expect(harness.result.coverage.status).toBe("degraded");
      expect(harness.result.coverage.reason).toContain("Excessive filesystem churn");

      // Manual refresh resets churn and recovers to live
      await act(async () => {
        await harness.result.refresh();
      });

      expect(harness.result.coverage.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up active subscriptions on unmount", async () => {
    const harness = renderHookHelper({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    await harness.render({
      enabled: true,
      owner: mockOwner,
      target: mockTarget,
      browsePath: "plans",
      client: mockClient,
      transport: mockTransport,
    });

    expect(subscribedPaths.length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });

    expect(unsubscribedIds.length).toBe(subscribedPaths.length);
  });
});
