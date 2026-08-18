import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client.js", () => ({
  isGitUnavailableError: () => false,
  normalizeProjectTarget: (target: string | { project: string }) =>
    typeof target === "string" ? { project: target } : target,
  normalizeProjectTargetPath: (path: string) => path,
  projectTargetCacheKey: () => "root",
  api: {
    git: {
      log: vi.fn(),
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    refetchQueries: vi.fn().mockResolvedValue(undefined),
    fetchQuery: vi.fn(),
  }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitRoots: () => ({
    data: [
      {
        rootId: ".",
        path: ".",
        absolutePath: "/repo",
        kind: "primary",
        warnings: [],
      },
    ],
  }),
  useBranches: () => ({
    data: [
      {
        name: "main",
        isRemote: false,
        isCurrent: true,
        ahead: 0,
        behind: 0,
        lastCommit: "abc1234",
      },
    ],
  }),
  useGitLog: () => ({ data: [], isLoading: false }),
  useGitPush: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: () => ({
    passphraseDialogProps: {
      open: false,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      loading: false,
      error: undefined,
      availableKeys: [],
    },
    statusMessage: undefined,
    executeWithRetry: vi.fn(),
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: () => vi.fn(),
}));

vi.mock("@/components/organisms/GitLogTree.js", () => ({
  GitLogTree: (props: { onEditCommitMessage?: unknown }) =>
    createElement(
      "div",
      null,
      props.onEditCommitMessage ? "GitLogTree:edit-message" : "GitLogTree",
    ),
}));

vi.mock("@/components/organisms/CommitDetailsPanel.js", () => ({
  CommitDetailsPanel: () => createElement("div", null, "CommitDetailsPanel"),
}));

vi.mock("@/components/organisms/GitBranchControl.js", () => ({
  GitBranchControl: () => createElement("div", null, "GitBranchControl"),
}));

vi.mock("@/components/organisms/GitHistoryActions.js", () => ({
  GitDropCommitDialog: () => null,
  GitEditCommitMessageDialog: () => null,
  GitHistoryStatusBanner: () => null,
  GitRevertCommitDialog: () => null,
  GitResetDialog: () => null,
  GitUndoLastCommitDialog: () => null,
  useGitHistoryActions: () => ({
    status: null,
    resetScope: vi.fn(),
    handleCherryPick: vi.fn(),
    setRevertCommit: vi.fn(),
    setUndoLastCommit: vi.fn(),
    setDropCommit: vi.fn(),
    setEditCommit: vi.fn(),
    setResetCommit: vi.fn(),
    handleDropCommit: vi.fn(),
    handleEditCommitMessage: vi.fn(),
    handleRevertCommit: vi.fn(),
    handleUndoLastCommit: vi.fn(),
    handleCherryPickFiles: vi.fn(),
    handleRevertFiles: vi.fn(),
    handleDropFiles: vi.fn(),
    resetCommit: null,
    dropCommit: null,
    editCommit: null,
    editCommitMessage: undefined,
    editCommitMessageLoading: false,
    editCommitMessageError: undefined,
    revertCommit: null,
    undoLastCommit: null,
    isDropCommitPending: false,
    isEditCommitMessagePending: false,
    isRevertCommitPending: false,
    isUndoLastCommitPending: false,
    handleReset: vi.fn(),
  }),
}));

import { api } from "@/api/client.js";
import type { VcsRoot } from "@/api/client.js";
import {
  describeVcsRoot,
  formatVcsRootLabel,
  projectRelativePathForRoot,
  refreshWorkspaceGitPanelQueries,
  resolveWorkspaceHistoryRef,
  resolveWorkspaceHistoryBranchState,
  resolveWorkspaceGitSelection,
  WorkspaceGitPanel,
  workspaceGitRootOptions,
} from "./WorkspaceGitPanel.js";

const gitLogMock = vi.mocked(api.git.log);

describe("WorkspaceGitPanel refresh helpers", () => {
  beforeEach(() => {
    gitLogMock.mockReset();
  });

  it("keeps the selected commit when it still exists after refresh", async () => {
    const selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "Keep me",
      timestamp: 1,
      isPushed: false,
    };

    gitLogMock.mockResolvedValue([selectedCommit]);

    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const refetchQueries = vi.fn().mockResolvedValue(undefined);
    const fetchQuery = vi.fn(
      ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
    );

    const refreshed = await refreshWorkspaceGitPanelQueries(
      { invalidateQueries, refetchQueries, fetchQuery },
      "demo-project",
      selectedCommit.hash,
      0,
    );

    expect(refreshed).toEqual(selectedCommit);
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "root", "."] }],
      [{ queryKey: ["project-status", "demo-project", "root"] }],
      [{ queryKey: ["git-log", "demo-project", "root", "."] }],
      [
        {
          queryKey: [
            "git-commit-files",
            "demo-project",
            "root",
            ".",
            "abc1234",
          ],
        },
      ],
    ]);
    expect(refetchQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "root", "."] }],
      [{ queryKey: ["project-status", "demo-project", "root"] }],
      [
        {
          queryKey: [
            "git-commit-files",
            "demo-project",
            "root",
            ".",
            "abc1234",
          ],
        },
      ],
    ]);
    expect(fetchQuery).toHaveBeenCalledWith({
      queryKey: ["git-log", "demo-project", "root", ".", 200, 0, null],
      queryFn: expect.any(Function),
    });
  });

  it("clears the selected commit when the refreshed log no longer contains it", async () => {
    gitLogMock.mockResolvedValue([
      {
        hash: "def5678",
        parents: [],
        refs: [],
        authorName: "Dev",
        authorEmail: "dev@example.com",
        message: "Different commit",
        timestamp: 1,
        isPushed: false,
      },
    ]);

    const refreshed = await refreshWorkspaceGitPanelQueries(
      {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
        refetchQueries: vi.fn().mockResolvedValue(undefined),
        fetchQuery: ({ queryFn }: { queryFn: () => Promise<unknown> }) =>
          queryFn(),
      },
      "demo-project",
      "abc1234",
      0,
    );

    expect(refreshed).toBeNull();
    expect(resolveWorkspaceGitSelection("abc1234", [])).toBeNull();
  });

  it("does not refetch commit files when no history selection is active", async () => {
    gitLogMock.mockResolvedValue([]);

    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const refetchQueries = vi.fn().mockResolvedValue(undefined);
    const fetchQuery = vi.fn(
      ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
    );

    const refreshed = await refreshWorkspaceGitPanelQueries(
      { invalidateQueries, refetchQueries, fetchQuery },
      "demo-project",
      null,
      0,
    );

    expect(refreshed).toBeNull();
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "root", "."] }],
      [{ queryKey: ["project-status", "demo-project", "root"] }],
      [{ queryKey: ["git-log", "demo-project", "root", "."] }],
    ]);
    expect(refetchQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "root", "."] }],
      [{ queryKey: ["project-status", "demo-project", "root"] }],
    ]);
  });

  it("refreshes history for the selected branch without changing query scope", async () => {
    gitLogMock.mockResolvedValue([]);

    const fetchQuery = vi.fn(
      ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
    );

    await refreshWorkspaceGitPanelQueries(
      {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
        refetchQueries: vi.fn().mockResolvedValue(undefined),
        fetchQuery,
      },
      "demo-project",
      null,
      0,
      "feature/demo",
    );

    expect(fetchQuery).toHaveBeenCalledWith({
      queryKey: [
        "git-log",
        "demo-project",
        "root",
        ".",
        200,
        0,
        "feature/demo",
      ],
      queryFn: expect.any(Function),
    });
  });

  it("refreshes root-scoped history queries for a selected child root", async () => {
    gitLogMock.mockResolvedValue([]);

    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const refetchQueries = vi.fn().mockResolvedValue(undefined);
    const fetchQuery = vi.fn(
      ({ queryFn }: { queryFn: () => Promise<unknown> }) => queryFn(),
    );

    await refreshWorkspaceGitPanelQueries(
      { invalidateQueries, refetchQueries, fetchQuery },
      "demo-project",
      "abc1234",
      0,
      "child-main",
      "modules/child",
    );

    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "root", "modules/child"] }],
      [{ queryKey: ["project-status", "demo-project", "root"] }],
      [{ queryKey: ["git-log", "demo-project", "root", "modules/child"] }],
      [
        {
          queryKey: [
            "git-commit-files",
            "demo-project",
            "root",
            "modules/child",
            "abc1234",
          ],
        },
      ],
    ]);
    expect(fetchQuery).toHaveBeenCalledWith({
      queryKey: [
        "git-log",
        "demo-project",
        "root",
        "modules/child",
        200,
        0,
        "child-main",
      ],
      queryFn: expect.any(Function),
    });
    expect(gitLogMock).toHaveBeenCalledWith(
      { project: "demo-project" },
      200,
      0,
      "child-main",
      "modules/child",
    );
  });

  it("follows active branch changes until the history view is pinned", () => {
    expect(
      resolveWorkspaceHistoryBranchState(
        {
          project: "demo-project",
          root: ".",
          branch: "main",
          followsActive: true,
        },
        "demo-project",
        ".",
        "release",
      ),
    ).toEqual({
      project: "demo-project",
      root: ".",
      branch: "release",
      followsActive: true,
    });

    expect(
      resolveWorkspaceHistoryBranchState(
        {
          project: "demo-project",
          root: ".",
          branch: "feature/demo",
          followsActive: false,
        },
        "demo-project",
        ".",
        "release",
      ),
    ).toEqual({
      project: "demo-project",
      root: ".",
      branch: "feature/demo",
      followsActive: false,
    });
  });

  it("resets branch scope when the selected VCS root changes", () => {
    expect(
      resolveWorkspaceHistoryBranchState(
        {
          project: "demo-project",
          root: ".",
          branch: "main",
          followsActive: false,
        },
        "demo-project",
        "modules/child",
        "child-main",
      ),
    ).toEqual({
      project: "demo-project",
      root: "modules/child",
      branch: "child-main",
      followsActive: true,
    });
  });

  it("resolves the selected viewing branch to its exact tip commit", () => {
    expect(
      resolveWorkspaceHistoryRef(
        [
          {
            name: "main",
            isRemote: false,
            isCurrent: true,
            ahead: 0,
            behind: 0,
            lastCommit: "abc1234",
          },
          {
            name: "feature/demo",
            isRemote: false,
            isCurrent: false,
            ahead: 0,
            behind: 0,
            lastCommit: "def5678",
          },
        ],
        "feature/demo",
      ),
    ).toBe("def5678");

    expect(resolveWorkspaceHistoryRef([], "feature/demo")).toBe("feature/demo");
  });
});

describe("WorkspaceGitPanel VCS root helpers", () => {
  it("falls back to the primary root when discovery has no roots yet", () => {
    expect(workspaceGitRootOptions([])).toEqual([
      {
        rootId: ".",
        path: ".",
        absolutePath: "",
        kind: "primary",
        warnings: [],
      },
    ]);
  });

  it("formats root selector labels and mapping state descriptions", () => {
    const roots: VcsRoot[] = [
      {
        rootId: ".",
        path: ".",
        absolutePath: "/repo",
        kind: "primary",
        warnings: [],
      },
      {
        rootId: "modules/child",
        path: "modules/child",
        absolutePath: "/repo/modules/child",
        kind: "submodule",
        mappingState: "unmapped",
        warnings: ["gitlink has no matching .gitmodules path"],
      },
      {
        rootId: "tools/plain",
        path: "tools/plain",
        absolutePath: "/repo/tools/plain",
        kind: "nestedRepo",
        warnings: [],
      },
    ];

    expect(formatVcsRootLabel(roots[0])).toBe("Project root");
    expect(formatVcsRootLabel(roots[1])).toBe("modules/child");
    expect(describeVcsRoot(roots[1])).toBe("Unmapped");
    expect(describeVcsRoot(roots[2])).toBe("Nested repo");
  });

  it("opens root-relative commit files as project-relative paths", () => {
    expect(projectRelativePathForRoot("modules/child", "README.md")).toBe(
      "modules/child/README.md",
    );
    expect(
      projectRelativePathForRoot("modules/child", "modules/child/README.md"),
    ).toBe("modules/child/README.md");
    expect(projectRelativePathForRoot(".", "README.md")).toBe("README.md");
  });

  it("renders a push action in the workspace git panel", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain("Push");
    expect(markup).toContain("History");
    expect(markup).toContain("GitLogTree:edit-message");
    expect(markup).toContain('data-testid="workspace-git-push-button"');
  });
});
