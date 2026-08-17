import type { QueryClient } from "@tanstack/react-query";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";

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

/** Schedule one target-scoped refresh for all visible Git cache families. */
export function scheduleGitFsInvalidation(
  queryClient: GitFsQueryClient,
  target: ProjectTargetInput,
): void {
  const normalized = normalizeProjectTarget(target);
  const targetKey = projectTargetCacheKey(normalized);
  const timerKey = `${normalized.project}\0${targetKey}`;
  let targetTimers = pendingTimers.get(queryClient);
  if (!targetTimers) {
    targetTimers = new Map();
    pendingTimers.set(queryClient, targetTimers);
  }

  const existingTimer = targetTimers.get(timerKey);
  if (existingTimer !== undefined) clearTimeout(existingTimer);

  const queryClientRef = new WeakRef(queryClient);
  const timer = setTimeout(() => {
    targetTimers?.delete(timerKey);
    const currentQueryClient = queryClientRef.deref();
    if (!currentQueryClient) return;
    if (targetTimers?.size === 0) {
      pendingTimers.delete(currentQueryClient);
    }

    for (const prefix of GIT_QUERY_PREFIXES) {
      void currentQueryClient.invalidateQueries({
        queryKey: [prefix, normalized.project, targetKey],
      });
    }
  }, GIT_FS_INVALIDATION_DEBOUNCE_MS);

  targetTimers.set(timerKey, timer);
}
