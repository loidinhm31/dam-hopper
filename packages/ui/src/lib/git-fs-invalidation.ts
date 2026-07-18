import type { QueryClient } from "@tanstack/react-query";

/**
 * The server already coalesces watcher events for 150 ms. A small client-side
 * window absorbs the several normalized events that one filesystem operation
 * can produce without making Git status feel delayed.
 */
export const GIT_FS_INVALIDATION_DEBOUNCE_MS = 250;

type GitFsQueryClient = Pick<QueryClient, "invalidateQueries">;
type PendingTimers = Map<string, ReturnType<typeof setTimeout>>;

const pendingTimers = new WeakMap<GitFsQueryClient, PendingTimers>();
const GIT_QUERY_PREFIXES = [
  "git-diff",
  "git-untracked",
  "git-file-diff",
] as const;

/** Schedule one project-scoped refresh for all visible Git cache families. */
export function scheduleGitFsInvalidation(
  queryClient: GitFsQueryClient,
  project: string,
): void {
  let projectTimers = pendingTimers.get(queryClient);
  if (!projectTimers) {
    projectTimers = new Map();
    pendingTimers.set(queryClient, projectTimers);
  }

  const existingTimer = projectTimers.get(project);
  if (existingTimer !== undefined) clearTimeout(existingTimer);

  const queryClientRef = new WeakRef(queryClient);
  const timer = setTimeout(() => {
    projectTimers?.delete(project);
    const currentQueryClient = queryClientRef.deref();
    if (!currentQueryClient) return;
    if (projectTimers?.size === 0) {
      pendingTimers.delete(currentQueryClient);
    }

    for (const prefix of GIT_QUERY_PREFIXES) {
      void currentQueryClient.invalidateQueries({
        queryKey: [prefix, project],
      });
    }
  }, GIT_FS_INVALIDATION_DEBOUNCE_MS);

  projectTimers.set(project, timer);
}
