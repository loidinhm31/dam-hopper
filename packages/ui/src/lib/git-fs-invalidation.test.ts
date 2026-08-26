import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GIT_FS_INVALIDATION_DEBOUNCE_MS,
  scheduleGitFsInvalidation,
} from "./git-fs-invalidation.js";

function createQueryClient() {
  return { invalidateQueries: vi.fn(() => Promise.resolve()) };
}

describe("scheduleGitFsInvalidation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst for one project and covers all Git cache families", () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();

    scheduleGitFsInvalidation(queryClient, "alpha");
    scheduleGitFsInvalidation(queryClient, "alpha");
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS - 1);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["git-diff", "alpha", "root"] }],
      [{ queryKey: ["git-untracked", "alpha", "root"] }],
      [{ queryKey: ["git-file-diff", "alpha", "root"] }],
    ]);
  });

  it("isolates projects and releases a bucket after it runs", () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();

    scheduleGitFsInvalidation(queryClient, "alpha");
    scheduleGitFsInvalidation(queryClient, "beta");
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(6);
    expect(queryClient.invalidateQueries.mock.calls).toContainEqual([
      { queryKey: ["git-diff", "alpha", "root"] },
    ]);
    expect(queryClient.invalidateQueries.mock.calls).toContainEqual([
      { queryKey: ["git-diff", "beta", "root"] },
    ]);

    queryClient.invalidateQueries.mockClear();
    scheduleGitFsInvalidation(queryClient, "alpha");
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("waits for the burst to settle before invalidating", () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();

    scheduleGitFsInvalidation(queryClient, "alpha");
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS - 1);
    scheduleGitFsInvalidation(queryClient, "alpha");
    vi.advanceTimersByTime(1);

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS - 1);
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("does not share timers between query clients", () => {
    vi.useFakeTimers();
    const firstClient = createQueryClient();
    const secondClient = createQueryClient();

    scheduleGitFsInvalidation(firstClient, "alpha");
    scheduleGitFsInvalidation(secondClient, "alpha");
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);

    expect(firstClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(secondClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("keeps worktree refreshes in separate target buckets", () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();

    scheduleGitFsInvalidation(queryClient, {
      project: "alpha",
      worktreePath: "/tmp/alpha-feature",
    });
    scheduleGitFsInvalidation(queryClient, {
      project: "alpha",
      worktreePath: "/tmp/alpha-fix",
    });
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(6);
    expect(queryClient.invalidateQueries.mock.calls).toContainEqual([
      {
        queryKey: ["git-diff", "alpha", "worktree:/tmp/alpha-feature"],
      },
    ]);
    expect(queryClient.invalidateQueries.mock.calls).toContainEqual([
      {
        queryKey: ["git-diff", "alpha", "worktree:/tmp/alpha-fix"],
      },
    ]);
  });
});
