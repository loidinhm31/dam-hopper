import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diff: vi.fn(),
  roots: vi.fn(),
  fetch: vi.fn(),
  pull: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  reconcileGitMutationFiles: vi.fn(async () => undefined),
  reconcileGitProjectFiles: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("./client.js", () => ({
  api: {
    git: {
      diff: mocks.diff,
      roots: mocks.roots,
      fetch: mocks.fetch,
      pull: mocks.pull,
    },
  },
  isGitUnavailableError: (error: unknown) =>
    (error as { code?: string })?.code === "GIT_NOT_INITIALIZED",
  isProjectTargetError: () => false,
  normalizeProjectTarget: (
    target: string | { project: string; worktreePath?: string },
  ) => (typeof target === "string" ? { project: target } : target),
  normalizeProjectTargetPath: (path: string) => path,
  projectTargetCacheKey: (target: {
    project: string;
    worktreePath?: string;
  }) =>
    target.worktreePath == null ? "root" : `worktree:${target.worktreePath}`,
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      tabs: [],
      reconcileGitMutationFiles: mocks.reconcileGitMutationFiles,
      reconcileGitProjectFiles: mocks.reconcileGitProjectFiles,
      markTargetUnavailable: vi.fn(),
    })),
  },
}));

import {
  useGitDiff,
  useGitFetch,
  useGitPull,
  useGitStage,
  useGitUnstage,
} from "./queries.js";

interface CapturedQuery {
  queryFn: () => Promise<unknown>;
}

describe("useGitDiff", () => {
  it("maps the direct diff unavailable code without a roots preflight", async () => {
    mocks.diff.mockRejectedValueOnce({ code: "GIT_NOT_INITIALIZED" });

    const query = useGitDiff("demo", "*") as unknown as CapturedQuery;

    await expect(query.queryFn()).resolves.toMatchObject({
      gitAvailable: false,
      code: "GIT_NOT_INITIALIZED",
      entries: [],
    });
    expect(mocks.diff).toHaveBeenCalledWith({ project: "demo" }, "*");
    expect(mocks.roots).not.toHaveBeenCalled();
  });

  it("preserves generic diff failures", async () => {
    const error = new Error("network failed");
    mocks.diff.mockRejectedValueOnce(error);

    const query = useGitDiff("demo", "*") as unknown as CapturedQuery;

    await expect(query.queryFn()).rejects.toBe(error);
  });

  it("partitions diff queries by the selected target", () => {
    const rootQuery = useGitDiff("demo", "*") as unknown as {
      queryKey: unknown[];
    };
    const worktreeQuery = useGitDiff(
      { project: "demo", worktreePath: "/tmp/demo-feature" },
      "*",
    ) as unknown as { queryKey: unknown[] };

    expect(rootQuery.queryKey).toEqual(["git-diff", "demo", "root", "*"]);
    expect(worktreeQuery.queryKey).toEqual([
      "git-diff",
      "demo",
      "worktree:/tmp/demo-feature",
      "*",
    ]);
  });
});

describe("target-aware Git mutations", () => {
  it("sends selected targets for fetch and pull", async () => {
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    mocks.fetch.mockResolvedValueOnce([]);
    mocks.pull.mockResolvedValueOnce([]);

    const fetchMutation = useGitFetch() as unknown as {
      mutationFn: (targets: (typeof target)[]) => Promise<unknown>;
    };
    const pullMutation = useGitPull() as unknown as {
      mutationFn: (targets: (typeof target)[]) => Promise<unknown>;
    };

    await fetchMutation.mutationFn([target]);
    await pullMutation.mutationFn([target]);

    expect(mocks.fetch).toHaveBeenCalledWith([target]);
    expect(mocks.pull).toHaveBeenCalledWith([target]);
  });

  it("invalidates only the selected target after a targeted fetch", () => {
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    mocks.invalidateQueries.mockClear();
    const fetchMutation = useGitFetch() as unknown as {
      onSuccess: (result: unknown, targets: (typeof target)[]) => void;
    };

    fetchMutation.onSuccess([], [target]);

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["branches", "demo", "worktree:/tmp/demo-feature"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["project-status", "demo", "worktree:/tmp/demo-feature"],
    });
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["branches", "demo", "root"],
    });
  });

  it("reconciles open tabs only for a targeted pull", () => {
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    mocks.reconcileGitProjectFiles.mockClear();
    const pullMutation = useGitPull() as unknown as {
      onSuccess: (result: unknown, targets: (typeof target)[]) => void;
    };

    pullMutation.onSuccess([], [target]);

    expect(mocks.reconcileGitProjectFiles).toHaveBeenCalledWith(target);
  });

  it("invalidates status in the selected target after staging", async () => {
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    const assertTargetStatusInvalidated = () => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["git-diff", "demo", "worktree:/tmp/demo-feature"],
      });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["project-status", "demo", "worktree:/tmp/demo-feature"],
      });
    };

    const stageMutation = useGitStage(target) as unknown as {
      onSuccess: () => Promise<void> | void;
    };
    await stageMutation.onSuccess();
    assertTargetStatusInvalidated();

    mocks.invalidateQueries.mockClear();
    const unstageMutation = useGitUnstage(target) as unknown as {
      onSuccess: () => Promise<void> | void;
    };
    await unstageMutation.onSuccess();
    assertTargetStatusInvalidated();
  });
});
