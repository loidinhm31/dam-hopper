import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client.js", () => ({
  api: {
    git: {
      log: vi.fn(),
    },
  },
}));

import { api } from "@/api/client.js";
import {
  refreshWorkspaceGitPanelQueries,
  resolveWorkspaceHistoryRef,
  resolveWorkspaceHistoryBranchState,
  resolveWorkspaceGitSelection,
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
      [{ queryKey: ["branches", "demo-project", "."] }],
      [{ queryKey: ["project-status", "demo-project"] }],
      [{ queryKey: ["git-log", "demo-project", "."] }],
      [{ queryKey: ["git-commit-files", "demo-project", ".", "abc1234"] }],
    ]);
    expect(refetchQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "."] }],
      [{ queryKey: ["project-status", "demo-project"] }],
      [{ queryKey: ["git-commit-files", "demo-project", ".", "abc1234"] }],
    ]);
    expect(fetchQuery).toHaveBeenCalledWith({
      queryKey: ["git-log", "demo-project", ".", 200, 0, null],
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
      [{ queryKey: ["branches", "demo-project", "."] }],
      [{ queryKey: ["project-status", "demo-project"] }],
      [{ queryKey: ["git-log", "demo-project", "."] }],
    ]);
    expect(refetchQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project", "."] }],
      [{ queryKey: ["project-status", "demo-project"] }],
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
      queryKey: ["git-log", "demo-project", ".", 200, 0, "feature/demo"],
      queryFn: expect.any(Function),
    });
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
