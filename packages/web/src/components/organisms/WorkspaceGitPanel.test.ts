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
    const fetchQuery = vi.fn(({ queryFn }: { queryFn: () => Promise<unknown> }) =>
      queryFn(),
    );

    const refreshed = await refreshWorkspaceGitPanelQueries(
      { invalidateQueries, refetchQueries, fetchQuery },
      "demo-project",
      selectedCommit.hash,
    );

    expect(refreshed).toEqual(selectedCommit);
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project"] }],
      [{ queryKey: ["project-status", "demo-project"] }],
      [{ queryKey: ["git-log", "demo-project"] }],
      [{ queryKey: ["git-commit-files", "demo-project", "abc1234"] }],
    ]);
    expect(refetchQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo-project"] }],
      [{ queryKey: ["project-status", "demo-project"] }],
      [{ queryKey: ["git-commit-files", "demo-project", "abc1234"] }],
    ]);
    expect(fetchQuery).toHaveBeenCalledWith({
      queryKey: ["git-log", "demo-project", 200],
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
    );

    expect(refreshed).toBeNull();
    expect(resolveWorkspaceGitSelection("abc1234", [])).toBeNull();
  });
});
