// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitPage } from "./GitPage.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import type * as QueriesModule from "@/api/queries.js";
const mockGitFetchMutate = vi.fn().mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockGitPullMutate = vi.fn().mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockGitPushMutate = vi.fn().mockResolvedValue([{ success: true, projectName: "repo-1" }]);
const mockUseGitLog = vi.fn().mockReturnValue({ data: [], isLoading: false });
const mockUseProjectStatus = vi.fn().mockReturnValue({ data: { branch: "main" } });
const mockOpenDiff = vi.fn();

const mockProjects: AggregatedProjectItem[] = [
  {
    profileId: "profile-a",
    profileName: "Profile A",
    serverUrl: "http://a.local:4800",
    project: { name: "shared-repo", type: "git", isAvailable: true } as unknown as AggregatedProjectItem["project"],
    ref: { profileId: "profile-a", project: "shared-repo" },
  },
  {
    profileId: "profile-b",
    profileName: "Profile B",
    serverUrl: "http://b.local:4800",
    project: { name: "shared-repo", type: "git", isAvailable: true } as unknown as AggregatedProjectItem["project"],
    ref: { profileId: "profile-b", project: "shared-repo" },
  },
  {
    profileId: "profile-b",
    profileName: "Profile B",
    serverUrl: "http://b.local:4800",
    project: { name: "other-repo", type: "git", isAvailable: true } as unknown as AggregatedProjectItem["project"],
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
    useGitLog: (targetRef: unknown) => mockUseGitLog(targetRef),
    useGitRoots: () => ({ data: [{ rootId: ".", label: "Root" }] }),
    useProjectStatus: (targetRef: unknown) => mockUseProjectStatus(targetRef),
  };
});

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: { openDiff: typeof mockOpenDiff }) => unknown) =>
    selector({
      openDiff: mockOpenDiff,
    }),
}));

vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: () => ({
    passphraseDialogProps: { open: false, onClose: vi.fn(), onConfirm: vi.fn() },
    statusMessage: null,
    executeWithRetry: (_opts: unknown, action: () => Promise<unknown>) => action(),
  }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children?: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/organisms/GitLocalChanges.js", () => ({
  GitLocalChanges: () => <div data-testid="git-local-changes" />,
}));

vi.mock("@/components/organisms/GitLogTree.js", () => ({
  GitLogTree: () => <div data-testid="git-log-tree" />,
}));

vi.mock("@/components/organisms/CommitDetailsPanel.js", () => ({
  CommitDetailsPanel: () => <div data-testid="commit-details-panel" />,
}));

describe("GitPage multi-profile routing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mockUseGitLog).toHaveBeenCalled();
    const lastTarget = mockUseGitLog.mock.calls.at(-1)?.[0];
    expect(lastTarget).toEqual(
      expect.objectContaining({
        profileId: "profile-b",
        project: "shared-repo",
      }),
    );
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

    const lastTarget = mockUseGitLog.mock.calls.at(-1)?.[0];
    expect(lastTarget).toEqual(
      expect.objectContaining({
        profileId: "profile-b",
        project: "shared-repo",
      }),
    );
  });

  it("partitions bulk fetch operations by profileId", async () => {
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

    expect(firstCallTargets.every((t: { profileId?: string }) => t.profileId === "profile-a")).toBe(true);
    expect(secondCallTargets.every((t: { profileId?: string }) => t.profileId === "profile-b")).toBe(true);
  });
});
