import type * as QueriesModule from "@/api/queries.js";
// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Branch, GitLogEntry, ProjectTargetRef, VcsRoot } from "@/api/client.js";
import {
  useGitHistoryView,
  type GitHistoryViewResult,
} from "./use-git-history-view.js";
import {
  resetGitHistoryStore,
  useGitHistoryStore,
} from "@/stores/git-history.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
const branchesMock = vi.fn();
const rootsMock = vi.fn();

vi.mock("@/api/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGitRoots: (_target: unknown) => rootsMock(),
    useBranches: (_target: unknown, _root?: string) => branchesMock(),
  };
});

let root: Root | null = null;
let currentHook: GitHistoryViewResult | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let queryClient: QueryClient;

const sampleBranches: Branch[] = [
  {
    name: "main",
    isCurrent: true,
    isRemote: false,
    lastCommit: "commit-main-sha",
  },
  {
    name: "feature/auth",
    isCurrent: false,
    isRemote: false,
    lastCommit: "commit-feature-sha",
  },
];

const sampleRoots: VcsRoot[] = [
  {
    rootId: ".",
    path: ".",
    absolutePath: "/repo",
    kind: "primary",
    warnings: [],
  },
];

const sampleLogs: GitLogEntry[] = [
  {
    hash: "commit-main-sha",
    parents: [],
    authorName: "Dev",
    authorEmail: "dev@example.com",
    timestamp: 1727800000,
    message: "feat: main commit",
    refs: ["HEAD -> main"],
    isPushed: true,
  },
];

function TestHarness({
  target,
  available = true,
}: {
  target: ProjectTargetRef;
  available?: boolean;
}) {
  const hook = useGitHistoryView(target, { available });
  currentHook = hook;
  return null;
}

async function mount(target: ProjectTargetRef, available = true) {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <TestHarness target={target} available={available} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  currentHook = null;
  resetGitHistoryStore();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  branchesMock.mockReturnValue({
    data: sampleBranches,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  });

  rootsMock.mockReturnValue({
    data: sampleRoots,
    isSuccess: true,
  });
  __setConnectionSnapshotForTests("server-1", {
    owner: { profileId: "server-1", generation: 1 },
    status: "connected",
    api: null,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  resetConnections();
});
describe("useGitHistoryView", () => {
  const defaultTarget: ProjectTargetRef = {
    profileId: "server-1",
    project: "my-repo",
  };

  it("initializes with default follow-active mode tracking active branch", async () => {
    await mount(defaultTarget);

    expect(currentHook).not.toBeNull();
    expect(currentHook?.rootId).toBe(".");
    expect(currentHook?.followActive).toBe(true);
    expect(currentHook?.activeBranch).toBe("main");
    expect(currentHook?.branchRef).toBe("refs/heads/main");
    expect(currentHook?.isViewingActiveBranch).toBe(true);
    expect(currentHook?.page).toBe(0);
    expect(currentHook?.isFiltered).toBe(false);
  });

  it("gates log query and stays resolving when pinned branch is awaiting discovery", async () => {
    useGitHistoryStore.getState().setBranchPreference(
      defaultTarget,
      { mode: "pinned", ref: "refs/heads/feature/pending" },
      ".",
    );

    // Branches not yet discovered
    branchesMock.mockReturnValue({
      data: [],
      isSuccess: false,
      isFetching: true,
    });

    await mount(defaultTarget);

    expect(currentHook?.followActive).toBe(false);
    expect(currentHook?.branchRef).toBe("refs/heads/feature/pending");
    // Awaiting discovery: isLoading is true, no unfiltered HEAD read
    expect(currentHook?.isLoading).toBe(true);
  });

  it("explicitly pins branch and survives active branch checkout changes", async () => {
    await mount(defaultTarget);

    // Explicitly pin main
    act(() => {
      currentHook?.selectBranchRef("refs/heads/main");
    });

    expect(currentHook?.followActive).toBe(false);
    expect(currentHook?.branchRef).toBe("refs/heads/main");

    // Checkout changes in repo: feature/auth becomes active
    const updatedBranches: Branch[] = [
      {
        name: "main",
        isCurrent: false,
        isRemote: false,
        lastCommit: "commit-main-sha",
      },
      {
        name: "feature/auth",
        isCurrent: true,
        isRemote: false,
        lastCommit: "commit-feature-sha",
      },
    ];
    branchesMock.mockReturnValue({
      data: updatedBranches,
      isSuccess: true,
      isFetching: false,
    });

    await mount(defaultTarget);

    // Pinned branch remains main!
    expect(currentHook?.branchRef).toBe("refs/heads/main");
    expect(currentHook?.activeBranch).toBe("feature/auth");
    expect(currentHook?.isViewingActiveBranch).toBe(false);
    expect(currentHook?.followActive).toBe(false);
  });

  it("returns to tracking checked-out branch when followCheckedOutBranch is called", async () => {
    useGitHistoryStore.getState().setBranchPreference(
      defaultTarget,
      { mode: "pinned", ref: "refs/heads/feature/auth" },
      ".",
    );

    await mount(defaultTarget);
    expect(currentHook?.followActive).toBe(false);

    act(() => {
      currentHook?.followCheckedOutBranch();
    });

    expect(currentHook?.followActive).toBe(true);
    expect(currentHook?.branchRef).toBe("refs/heads/main");
    expect(currentHook?.isViewingActiveBranch).toBe(true);
  });

  it("reconciles missing pinned branch after completed discovery and sets notice", async () => {
    useGitHistoryStore.getState().setBranchPreference(
      defaultTarget,
      { mode: "pinned", ref: "refs/heads/nonexistent" },
      ".",
    );

    await mount(defaultTarget);

    // Authoritative discovery omits pinned ref
    expect(currentHook?.notice).toContain("Pinned branch \"refs/heads/nonexistent\" was not found");
    expect(currentHook?.followActive).toBe(true);
  });

  it("debounces search text input and clears atomically", async () => {
    await mount(defaultTarget);

    act(() => {
      currentHook?.setSearchText("search term");
    });

    expect(currentHook?.searchText).toBe("search term");
    expect(currentHook?.appliedMessageQuery).toBeUndefined();
    expect(currentHook?.isFiltered).toBe(false);

    // Advance timer by 300 ms
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(currentHook?.appliedMessageQuery).toBe("search term");
    expect(currentHook?.isFiltered).toBe(true);

    // Clear search
    act(() => {
      currentHook?.clearSearch();
    });

    expect(currentHook?.searchText).toBe("");
    expect(currentHook?.appliedMessageQuery).toBeUndefined();
    expect(currentHook?.isFiltered).toBe(false);
  });

  it("resets page and selected commit on applied query change", async () => {
    await mount(defaultTarget);

    act(() => {
      currentHook?.selectCommit(sampleLogs[0]);
    });
    expect(currentHook?.selectedCommit).not.toBeNull();

    act(() => {
      currentHook?.setSearchText("new filter");
      vi.advanceTimersByTime(300);
    });

    expect(currentHook?.page).toBe(0);
    expect(currentHook?.selectedCommit).toBeNull();
  });

  it("resets transient state when switching target scope", async () => {
    await mount(defaultTarget);

    act(() => {
      currentHook?.setSearchText("active search");
      vi.advanceTimersByTime(300);
      currentHook?.selectCommit(sampleLogs[0]);
    });

    // Switch project
    const otherTarget: ProjectTargetRef = {
      profileId: "server-1",
      project: "other-repo",
    };
    await mount(otherTarget);

    expect(currentHook?.searchText).toBe("");
    expect(currentHook?.appliedMessageQuery).toBeUndefined();
    expect(currentHook?.selectedCommit).toBeNull();
    expect(currentHook?.page).toBe(0);
  });

  it("gates availability on hydration readiness and transitions cleanly when hydrated", async () => {
    act(() => {
      useGitHistoryStore.setState({ isHydrated: false });
    });

    await mount(defaultTarget);
    expect(currentHook?.availability.isAvailable).toBe(false);
    expect(currentHook?.availability.reason).toBe("Restoring history preferences...");

    act(() => {
      useGitHistoryStore.getState().markHydrated();
    });

    expect(currentHook?.availability.isAvailable).toBe(true);
    expect(currentHook?.availability.reason).toBeUndefined();
  });

  it("marks active local branch and pinned inactive local branch eligible for squashing", async () => {
    // 1. Active local branch (main)
    await mount(defaultTarget);
    expect(currentHook?.isViewingLocalBranch).toBe(true);
    expect(currentHook?.isViewingActiveBranch).toBe(true);
    expect(currentHook?.squashAvailable).toBe(true);
    expect(currentHook?.squashUnavailableReason).toBeUndefined();

    // 2. Pinned inactive local branch (feature/auth)
    act(() => {
      currentHook?.selectBranchRef("refs/heads/feature/auth");
    });
    expect(currentHook?.branchRef).toBe("refs/heads/feature/auth");
    expect(currentHook?.isViewingLocalBranch).toBe(true);
    expect(currentHook?.isViewingActiveBranch).toBe(false);
    expect(currentHook?.squashAvailable).toBe(true);
    expect(currentHook?.squashUnavailableReason).toBeUndefined();
  });

  it("disables squash when viewing a pinned remote branch even with matching label", async () => {
    const branchesWithRemote: Branch[] = [
      ...sampleBranches,
      {
        name: "origin/feature/auth",
        isCurrent: false,
        isRemote: true,
        lastCommit: "commit-remote-sha",
      },
    ];
    branchesMock.mockReturnValue({
      data: branchesWithRemote,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    });

    useGitHistoryStore.getState().setBranchPreference(
      defaultTarget,
      { mode: "pinned", ref: "refs/remotes/origin/feature/auth" },
      ".",
    );

    await mount(defaultTarget);
    expect(currentHook?.branchRef).toBe("refs/remotes/origin/feature/auth");
    expect(currentHook?.isViewingLocalBranch).toBe(false);
    expect(currentHook?.squashAvailable).toBe(false);
    expect(currentHook?.squashUnavailableReason).toBe("Squash requires a local branch.");
  });

  it("disables squash on detached HEAD default view and enables when explicitly pinning local branch", async () => {
    // Detached HEAD: no branch has isCurrent: true
    const detachedBranches: Branch[] = [
      {
        name: "main",
        isCurrent: false,
        isRemote: false,
        lastCommit: "commit-main-sha",
      },
    ];
    branchesMock.mockReturnValue({
      data: detachedBranches,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    });

    // Default follow-active view with detached HEAD
    await mount(defaultTarget);
    expect(currentHook?.activeBranch).toBe("");
    expect(currentHook?.isViewingLocalBranch).toBe(false);
    expect(currentHook?.squashAvailable).toBe(false);
    expect(currentHook?.squashUnavailableReason).toBe("Squash requires a local branch.");

    // Explicit pinned local branch while HEAD is detached is eligible
    act(() => {
      currentHook?.selectBranchRef("refs/heads/main");
    });
    expect(currentHook?.branchRef).toBe("refs/heads/main");
    expect(currentHook?.isViewingLocalBranch).toBe(true);
    expect(currentHook?.squashAvailable).toBe(true);
    expect(currentHook?.squashUnavailableReason).toBeUndefined();
  });

  it("blocks squash availability during discovery, missing root, or disconnected profile", async () => {
    // Disconnected profile
    __setConnectionSnapshotForTests("server-1", {
      owner: { profileId: "server-1", generation: 1 },
      status: "disconnected",
      api: null,
    });
    await mount(defaultTarget);
    expect(currentHook?.squashAvailable).toBe(false);
    expect(currentHook?.squashUnavailableReason).toBe("Connect the selected profile before squashing history.");

    // Restore connection
    __setConnectionSnapshotForTests("server-1", {
      owner: { profileId: "server-1", generation: 1 },
      status: "connected",
      api: null,
    });

    // Discovery in progress
    branchesMock.mockReturnValue({
      data: [],
      isSuccess: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    await mount(defaultTarget);
    expect(currentHook?.squashAvailable).toBe(false);
    expect(currentHook?.squashUnavailableReason).toBe("Waiting for available root and local branch discovery.");

    // Missing root
    branchesMock.mockReturnValue({
      data: sampleBranches,
      isSuccess: true,
      isFetching: false,
      refetch: vi.fn(),
    });
    rootsMock.mockReturnValue({
      data: [{ rootId: "other-root", path: "other", absolutePath: "/other", kind: "primary", warnings: [] }],
      isSuccess: true,
    });
    await mount(defaultTarget);
    expect(currentHook?.squashAvailable).toBe(false);
    expect(currentHook?.squashUnavailableReason).toBe("Waiting for available root and local branch discovery.");
  });
});
