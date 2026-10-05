// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitPage } from "./GitPage.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import {
  resetGitHistoryStore,
  useGitHistoryStore,
} from "@/stores/git-history.js";
import { projectKey } from "@/api/ownership.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import type * as QueriesModule from "@/api/queries.js";

const mockGitFetchMutate = vi
  .fn()
  .mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockGitPullMutate = vi
  .fn()
  .mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockGitPushMutate = vi
  .fn()
  .mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockUseProjectStatus = vi
  .fn()
  .mockReturnValue({ data: { branch: "main" } });
const mockOpenDiff = vi.fn();

const mockProjects: AggregatedProjectItem[] = [
  {
    profileId: "profile-a",
    profileName: "Profile A",
    serverUrl: "http://a.local:4800",
    project: {
      name: "shared-repo",
      type: "git",
      isAvailable: true,
    } as unknown as AggregatedProjectItem["project"],
    ref: { profileId: "profile-a", project: "shared-repo" },
  },
  {
    profileId: "profile-b",
    profileName: "Profile B",
    serverUrl: "http://b.local:4800",
    project: {
      name: "shared-repo",
      type: "git",
      isAvailable: true,
    } as unknown as AggregatedProjectItem["project"],
    ref: { profileId: "profile-b", project: "shared-repo" },
  },
  {
    profileId: "profile-b",
    profileName: "Profile B",
    serverUrl: "http://b.local:4800",
    project: {
      name: "other-repo",
      type: "git",
      isAvailable: true,
    } as unknown as AggregatedProjectItem["project"],
    ref: { profileId: "profile-b", project: "other-repo" },
  },
];

vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: () => ({
    allProjects: mockProjects,
    groups: [],
    isLoading: false,
  }),
}));

vi.mock("@/api/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof QueriesModule>();
  return {
    ...actual,
    useGitFetch: () => ({
      mutateAsync: mockGitFetchMutate,
      isPending: false,
    }),
    useGitPull: () => ({
      mutateAsync: mockGitPullMutate,
      isPending: false,
    }),
    useGitPush: () => ({
      mutateAsync: mockGitPushMutate,
      isPending: false,
    }),
    useGitRoots: () => ({
      data: [{ rootId: ".", label: "Root", kind: "primary", warnings: [] }],
    }),
    useProjectStatus: (targetRef: unknown) => mockUseProjectStatus(targetRef),
  };
});

let mockHistoryViewResult = createDefaultMockHistoryView();

function createDefaultMockHistoryView(options?: { available?: boolean }) {
  return {
    rootId: ".",
    rootOptions: [
      {
        rootId: ".",
        path: ".",
        absolutePath: "",
        kind: "primary" as const,
        warnings: [],
      },
    ],
    setRootId: vi.fn(),
    branchRef: "refs/heads/main",
    branchLabel: "main",
    activeBranch: "main",
    activeBranchRef: "refs/heads/main",
    followActive: true,
    selectBranchRef: vi.fn(),
    followCheckedOutBranch: vi.fn(),
    isViewingActiveBranch: true,
    isViewingLocalBranch: true,
    searchText: "",
    setSearchText: vi.fn(),
    clearSearch: vi.fn(),
    isComposing: false,
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
    appliedMessageQuery: undefined,
    isFiltered: false,
    page: 0,
    offset: 0,
    previousPage: vi.fn(),
    nextPage: vi.fn(),
    hasPreviousPage: false,
    hasNextPage: false,
    logs: [
      {
        hash: "abc1234",
        message: "Initial commit",
        author: "Dev",
        date: "2026-10-01",
        parents: [],
        refs: ["HEAD -> main"],
        isPushed: true,
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
    availability: { isAvailable: options?.available ?? true },
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    isRefreshing: false,
    selectedCommit: null,
    selectCommit: vi.fn(),
    clearSelectedCommit: vi.fn(),
    effectiveScopeKey: '["test","shared-repo",null,"."]',
    squashScopeKey: "test-history-squash",
    squashSelectedHashes: [],
    toggleSquashCommit: vi.fn(),
    clearSquashSelection: vi.fn(),
    squashSelection: {
      count: 0,
      valid: false,
      entries: [],
      orderedHashes: [],
      disabledReason:
        "Select at least two parent-contiguous commits on this page.",
    },
    squashAvailable: false,
    squashUnavailableReason: "Discovery unresolved",
  };
}

const mockUseGitHistoryView = vi.fn().mockImplementation((target, options) => {
  return {
    ...mockHistoryViewResult,
    availability: { isAvailable: options?.available ?? true },
  };
});

vi.mock("@/hooks/use-git-history-view.js", () => ({
  useGitHistoryView: (target: unknown, options: unknown) =>
    mockUseGitHistoryView(target, options),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (
    selector: (state: { openDiff: typeof mockOpenDiff }) => unknown,
  ) =>
    selector({
      openDiff: mockOpenDiff,
    }),
}));

const cancelSshRetry = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: () => ({
    passphraseDialogProps: {
      open: false,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    },
    statusMessage: null,
    cancel: cancelSshRetry,
    executeWithRetry: (_opts: unknown, action: () => Promise<unknown>) =>
      action(),
  }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/components/organisms/GitLocalChanges.js", () => ({
  GitLocalChanges: () => <div data-testid="git-local-changes" />,
}));

interface CapturedGitLogTreeProps {
  logs?: unknown[];
  isLoading?: boolean;
  presentation?: "graph" | "list";
  emptyMessage?: string;
  selectedHash?: string;
  onSelectCommit?: (entry: unknown) => void;
  onCherryPick?: (entry: unknown) => void;
  onRevertCommit?: (entry: unknown) => void;
  onUndoLastCommit?: (entry: unknown) => void;
  onDropCommit?: (entry: unknown) => void;
  onEditCommitMessage?: (entry: unknown) => void;
  onReset?: (entry: unknown) => void;
}

let capturedGitLogTreeProps: CapturedGitLogTreeProps | null = null;
vi.mock("@/components/organisms/GitLogTree.js", () => ({
  GitLogTree: (props: CapturedGitLogTreeProps) => {
    capturedGitLogTreeProps = props;
    return <div data-testid="git-log-tree" />;
  },
}));

vi.mock("@/components/organisms/CommitDetailsPanel.js", () => ({
  CommitDetailsPanel: () => <div data-testid="commit-details-panel" />,
}));

describe("GitPage multi-profile routing & selection persistence", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedGitLogTreeProps = null;
    mockHistoryViewResult = createDefaultMockHistoryView();
    resetGitHistoryStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    useWorkspaceStore.setState({
      selectedProject: null,
      activeProject: null,
      activeProjectRevision: 0,
      navigationRevision: 0,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders all aggregated projects across profiles with profile badges for disambiguation", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    const labels = container.querySelectorAll("label");
    expect(labels.length).toBe(3);
    expect(container.textContent).toContain("shared-repo");
    expect(container.textContent).toContain("Profile A");
    expect(container.textContent).toContain("Profile B");
    expect(container.textContent).toContain("other-repo");
  });

  it("seeds initial selection from workspaceStore and routes git queries to that profile", async () => {
    useWorkspaceStore.setState({
      selectedProject: { profileId: "profile-b", project: "shared-repo" },
      activeProject: "shared-repo",
      activeProjectRevision: 1,
      navigationRevision: 1,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    expect(mockUseGitHistoryView).toHaveBeenCalled();
    const lastTarget = mockUseGitHistoryView.mock.calls.at(-1)?.[0];
    expect(lastTarget).toEqual(
      expect.objectContaining({
        profileId: "profile-b",
        project: "shared-repo",
      }),
    );
    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([
      projectKey({ profileId: "profile-b", project: "shared-repo" }),
    ]);
  });

  it("switches project on click and updates workspaceStore and git query endpoints", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    // Click second checkbox: Profile B's shared-repo
    await act(async () => {
      checkboxes[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useWorkspaceStore.getState().selectedProject).toEqual({
      profileId: "profile-b",
      project: "shared-repo",
    });

    expect(mockUseGitHistoryView).toHaveBeenCalled();
    const lastTarget = mockUseGitHistoryView.mock.calls.at(-1)?.[0];
    expect(lastTarget).toEqual(
      expect.objectContaining({
        profileId: "profile-b",
        project: "shared-repo",
      }),
    );
  });

  it("partitions bulk fetch operations by profileId when empty selection defaults to all", async () => {
    useGitHistoryStore.setState({
      gitPageSelection: [],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    const fetchButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Start Fetch"),
    );
    expect(fetchButton).toBeDefined();

    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // We have projects on profile-a and profile-b; fetch should be called per profile group
    expect(mockGitFetchMutate).toHaveBeenCalledTimes(2);
    const firstCallTargets = mockGitFetchMutate.mock.calls[0][0];
    const secondCallTargets = mockGitFetchMutate.mock.calls[1][0];

    expect(
      firstCallTargets.every(
        (t: { profileId?: string }) => t.profileId === "profile-a",
      ),
    ).toBe(true);
    expect(
      secondCallTargets.every(
        (t: { profileId?: string }) => t.profileId === "profile-b",
      ),
    ).toBe(true);
  });

  it("retains Workspace focus and preserves explicit [] selection on reload", async () => {
    useWorkspaceStore.setState({
      selectedProject: { profileId: "profile-a", project: "shared-repo" },
      activeProject: "shared-repo",
      activeProjectRevision: 1,
      navigationRevision: 1,
    });
    // Explicit all selection stored
    useGitHistoryStore.setState({
      gitPageSelection: [],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    // Selection remains [] and does NOT re-seed from Workspace
    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([]);
    expect(useWorkspaceStore.getState().selectedProject).toEqual({
      profileId: "profile-a",
      project: "shared-repo",
    });

    // Shows "No Project Selected" banner
    expect(container.textContent).toContain("No Project Selected");
  });

  it("restores multi-select on reload and leaves Workspace focus untouched", async () => {
    const keyA = projectKey({ profileId: "profile-a", project: "shared-repo" });
    const keyB = projectKey({ profileId: "profile-b", project: "shared-repo" });

    useWorkspaceStore.setState({
      selectedProject: { profileId: "profile-a", project: "shared-repo" },
    });
    useGitHistoryStore.setState({
      gitPageSelection: [keyA, keyB],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    // Multi selection restored
    expect(container.textContent).toContain("Multiple Projects Selected (2)");
    // Workspace focus NOT wiped
    expect(useWorkspaceStore.getState().selectedProject).toEqual({
      profileId: "profile-a",
      project: "shared-repo",
    });

    // Both checkboxes are checked
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
  });

  it("keeps offline unavailable selection visible with deselect control and fails closed on bulk operations", async () => {
    const offlineKey = '["profile-offline","offline-project"]';

    useGitHistoryStore.setState({
      gitPageSelection: [offlineKey],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    // Displays unavailable item with (offline) badge
    expect(container.textContent).toContain("offline-project");
    expect(container.textContent).toContain("(offline)");

    // Bulk buttons are disabled
    const fetchButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Start Fetch"),
    );
    expect(fetchButton?.hasAttribute("disabled")).toBe(true);

    const pullButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Start Pull"),
    );
    expect(pullButton?.hasAttribute("disabled")).toBe(true);

    // Explains which identity is offline
    expect(container.textContent).toContain("offline or unavailable");

    // History shows distinct offline message rather than empty commits
    expect(container.textContent).toContain(
      "Selected Project Offline or Unavailable",
    );

    // Deselect the offline project
    const deselectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.getAttribute("title") === "Deselect unavailable project");
    expect(deselectButton).toBeDefined();

    await act(async () => {
      deselectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([]);
  });

  it("enables inactive local branch edit message and displays updated banner without obsolete suffix", async () => {
    mockHistoryViewResult.isViewingActiveBranch = false;
    mockHistoryViewResult.isViewingLocalBranch = true;
    mockHistoryViewResult.branchRef = "refs/heads/feature/experiment";
    mockHistoryViewResult.branchLabel = "feature/experiment";
    mockHistoryViewResult.activeBranch = "main";

    useGitHistoryStore.setState({
      gitPageSelection: [
        projectKey({ profileId: "profile-a", project: "shared-repo" }),
      ],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    // Explanatory banner is visible
    expect(container.textContent).toContain("Viewing feature/experiment");
    expect(container.textContent).toContain(
      "Cherry-pick and revert apply to checked-out branch main",
    );
    expect(container.textContent).not.toContain(
      "Rewrite actions stay on the active branch.",
    );
    expect(capturedGitLogTreeProps?.onEditCommitMessage).toBeDefined();
  });

  it("disables edit actions and displays banner for remote branch views", async () => {
    mockHistoryViewResult.isViewingActiveBranch = false;
    mockHistoryViewResult.isViewingLocalBranch = false;
    mockHistoryViewResult.branchRef = "refs/remotes/origin/feature/remote";
    mockHistoryViewResult.branchLabel = "origin/feature/remote";
    mockHistoryViewResult.activeBranch = "main";

    useGitHistoryStore.setState({
      gitPageSelection: [
        projectKey({ profileId: "profile-a", project: "shared-repo" }),
      ],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("Viewing origin/feature/remote");
    expect(container.textContent).toContain(
      "Cherry-pick and revert apply to checked-out branch main",
    );
    expect(container.textContent).not.toContain(
      "Rewrite actions stay on the active branch.",
    );
    expect(capturedGitLogTreeProps?.onEditCommitMessage).toBeUndefined();
  });

  it("recovers from corrupt saved selection when user selects a valid project or clears", async () => {
    useGitHistoryStore.setState({
      gitPageSelection: ['["corrupt-key"'],
      selectionRecoveryRequired: true,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GitPage />
        </QueryClientProvider>,
      );
    });

    // Shows recovery warning
    expect(container.textContent).toContain(
      "Saved project selection was corrupted or invalid",
    );

    // Bulk operations disabled
    const fetchButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Start Fetch"),
    );
    expect(fetchButton?.hasAttribute("disabled")).toBe(true);

    // Click clear in recovery notice
    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Clear",
    );
    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useGitHistoryStore.getState().selectionRecoveryRequired).toBe(false);
    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([]);
  });
});
