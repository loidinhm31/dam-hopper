// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Worktree } from "@/api/client.js";
import { useAddWorktree } from "@/api/queries.js";
import type { Transport } from "@/api/transport.js";
import { installTransportBridge } from "@/hooks/use-sse.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import { TraditionalTerminalWorktreeSelect } from "./TraditionalTerminalWorktreeSelect.js";

const mainWorktree: Worktree = {
  path: "/repos/demo/main",
  repositoryPath: "/repos/demo/.git",
  branch: "main",
  commitHash: "1111111",
  isMain: true,
  isLocked: false,
  isDetached: false,
  isBare: false,
  isPrunable: false,
  isAvailable: true,
};

const newFeatureWorktree: Worktree = {
  path: "/repos/demo/wt-feat",
  repositoryPath: "/repos/demo/.git",
  branch: "feature/login",
  commitHash: "2222222",
  isMain: false,
  isLocked: false,
  isDetached: false,
  isBare: false,
  isPrunable: false,
  isAvailable: true,
};

const profileBWorktree: Worktree = {
  path: "/repos-b/demo/main",
  repositoryPath: "/repos-b/demo/.git",
  branch: "main-b",
  commitHash: "bbbbbbb",
  isMain: true,
  isLocked: false,
  isDetached: false,
  isBare: false,
  isPrunable: false,
  isAvailable: true,
};

let storeByProfileAndProject: Record<string, Worktree[]>;
let transportMock: Mock;

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    invoke: transportMock,
  }),
}));

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: () => true,
  getConnectionSnapshot: (profileId: string) => ({
    owner: { profileId, generation: 1 },
    status: "connected",
  }),
  getApi: () => api,
  getTransport: () => ({
    invoke: transportMock,
  }),
}));

describe("TraditionalTerminalWorktreeSelect dynamic update regression tests", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 0,
        },
      },
    });

    storeByProfileAndProject = {
      "p1:demo": [mainWorktree],
      "p2:demo": [profileBWorktree],
      "ambient:demo": [mainWorktree],
    };

    transportMock = vi.fn(async (channel: string, payload: unknown) => {
      if (channel === "git:worktrees") {
        const project = payload as string;
        // Default to p1:demo if profile context is p1 or ambient
        return storeByProfileAndProject[`p1:${project}`] ?? [mainWorktree];
      }
      if (channel === "git:addWorktree") {
        const data = payload as {
          project: string;
          options: { path: string; branch: string; createBranch?: boolean };
        };
        const key = `p1:${data.project}`;
        const created: Worktree = {
          path: data.options.path,
          repositoryPath: "/repos/demo/.git",
          branch: data.options.branch,
          commitHash: "9999999",
          isMain: false,
          isLocked: false,
          isDetached: false,
          isBare: false,
          isPrunable: false,
          isAvailable: true,
        };
        if (storeByProfileAndProject[key]) {
          storeByProfileAndProject[key] = [...storeByProfileAndProject[key], created];
        }
        return created;
      }
      return undefined;
    });

    useProjectTargetStore.getState().resetTarget("demo");
    useProjectTargetStore.getState().resetTarget({ profileId: "p1", project: "demo" });
    useProjectTargetStore.getState().resetTarget({ profileId: "p2", project: "demo" });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("updates worktree list dynamically when a worktree is created via useAddWorktree without page reload", async () => {
    function TestHarness() {
      const addMutation = useAddWorktree({ profileId: "p1", project: "demo" });
      return (
        <div>
          <button
            type="button"
            data-testid="add-btn"
            onClick={() => {
              addMutation.mutate({
                path: "/repos/demo/wt-feat",
                branch: "feature/login",
              });
            }}
          >
            Add
          </button>
          <TraditionalTerminalWorktreeSelect
            projectName="demo"
            profileId="p1"
            projectRef={{ profileId: "p1", project: "demo" }}
          />
        </div>
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toBe("Worktree for demo: root");

    // Initially, store only has mainWorktree
    expect(storeByProfileAndProject["p1:demo"]).toHaveLength(1);

    // Simulate adding a worktree in the "Projects" panel (via useAddWorktree)
    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="add-btn"]')!;
    await act(async () => {
      addBtn.click();
    });

    // Verify backend store updated
    await vi.waitFor(() => {
      expect(storeByProfileAndProject["p1:demo"]).toHaveLength(2);
    });

    // Assert that the mounted selector's query cache receives the new worktree BEFORE opening
    await vi.waitFor(() => {
      const cached = queryClient.getQueryData<Worktree[]>([
        "profile",
        "p1",
        1,
        "git",
        "worktrees",
        "demo",
      ]);
      expect(cached).toHaveLength(2);
      expect(cached?.some((w) => w.branch === "feature/login")).toBe(true);
    });

    // Open combobox without remounting or page reload
    await act(async () => {
      trigger.click();
    });
    // Assert the newly created worktree option is rendered in the listbox
    await vi.waitFor(() => {
      const option = document.querySelector('[role="option"][aria-label*="feature/login"]');
      expect(option).not.toBeNull();
      expect(option?.textContent).toContain("feature/login");
      expect(option?.textContent).toContain("wt-feat");
    });
  });

  it("refetches when opened if worktree was created externally", async () => {
    function TestHarness() {
      return (
        <TraditionalTerminalWorktreeSelect
          projectName="demo"
          profileId="p1"
          projectRef={{ profileId: "p1", project: "demo" }}
        />
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;

    // External creation outside UI (e.g. git worktree add via terminal)
    storeByProfileAndProject["p1:demo"] = [mainWorktree, newFeatureWorktree];

    // Clicking trigger opens and triggers refetch
    await act(async () => {
      trigger.click();
    });

    await vi.waitFor(() => {
      const option = document.querySelector('[role="option"][aria-label*="feature/login"]');
      expect(option).not.toBeNull();
      expect(option?.textContent).toContain("feature/login");
    });
  });

  it("distinguishes loading from empty before initial fetch completes", async () => {
    const { promise, resolve } = Promise.withResolvers<Worktree[]>();
    transportMock.mockImplementationOnce(() => promise);

    function TestHarness() {
      return (
        <TraditionalTerminalWorktreeSelect
          projectName="demo"
          profileId="p1"
          projectRef={{ profileId: "p1", project: "demo" }}
        />
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;

    // Open immediately before initial fetch resolves
    await act(async () => {
      trigger.click();
    });

    // While fetching and not yet fetched, must show "Loading worktrees…" NOT "No secondary worktrees"
    expect(document.body.textContent).toContain("Loading worktrees…");
    expect(document.body.textContent).not.toContain("No secondary worktrees");

    // Now resolve the delayed query
    await act(async () => {
      resolve([mainWorktree]);
    });

    // After resolution with no secondaries, shows "No secondary worktrees"
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No secondary worktrees");
    });
  });

  it("preserves profile isolation so mutations on profile A do not invalidate profile B for the same project name", async () => {

    // Pre-populate queries in cache for p1, p2, and ambient
    queryClient.setQueryData(
      ["profile", "p1", 1, "git", "worktrees", "demo"],
      [mainWorktree],
    );
    queryClient.setQueryData(
      ["profile", "p2", 1, "git", "worktrees", "demo"],
      [profileBWorktree],
    );
    queryClient.setQueryData(
      ["worktrees", "demo"],
      [mainWorktree],
    );
    function TestHarness() {
      const addMut = useAddWorktree({ profileId: "p1", project: "demo" });
      return (
        <div>
          <button
            type="button"
            data-testid="add-p1-btn"
            onClick={() => {
              addMut.mutate({
                path: "/repos/demo/wt-feat",
                branch: "feature/login",
              });
            }}
          >
            Add P1
          </button>
        </div>
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    const addBtn = container.querySelector<HTMLButtonElement>('[data-testid="add-p1-btn"]')!;
    await act(async () => {
      addBtn.click();
    });

    await vi.waitFor(() => {
      expect(storeByProfileAndProject["p1:demo"]).toHaveLength(2);
    });

    // Profile p1 query is invalidated
    const queryP1 = queryClient.getQueryCache().find({
      queryKey: ["profile", "p1", 1, "git", "worktrees", "demo"],
    });
    expect(queryP1?.state.isInvalidated).toBe(true);

    // Profile p2 query is strictly isolated and NOT invalidated
    const queryP2 = queryClient.getQueryCache().find({
      queryKey: ["profile", "p2", 1, "git", "worktrees", "demo"],
    });
    expect(queryP2?.state.isInvalidated).toBe(false);
    expect(queryClient.getQueryData(["profile", "p2", 1, "git", "worktrees", "demo"])).toEqual([profileBWorktree]);

    // Ambient query for another owner is also NOT invalidated
    const queryAmbient = queryClient.getQueryCache().find({
      queryKey: ["worktrees", "demo"],
    });
    expect(queryAmbient?.state.isInvalidated).toBe(false);
  });

  it("invalidates and updates worktree list when backend pushes worktree:changed push event", async () => {
    let pushHandler: ((data: unknown) => void) | null = null;
    const fakeTransport = {
      onEvent: (channel: string, cb: (data: unknown) => void) => {
        if (channel === "worktree:changed") {
          pushHandler = cb;
        }
        return () => {};
      },
    } as unknown as Transport;

    const cleanupBridge = installTransportBridge(
      { profileId: "p1", generation: 1 },
      fakeTransport,
      queryClient,
    );

    function TestHarness() {
      return (
        <TraditionalTerminalWorktreeSelect
          projectName="demo"
          profileId="p1"
          projectRef={{ profileId: "p1", project: "demo" }}
        />
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    // Initial load populated mainWorktree
    await vi.waitFor(() => {
      expect(
        queryClient.getQueryData<Worktree[]>([
          "profile",
          "p1",
          1,
          "git",
          "worktrees",
          "demo",
        ]),
      ).toHaveLength(1);
    });

    // Remote client or server background task creates a worktree
    storeByProfileAndProject["p1:demo"] = [mainWorktree, newFeatureWorktree];

    // Server broadcasts worktree:changed push event over persistent connection
    await act(async () => {
      pushHandler?.({ projectName: "demo" });
    });

    // Query cache receives the new worktree before opening
    await vi.waitFor(() => {
      const cached = queryClient.getQueryData<Worktree[]>([
        "profile",
        "p1",
        1,
        "git",
        "worktrees",
        "demo",
      ]);
      expect(cached).toHaveLength(2);
      expect(cached?.some((w) => w.branch === "feature/login")).toBe(true);
    });

    cleanupBridge();
  });

  it("strictly does not poll periodically when closed or open", async () => {
    vi.useFakeTimers();

    function TestHarness() {
      return (
        <TraditionalTerminalWorktreeSelect
          projectName="demo"
          profileId="p1"
          projectRef={{ profileId: "p1", project: "demo" }}
        />
      );
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestHarness />
        </QueryClientProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger).not.toBeNull();

    // Initial mount invokes git:worktrees once
    expect(transportMock).toHaveBeenCalledWith("git:worktrees", "demo");
    const initialCalls = transportMock.mock.calls.length;

    // Advance fake timers by 30 seconds while closed
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // Must NOT have made any periodic polling requests while closed
    expect(transportMock.mock.calls.length).toBe(initialCalls);

    // Open combobox
    await act(async () => {
      trigger.click();
    });

    // Opening triggers the explicit on-open refetch
    const openCalls = transportMock.mock.calls.length;
    expect(openCalls).toBe(initialCalls + 1);

    // Advance fake timers by 30 seconds while open
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // Must NOT have made any interval polling requests while open
    expect(transportMock.mock.calls.length).toBe(openCalls);

    vi.useRealTimers();
  });
});
