// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resetScopeMock = vi.fn();
const handleCherryPickMock = vi.fn();
const setRevertCommitMock = vi.fn();
const setUndoLastCommitMock = vi.fn();
const setDropCommitMock = vi.fn();
const setEditCommitMock = vi.fn();
const setResetCommitMock = vi.fn();
const handleDropCommitMock = vi.fn();
const handleEditCommitMessageMock = vi.fn();
const handleRevertCommitMock = vi.fn();
const handleUndoLastCommitMock = vi.fn();
const handleCherryPickFilesMock = vi.fn();
const handleRevertFilesMock = vi.fn();
const handleDropFilesMock = vi.fn();
const openDiffMock = vi.fn();

let capturedCommitDetailsProps: {
  commit: { hash: string };
  onClose: () => void;
  onFileDoubleClick?: (file: { path: string; status: string; additions: number; deletions: number }) => void;
  onDropSelectedChanges?: unknown;
} | null = null;

const capturedDialogs: {
  drop?: { onConfirm?: () => void };
  edit?: { onConfirm?: (msg: string, allowSig?: boolean) => void };
  revert?: { onConfirm?: () => void };
  undo?: { onConfirm?: () => void };
  reset?: { onConfirm?: (mode: string) => void };
} = {};

let mockHistoryViewResult = createDefaultMockHistoryView();

function createDefaultMockHistoryView() {
  return {
    rootId: ".",
    rootOptions: [
      {
        rootId: ".",
        path: ".",
        absolutePath: "/repo",
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
        parents: [],
        refs: [],
        authorName: "Dev",
        authorEmail: "dev@example.com",
        message: "First commit",
        timestamp: 1,
        isPushed: true,
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
    availability: { isAvailable: true, reason: undefined as string | undefined },
    notice: null as string | null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
    isRefreshing: false,
    selectedCommit: null as unknown,
    selectCommit: vi.fn(),
    clearSelectedCommit: vi.fn(),
    effectiveScopeKey: '["","demo-project","",".","follow-active",0]',
  };
}

vi.mock("@/api/client.js", () => ({
  isGitUnavailableError: (err: unknown) =>
    Boolean(err && typeof err === "object" && "isGitUnavailable" in err),
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

vi.mock("@/api/queries.js", () => ({
  useGitPush: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitPrepareLeasedPush: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useGitPublishLeasedPush: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  resolveTargetOwner: vi.fn(() => undefined),
}));

vi.mock("@/hooks/use-git-history-view.js", () => ({
  useGitHistoryView: () => mockHistoryViewResult,
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
  useEditorStore: () => openDiffMock,
}));

vi.mock("@/components/molecules/GitHistoryToolbar.js", () => ({
  GitHistoryToolbar: (props: {
    searchText: string;
    logsCount: number;
    isFiltered?: boolean;
    notice?: string | null;
  }) =>
    createElement(
      "div",
      { "data-testid": "git-history-toolbar" },
      `GitHistoryToolbar:count=${props.logsCount}:filtered=${props.isFiltered ?? false}`,
    ),
}));

vi.mock("@/components/organisms/GitLogTree.js", () => ({
  GitLogTree: (props: {
    presentation?: string;
    onUndoLastCommit?: unknown;
    onDropCommit?: unknown;
    onEditCommitMessage?: unknown;
    onReset?: unknown;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "git-log-tree",
        "data-presentation": props.presentation ?? "graph",
        "data-can-rewrite": Boolean(props.onEditCommitMessage),
      },
      props.onEditCommitMessage ? "GitLogTree:can-rewrite" : "GitLogTree:read-only",
    ),
}));

vi.mock("@/components/organisms/CommitDetailsPanel.js", () => ({
  CommitDetailsPanel: (props: {
    commit: { hash: string };
    onClose: () => void;
    onFileDoubleClick?: (file: { path: string; status: string; additions: number; deletions: number }) => void;
    onDropSelectedChanges?: unknown;
  }) => {
    capturedCommitDetailsProps = props;
    return createElement(
      "div",
      {
        "data-testid": "commit-details-panel",
        "data-hash": props.commit.hash,
        "data-can-drop": Boolean(props.onDropSelectedChanges),
      },
      `CommitDetails:${props.commit.hash}`,
    );
  },
}));

vi.mock("@/components/organisms/GitBranchControl.js", () => ({
  GitBranchControl: (props: {
    project: string;
    mode?: string;
    selectedBranchRef?: string;
    selectedBranch?: string;
  }) =>
    createElement(
      "div",
      { "data-testid": "git-branch-control" },
      `GitBranchControl:${props.mode}:${props.selectedBranch}`,
    ),
}));

vi.mock("@/components/organisms/GitHistoryActions.js", () => ({
  GitDropCommitDialog: (props: { onConfirm?: () => void }) => {
    capturedDialogs.drop = props;
    return null;
  },
  GitEditCommitMessageDialog: (props: { onConfirm?: (msg: string, allowSig?: boolean) => void }) => {
    capturedDialogs.edit = props;
    return null;
  },
  GitHistoryStatusBanner: () => null,
  GitRevertCommitDialog: (props: { onConfirm?: () => void }) => {
    capturedDialogs.revert = props;
    return null;
  },
  GitResetDialog: (props: { onConfirm?: (mode: string) => void }) => {
    capturedDialogs.reset = props;
    return null;
  },
  GitUndoLastCommitDialog: (props: { onConfirm?: () => void }) => {
    capturedDialogs.undo = props;
    return null;
  },
  useGitHistoryActions: () => ({
    status: null,
    resetScope: resetScopeMock,
    handleCherryPick: handleCherryPickMock,
    setRevertCommit: setRevertCommitMock,
    setUndoLastCommit: setUndoLastCommitMock,
    setDropCommit: setDropCommitMock,
    setEditCommit: setEditCommitMock,
    setResetCommit: setResetCommitMock,
    handleDropCommit: handleDropCommitMock,
    handleEditCommitMessage: handleEditCommitMessageMock,
    handleRevertCommit: handleRevertCommitMock,
    handleUndoLastCommit: handleUndoLastCommitMock,
    handleCherryPickFiles: handleCherryPickFilesMock,
    handleRevertFiles: handleRevertFilesMock,
    handleDropFiles: handleDropFilesMock,
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

import type { VcsRoot } from "@/api/client.js";
import {
  describeVcsRoot,
  formatVcsRootLabel,
  projectRelativePathForRoot,
  WorkspaceGitPanel,
  workspaceGitRootOptions,
} from "./WorkspaceGitPanel.js";

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
});

describe("WorkspaceGitPanel component integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCommitDetailsProps = null;
    mockHistoryViewResult = createDefaultMockHistoryView();
  });

  it("renders a push action, toolbar, and active-branch editable log tree", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain("Push");
    expect(markup).toContain('data-testid="workspace-git-push-button"');
    expect(markup).toContain('data-testid="git-history-toolbar"');
    expect(markup).toContain("GitLogTree:can-rewrite");
    expect(markup).toContain("GitBranchControl:view:main");
  });

  it("disables rewrite actions on GitLogTree when viewing non-active branch", () => {
    mockHistoryViewResult.isViewingActiveBranch = false;
    mockHistoryViewResult.branchLabel = "feature/experiment";
    mockHistoryViewResult.activeBranch = "main";

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain("GitLogTree:read-only");
    expect(markup).toContain("Viewing <strong>feature/experiment</strong>");
    expect(markup).toContain(
      "Cherry-pick and revert apply to checked-out branch <strong>main</strong>",
    );
  });

  it("renders presentation='list' on GitLogTree when filter query is applied", () => {
    mockHistoryViewResult.isFiltered = true;
    mockHistoryViewResult.appliedMessageQuery = "fix";

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain('data-presentation="list"');
  });

  it("renders unavailable placeholder when target is marked unavailable", () => {
    mockHistoryViewResult.availability = {
      isAvailable: false,
      reason: "Worktree path /missing is not available",
    };

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, {
        project: "demo-project",
        available: false,
      }),
    );

    expect(markup).toContain("Worktree path /missing is not available");
    expect(markup).not.toContain('data-testid="workspace-git-push-button"');
  });

  it("renders git uninitialized message when history error indicates uninitialized repo", () => {
    mockHistoryViewResult.error = Object.assign(new Error("Git not found"), {
      isGitUnavailable: true,
    });

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain("Git is not initialized for this project");
    expect(markup).toContain("git init");
  });

  it("renders retry banner when history error is an ordinary failure", () => {
    mockHistoryViewResult.error = new Error("Network timeout loading logs");

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain("Failed to load git history: Network timeout loading logs");
    expect(markup).toContain("Retry");
  });

  it("renders commit details panel when a commit is selected", () => {
    mockHistoryViewResult.selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "First commit",
      timestamp: 1,
      isPushed: true,
    };

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain('data-testid="commit-details-panel"');
    expect(markup).toContain("CommitDetails:abc1234");
    expect(markup).toContain('data-can-drop="true"');
  });

  it("disables drop selected changes in commit details panel when viewing non-active branch", () => {
    mockHistoryViewResult.isViewingActiveBranch = false;
    mockHistoryViewResult.selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "First commit",
      timestamp: 1,
      isPushed: true,
    };

    const markup = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(markup).toContain('data-testid="commit-details-panel"');
    expect(markup).toContain('data-can-drop="false"');
  });

  it("opens root-relative diff when double-clicking a file in commit details", () => {
    mockHistoryViewResult.rootId = "modules/sub";
    mockHistoryViewResult.selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "First commit",
      timestamp: 1,
      isPushed: true,
    };

    renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    expect(capturedCommitDetailsProps).not.toBeNull();
    capturedCommitDetailsProps?.onFileDoubleClick?.({
      path: "src/index.ts",
      status: "modified",
      additions: 10,
      deletions: 2,
    });

    expect(openDiffMock).toHaveBeenCalledWith(
      { project: "demo-project" },
      "modules/sub/src/index.ts",
      "modified",
      10,
      2,
      "abc1234",
    );
  });

  it("clears selected commit when dropped commit matches selected hash", async () => {
    const clearSelectedCommitMock = vi.fn();
    mockHistoryViewResult.selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "To drop",
      timestamp: 1,
      isPushed: false,
    };
    mockHistoryViewResult.clearSelectedCommit = clearSelectedCommitMock;
    handleDropCommitMock.mockResolvedValue("abc1234");

    renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    await capturedDialogs.drop?.onConfirm?.();

    expect(handleDropCommitMock).toHaveBeenCalled();
    expect(clearSelectedCommitMock).toHaveBeenCalled();
  });

  it("clears selected commit when undone commit matches selected hash", async () => {
    const clearSelectedCommitMock = vi.fn();
    mockHistoryViewResult.selectedCommit = {
      hash: "abc1234",
      parents: [],
      refs: [],
      authorName: "Dev",
      authorEmail: "dev@example.com",
      message: "To undo",
      timestamp: 1,
      isPushed: false,
    };
    mockHistoryViewResult.clearSelectedCommit = clearSelectedCommitMock;
    handleUndoLastCommitMock.mockResolvedValue("abc1234");

    renderToStaticMarkup(
      createElement(WorkspaceGitPanel, { project: "demo-project" }),
    );

    await capturedDialogs.undo?.onConfirm?.();

    expect(handleUndoLastCommitMock).toHaveBeenCalled();
    expect(clearSelectedCommitMock).toHaveBeenCalled();
  });

  it("calls resetScope when effectiveScopeKey changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    mockHistoryViewResult.effectiveScopeKey = '["","demo-project","",".","follow-active",0]';

    await act(async () => {
      root.render(createElement(WorkspaceGitPanel, { project: "demo-project" }));
    });

    expect(resetScopeMock).toHaveBeenCalledTimes(1);

    mockHistoryViewResult.effectiveScopeKey = '["","demo-project","","modules/child","follow-active",0]';

    await act(async () => {
      root.render(createElement(WorkspaceGitPanel, { project: "demo-project" }));
    });

    expect(resetScopeMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
