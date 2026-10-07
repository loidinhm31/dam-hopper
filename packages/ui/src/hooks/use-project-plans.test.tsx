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
  let watchPathsById: Map<number, string> = new Map();
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
    watchPathsById.clear();
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
        watchPathsById.set(sub_id, path);
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

  function emitForPath(
    path: string,
    event: {
      kind: string;
      path: string;
      from?: string;
      targetRelativePath?: string;
      targetRelativeFrom?: string;
    },
  ) {
    const relative = (absolute: string | undefined) =>
      absolute === "/workspace"
        ? "."
        : absolute?.startsWith("/workspace/")
          ? absolute.substring("/workspace/".length)
          : undefined;
    const wireEvent = {
      targetRelativePath: relative(event.path),
      targetRelativeFrom: relative(event.from),
      ...event,
    };
    for (const [id, callback] of Array.from(eventCallbacks)) {
      if (watchPathsById.get(id) === path) callback(wireEvent);
    }
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

  it("fetches a distinct post-install snapshot rather than accepting a delayed initial response", async () => {
    vi.useFakeTimers();
    try {
      const initialRead = Promise.withResolvers<PlanFoldersResponse>();
      const installation = Promise.withResolvers<{ sub_id: number }>();
      let snapshot = mockFoldersData;
      vi.mocked(mockClient.plans.folders)
        .mockImplementationOnce(() => initialRead.promise)
        .mockImplementation(async () => snapshot);
      const subscribe = mockTransport.fsSubscribeTree;
      mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
        if (path === "plans") {
          subscribedPaths.push(path);
          watchPathsById.set(902, path);
          return installation.promise;
        }
        return subscribe(target, path, opts);
      });
      const options = {
        owner: mockOwner,
        target: mockTarget,
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      expect(harness.result.foldersData).toBeUndefined();
      expect(vi.mocked(mockClient.plans.folders).mock.calls).toHaveLength(1);

      // This save has no listener yet. The first request still holds the old DTO.
      snapshot = {
        ...mockFoldersData,
        folders: [{ path: "plans/after-install", name: "after-install" }],
      };
      await act(async () => {
        installation.resolve({ sub_id: 902 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(vi.mocked(mockClient.plans.folders).mock.calls).toHaveLength(2);
      expect(harness.result.foldersData?.folders[0].name).toBe("after-install");
      expect(harness.result.coverage.status).toBe("live");
      await act(async () => {
        initialRead.resolve(mockFoldersData);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(harness.result.foldersData?.folders[0].name).toBe("after-install");
      expect(harness.result.coverage.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves navigation handles for unrelated root saves but rebinds plans replacement", async () => {
    vi.useFakeTimers();
    try {
      let snapshot = mockPlanData;
      vi.mocked(mockClient.plans.read).mockImplementation(async () => snapshot);
      const options = {
        owner: mockOwner,
        target: mockTarget,
        selectedPlanPath: "plans/261006-plan-a",
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const originalIds = Array.from(eventCallbacks.keys());
      const rootId = originalIds.find((id) => watchPathsById.get(id) === ".")!;
      const descendantIds = originalIds.filter((id) => id !== rootId);
      const registrations = subscribedPaths.length;
      snapshot = {
        ...mockPlanData,
        plan: { ...mockPlanData.plan, title: "Fresh root save" },
      };
      await act(async () => {
        emitForPath(".", {
          kind: "renamed",
          path: "/workspace/README.md",
          from: "/workspace/README.tmp",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.selectedPlanData?.plan.title).toBe(
        "Fresh root save",
      );
      expect(subscribedPaths).toHaveLength(registrations);
      expect(Array.from(eventCallbacks.keys())).toEqual(originalIds);
      expect(unsubscribedIds).toEqual([]);

      await act(async () => {
        emitForPath(".", {
          kind: "renamed",
          path: "/workspace/plans",
          from: "/workspace/replacement",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(eventCallbacks.has(rootId)).toBe(true);
      expect(descendantIds.every((id) => !eventCallbacks.has(id))).toBe(true);
      expect(unsubscribedIds.sort()).toEqual(descendantIds.sort());
      expect(eventCallbacks.size).toBe(3);
      expect(harness.result.coverage.status).toBe("live");
      snapshot = {
        ...snapshot,
        plan: { ...snapshot.plan, title: "Fresh replacement" },
      };
      await act(async () => {
        emitForPath("plans/261006-plan-a", {
          kind: "modified",
          path: "/workspace/plans/261006-plan-a/plan.md",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.selectedPlanData?.plan.title).toBe(
        "Fresh replacement",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["relative metadata", "legacy event"] as const)(
    "rebinds target-root self replacement with %s despite an identical snapshot and observes later replacement edits",
    async (wireMode) => {
      vi.useFakeTimers();
      try {
        let snapshot = mockPlanData;
        vi.mocked(mockClient.plans.read).mockImplementation(
          async () => snapshot,
        );
        const options = {
          owner: mockOwner,
          target: mockTarget,
          selectedPlanPath: "plans/261006-plan-a",
          client: mockClient,
          transport: mockTransport,
        };
        const harness = renderHookHelper(options);
        await harness.render(options);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const originalData = harness.result.selectedPlanData;
        const originalIds = Array.from(eventCallbacks.keys());
        const rootId = originalIds.find(
          (id) => watchPathsById.get(id) === ".",
        )!;
        await act(async () => {
          eventCallbacks.get(rootId)!({
            kind: "removed",
            path: "/workspace/repo",
            ...(wireMode === "relative metadata"
              ? { targetRelativePath: "." }
              : {}),
          });
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(harness.result.selectedPlanData).toBe(originalData);
        expect(unsubscribedIds.sort()).toEqual(originalIds.sort());
        expect(
          originalIds.every(
            (id) => !eventCallbacks.has(id) && !overflowCallbacks.has(id),
          ),
        ).toBe(true);
        expect(eventCallbacks.size).toBe(3);
        expect(harness.result.coverage.status).toBe("live");
        snapshot = {
          ...snapshot,
          plan: { ...snapshot.plan, title: "Replacement root edit" },
        };
        await act(async () => {
          emitForPath("plans/261006-plan-a", {
            kind: "modified",
            path: "/workspace/repo/plans/261006-plan-a/progress.md",
            targetRelativePath: "plans/261006-plan-a/progress.md",
          });
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(harness.result.selectedPlanData?.plan.title).toBe(
          "Replacement root edit",
        );
        expect(harness.result.coverage.status).toBe("live");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("covers a known missing plans root via its parent and installs the directory when created", async () => {
    vi.useFakeTimers();
    try {
      let snapshot: PlanFoldersResponse = {
        ...mockFoldersData,
        folderState: "missing",
        folders: [],
        watchPaths: ["."],
        listing: { ...mockFoldersData.listing, entriesVisited: 0 },
      };
      let plansExists = false;
      vi.mocked(mockClient.plans.folders).mockImplementation(
        async () => snapshot,
      );
      const subscribe = mockTransport.fsSubscribeTree;
      mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
        if (path === "plans" && !plansExists)
          throw new Error("directory absent");
        return subscribe(target, path, opts);
      });
      const options = {
        owner: mockOwner,
        target: mockTarget,
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(harness.result.foldersData?.folderState).toBe("missing");
      expect(harness.result.coverage.status).toBe("live");
      expect(eventCallbacks.size).toBe(1);
      const attemptsBefore = vi
        .mocked(mockTransport.fsSubscribeTree)
        .mock.calls.filter(([, path]) => path === "plans").length;
      await act(async () => {
        await harness.result.refresh();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        vi
          .mocked(mockTransport.fsSubscribeTree)
          .mock.calls.filter(([, path]) => path === "plans"),
      ).toHaveLength(attemptsBefore);
      expect(harness.result.coverage.status).toBe("live");

      plansExists = true;
      snapshot = mockFoldersData;
      await act(async () => {
        emitForPath(".", { kind: "created", path: "/workspace/plans" });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.foldersData?.folderState).toBe("present");
      expect(harness.result.coverage.status).toBe("live");
      expect(
        Array.from(eventCallbacks.keys()).some(
          (id) => watchPathsById.get(id) === "plans",
        ),
      ).toBe(true);
      snapshot = { ...mockFoldersData, folders: [] };
      await act(async () => {
        emitForPath("plans", {
          kind: "modified",
          path: "/workspace/plans/progress.md",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.foldersData?.folders).toEqual([]);
      expect(harness.result.coverage.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
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

  it("keeps separated, fully settled saves fresh without exhausting a lifetime churn allowance", async () => {
    vi.useFakeTimers();
    try {
      let folders = mockFoldersData;
      vi.mocked(mockClient.plans.folders).mockImplementation(
        async () => folders,
      );
      const options = {
        owner: mockOwner,
        target: mockTarget,
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      for (let save = 1; save <= 6; save += 1) {
        folders = {
          ...mockFoldersData,
          folders: [{ path: `plans/save-${save}`, name: `save-${save}` }],
          listing: { ...mockFoldersData.listing, entriesVisited: 1 },
        };
        await act(async () => {
          emitForPath("plans", {
            kind: "modified",
            path: "/workspace/plans/progress.md",
          });
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(harness.result.foldersData?.folders[0].name).toBe(
          `save-${save}`,
        );
        expect(harness.result.coverage.status).toBe("live");
      }
      expect(subscribedPaths).toEqual([".", "plans"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds consecutive unsettled passes and manual refresh resumes actual watching", async () => {
    vi.useFakeTimers();
    try {
      const options = {
        owner: mockOwner,
        target: mockTarget,
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const pendingReads: Array<PromiseWithResolvers<PlanFoldersResponse>> = [];
      vi.mocked(mockClient.plans.folders).mockImplementation(() => {
        const deferred = Promise.withResolvers<PlanFoldersResponse>();
        pendingReads.push(deferred);
        return deferred.promise;
      });
      await act(async () => {
        emitForPath("plans", {
          kind: "modified",
          path: "/workspace/plans/progress.md",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      for (let pass = 0; pass < 3; pass += 1) {
        expect(pendingReads.length).toBe(pass + 1);
        await act(async () => {
          emitForPath("plans", {
            kind: "modified",
            path: "/workspace/plans/progress.md",
          });
          pendingReads[pass].resolve(mockFoldersData);
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      expect(harness.result.coverage.status).toBe("degraded");
      expect(harness.result.coverage.reason).toContain(
        "Excessive filesystem churn",
      );

      vi.mocked(mockClient.plans.folders).mockResolvedValue(mockFoldersData);
      await act(async () => {
        await harness.result.refresh();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(harness.result.coverage.status).toBe("live");

      const updated = { ...mockFoldersData, folders: [] };
      vi.mocked(mockClient.plans.folders).mockResolvedValue(updated);
      await act(async () => {
        emitForPath("plans", {
          kind: "modified",
          path: "/workspace/plans/progress.md",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.foldersData?.folders).toEqual([]);
      expect(harness.result.coverage.status).toBe("live");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      kind: "renamed",
      path: "/workspace/retired",
      from: "/workspace/plans/group",
    },
    {
      kind: "renamed",
      path: "/workspace/plans/group",
      from: "/workspace/replacement",
    },
    { kind: "removed", path: "/workspace/plans/group" },
    { kind: "created", path: "/workspace/plans/group" },
  ])(
    "rebinds replaced descendants after $kind even when the listing is identical",
    async (event) => {
      vi.useFakeTimers();
      try {
        let listing: PlanFoldersResponse = {
          ...mockFoldersData,
          path: "plans/group",
          folders: [{ path: "plans/group/a", name: "a" }],
          listing: { ...mockFoldersData.listing, entriesVisited: 1 },
          watchPaths: [".", "plans", "plans/group"],
        };
        vi.mocked(mockClient.plans.folders).mockImplementation(
          async () => listing,
        );
        const options = {
          owner: mockOwner,
          target: mockTarget,
          browsePath: "plans/group",
          client: mockClient,
          transport: mockTransport,
        };
        const harness = renderHookHelper(options);
        await harness.render(options);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const originalData = harness.result.foldersData;
        const oldId = Array.from(eventCallbacks.keys()).find(
          (id) => watchPathsById.get(id) === "plans/group",
        )!;
        const readsBefore = vi.mocked(mockClient.plans.folders).mock.calls
          .length;

        await act(async () => {
          emitForPath("plans", event);
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(harness.result.foldersData).toBe(originalData);
        expect(unsubscribedIds).toContain(oldId);
        expect(eventCallbacks.has(oldId)).toBe(false);
        expect(overflowCallbacks.has(oldId)).toBe(false);
        expect(
          vi.mocked(mockClient.plans.folders).mock.calls.length,
        ).toBeGreaterThan(readsBefore);
        expect(harness.result.coverage.status).toBe("live");
        const replacementId = Array.from(eventCallbacks.keys()).find(
          (id) => watchPathsById.get(id) === "plans/group",
        )!;
        expect(replacementId).not.toBe(oldId);

        listing = {
          ...listing,
          folders: [...listing.folders, { path: "plans/group/b", name: "b" }],
          listing: { ...listing.listing, entriesVisited: 2 },
        };
        await act(async () => {
          eventCallbacks.get(replacementId)!({
            kind: "created",
            path: "/workspace/plans/group/b",
          });
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(
          harness.result.foldersData?.folders.map((folder) => folder.name),
        ).toEqual(["a", "b"]);
        expect(harness.result.coverage.status).toBe("live");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("manual recovery retries failed required handles and does not claim live while failure persists", async () => {
    const subscribe = mockTransport.fsSubscribeTree;
    let failPlans = true;
    mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
      if (path === "plans" && failPlans)
        throw new Error("transient watch failure");
      return subscribe(target, path, opts);
    });
    const options = {
      owner: mockOwner,
      target: mockTarget,
      client: mockClient,
      transport: mockTransport,
    };
    const harness = renderHookHelper(options);
    await harness.render(options);
    expect(harness.result.coverage.status).toBe("degraded");
    expect(harness.result.coverage.failedWatchPaths).toEqual(["plans"]);

    await act(async () => {
      await harness.result.refresh();
    });
    expect(harness.result.coverage.status).toBe("degraded");
    expect(harness.result.coverage.failedWatchPaths).toEqual(["plans"]);
    failPlans = false;
    await act(async () => {
      await harness.result.refresh();
    });
    expect(harness.result.coverage.status).toBe("live");
    expect(
      Array.from(eventCallbacks.keys()).some(
        (id) => watchPathsById.get(id) === "plans",
      ),
    ).toBe(true);

    const updated = { ...mockFoldersData, folders: [] };
    vi.mocked(mockClient.plans.folders).mockResolvedValue(updated);
    vi.useFakeTimers();
    try {
      await act(async () => {
        emitForPath("plans", {
          kind: "modified",
          path: "/workspace/plans/progress.md",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(harness.result.foldersData?.folders).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes overflow during pending setup and retires every exact subscription and listener", async () => {
    const pendingPlans = Promise.withResolvers<{ sub_id: number }>();
    const subscribe = mockTransport.fsSubscribeTree;
    mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
      if (path === "plans") {
        subscribedPaths.push(path);
        watchPathsById.set(900, path);
        return pendingPlans.promise;
      }
      return subscribe(target, path, opts);
    });
    const options = {
      owner: mockOwner,
      target: mockTarget,
      client: mockClient,
      transport: mockTransport,
    };
    const harness = renderHookHelper(options);
    await harness.render(options);
    const rootId = Array.from(overflowCallbacks.keys())[0];
    expect(harness.result.coverage.status).toBe("reconciling");
    await act(async () => {
      overflowCallbacks.get(rootId)!("queue full");
    });
    expect(subscribedPaths.filter((path) => path === "plans")).toHaveLength(1);

    await act(async () => {
      pendingPlans.resolve({ sub_id: 900 });
    });
    expect(harness.result.coverage.status).toBe("live");
    expect(subscribedPaths.filter((path) => path === "plans")).toHaveLength(1);
    expect(eventCallbacks.size).toBe(2);
    expect(overflowCallbacks.size).toBe(2);
    await act(async () => {
      root.unmount();
    });
    expect(unsubscribedIds.sort()).toEqual(
      Array.from(watchPathsById.keys()).sort(),
    );
    expect(new Set(unsubscribedIds).size).toBe(unsubscribedIds.length);
    expect(eventCallbacks.size).toBe(0);
    expect(overflowCallbacks.size).toBe(0);
  });

  it("retires a replaced directory registration that completes late and refetches after its replacement installs", async () => {
    vi.useFakeTimers();
    try {
      const pendingGroup = Promise.withResolvers<{ sub_id: number }>();
      let listing: PlanFoldersResponse = {
        ...mockFoldersData,
        path: "plans/group",
        watchPaths: [".", "plans", "plans/group"],
      };
      vi.mocked(mockClient.plans.folders).mockImplementation(
        async () => listing,
      );
      const subscribe = mockTransport.fsSubscribeTree;
      let firstGroup = true;
      mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
        if (path === "plans/group" && firstGroup) {
          firstGroup = false;
          subscribedPaths.push(path);
          watchPathsById.set(901, path);
          return pendingGroup.promise;
        }
        return subscribe(target, path, opts);
      });
      const options = {
        owner: mockOwner,
        target: mockTarget,
        browsePath: "plans/group",
        client: mockClient,
        transport: mockTransport,
      };
      const harness = renderHookHelper(options);
      await harness.render(options);
      await act(async () => {
        emitForPath("plans", {
          kind: "renamed",
          path: "/workspace/plans/group",
          from: "/workspace/replacement",
        });
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(
        subscribedPaths.filter((path) => path === "plans/group"),
      ).toHaveLength(1);

      listing = {
        ...listing,
        folders: [{ path: "plans/group/new", name: "new" }],
      };
      await act(async () => {
        pendingGroup.resolve({ sub_id: 901 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(unsubscribedIds).toContain(901);
      expect(eventCallbacks.has(901)).toBe(false);
      expect(overflowCallbacks.has(901)).toBe(false);
      expect(
        subscribedPaths.filter((path) => path === "plans/group"),
      ).toHaveLength(2);
      expect(harness.result.coverage.status).toBe("live");
      expect(harness.result.foldersData?.folders[0].name).toBe("new");
      await act(async () => {
        root.unmount();
      });
      expect(unsubscribedIds.sort()).toEqual(
        Array.from(watchPathsById.keys()).sort(),
      );
      expect(eventCallbacks.size).toBe(0);
      expect(overflowCallbacks.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects late generation setup on its owning transport without publishing stale coverage", async () => {
    const pendingPlans = Promise.withResolvers<{ sub_id: number }>();
    const subscribe = mockTransport.fsSubscribeTree;
    mockTransport.fsSubscribeTree = vi.fn(async (target, path, opts) => {
      if (path === "plans") return pendingPlans.promise;
      return subscribe(target, path, opts);
    });
    const options = {
      owner: mockOwner,
      target: mockTarget,
      client: mockClient,
      transport: mockTransport,
    };
    const harness = renderHookHelper(options);
    await harness.render(options);
    const oldIds = Array.from(eventCallbacks.keys());
    const replacementOwner = { ...mockOwner, generation: 2 };
    const replacementUnsubscribe = vi.fn();
    const replacementTransport = {
      ...mockTransport,
      fsSubscribeTree: vi.fn(async () => ({ sub_id: ++activeSubIdCounter })),
      fsUnsubscribeTree: replacementUnsubscribe,
    };
    __setConnectionSnapshotForTests(mockOwner.profileId, {
      owner: replacementOwner,
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
      transport: replacementTransport,
      api: mockClient,
    });
    await harness.render({
      ...options,
      owner: replacementOwner,
      transport: replacementTransport,
    });
    expect(harness.result.coverage.status).toBe("live");
    await act(async () => {
      pendingPlans.resolve({ sub_id: 999 });
    });
    expect(harness.result.coverage.status).toBe("live");
    expect(unsubscribedIds).toEqual(expect.arrayContaining([...oldIds, 999]));
    expect(replacementUnsubscribe).not.toHaveBeenCalledWith(999);
    expect(eventCallbacks.has(999)).toBe(false);
    expect(oldIds.every((id) => !eventCallbacks.has(id))).toBe(true);
    await act(async () => {
      root.unmount();
    });
    expect(eventCallbacks.size).toBe(0);
    expect(overflowCallbacks.size).toBe(0);
  });

  it("reports all uncovered requirements when a deep plan and external document exceed the watch cap", async () => {
    const parts = [
      "plans",
      ...Array.from({ length: 31 }, (_, index) => `level-${index}`),
    ];
    const planPath = parts.join("/");
    const watchPaths = [
      ".",
      ...parts.map((_, index) => parts.slice(0, index + 1).join("/")),
    ];
    vi.mocked(mockClient.plans.read).mockResolvedValue({
      ...mockPlanData,
      plan: { ...mockPlanData.plan, id: planPath },
      watchPaths,
    });
    const options = {
      owner: mockOwner,
      target: mockTarget,
      selectedPlanPath: planPath,
      selectedDocumentPath: "evidence/nested/notes.md",
      client: mockClient,
      transport: mockTransport,
    };
    const harness = renderHookHelper(options);
    await harness.render(options);
    expect(harness.result.coverage.status).toBe("degraded");
    expect(harness.result.coverage.reason).toContain("exceed limit 33");
    expect(harness.result.coverage.failedWatchPaths).toEqual([
      "evidence",
      "evidence/nested",
    ]);
    expect(eventCallbacks.size).toBe(33);
    await act(async () => {
      await harness.result.refresh();
    });
    expect(harness.result.coverage.status).toBe("degraded");
    expect(harness.result.coverage.failedWatchPaths).toEqual([
      "evidence",
      "evidence/nested",
    ]);
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
