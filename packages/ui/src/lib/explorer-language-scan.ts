import type { QueryClient } from "@tanstack/react-query";
import type { LanguageFilesResponse } from "@/api/fs-types.js";

export const EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX =
  "explorer-language-scan" as const;

export interface ExplorerLanguageScanCache {
  result: LanguageFilesResponse | null;
  generation: number;
  /** Increments for every committed result, including same-generation rescans. */
  resultVersion: number;
  stale: boolean;
  /** Epoch milliseconds for the last completed scan, including stale results. */
  scannedAt: number | null;
}

type ExplorerLanguageScanCacheQueryClient = Pick<
  QueryClient,
  "getQueryData" | "setQueryData"
>;
type ExplorerLanguageScanCleanupClient = Pick<
  QueryClient,
  "removeQueries" | "resetQueries" | "setQueriesData"
>;

export interface ExplorerLanguageScanToken {
  generation: number;
  workspaceEpoch: number;
  requestId: number;
}

export interface ExplorerLanguageScanCommitResult {
  committed: boolean;
  cache: ExplorerLanguageScanCache | undefined;
}

interface ExplorerLanguageScanRuntime {
  workspaceEpoch: number;
  nextRequestId: number;
  latestRequestByProject: Map<string, number>;
  epochsByScope: Map<string, number>;
}

const runtimes = new WeakMap<object, ExplorerLanguageScanRuntime>();

function runtimeFor(queryClient: object): ExplorerLanguageScanRuntime {
  let runtime = runtimes.get(queryClient);
  if (!runtime) {
    runtime = {
      workspaceEpoch: 0,
      nextRequestId: 0,
      latestRequestByProject: new Map(),
      epochsByScope: new Map(),
    };
    runtimes.set(queryClient, runtime);
  }
  return runtime;
}

export function explorerLanguageScanScopeKey(
  project: string | { profileId?: string; project: string },
  targetKey = "root",
): string {
  if (typeof project === "object" && project !== null && project.profileId) {
    return `${project.profileId}::${project.project}::${targetKey}`;
  }
  const projectName = typeof project === "string" ? project : project.project;
  return `${projectName}::${targetKey}`;
}

export function explorerLanguageScanQueryKey(
  project: string | { profileId?: string; project: string },
  targetKey = "root",
) {
  if (typeof project === "object" && project !== null && project.profileId) {
    return [
      EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX,
      project.profileId,
      project.project,
      targetKey,
    ] as const;
  }
  const projectName = typeof project === "string" ? project : project.project;
  return [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX, projectName, targetKey] as const;
}
export function emptyExplorerLanguageScanCache(): ExplorerLanguageScanCache {
  return {
    result: null,
    generation: 0,
    resultVersion: 0,
    stale: true,
    scannedAt: null,
  };
}

export function getExplorerLanguageScanCache(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string | { profileId?: string; project: string },
  targetKey = "root",
): ExplorerLanguageScanCache | undefined {
  return queryClient.getQueryData<ExplorerLanguageScanCache>(
    explorerLanguageScanQueryKey(project, targetKey),
  );
}

/** Create a placeholder only when an explicit scan needs a cache entry. */
export function beginExplorerLanguageScan(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string | { profileId?: string; project: string },
  targetKey = "root",
): ExplorerLanguageScanToken {
  const runtime = runtimeFor(queryClient);
  const scopeKey = explorerLanguageScanScopeKey(project, targetKey);
  const current = getExplorerLanguageScanCache(queryClient, project, targetKey);
  if (!current) {
    queryClient.setQueryData(
      explorerLanguageScanQueryKey(project, targetKey),
      emptyExplorerLanguageScanCache(),
    );
  }
  const requestId = ++runtime.nextRequestId;
  runtime.latestRequestByProject.set(scopeKey, requestId);
  const epoch = runtime.epochsByScope.get(scopeKey) ?? runtime.workspaceEpoch;
  return {
    generation: current?.generation ?? 0,
    workspaceEpoch: epoch,
    requestId,
  };
}

/** Mark a project result stale without invalidating or refetching a query. */
export function markExplorerLanguageScanStale(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string | { profileId?: string; project: string },
  workspaceEpoch?: number,
  targetKey = "root",
): void {
  const runtime = runtimeFor(queryClient);
  const scopeKey = explorerLanguageScanScopeKey(project, targetKey);
  const currentEpoch =
    runtime.epochsByScope.get(scopeKey) ?? runtime.workspaceEpoch;
  if (workspaceEpoch !== undefined && currentEpoch !== workspaceEpoch) {
    return;
  }
  const current = getExplorerLanguageScanCache(queryClient, project, targetKey);
  if (!current) return;
  queryClient.setQueryData(explorerLanguageScanQueryKey(project, targetKey), {
    ...current,
    generation: current.generation + 1,
    stale: true,
  });
}

/**
 * Store a response only if the workspace still has this project's cache.
 * A filesystem event that arrived during the scan keeps the response usable
 * while retaining stale=true through the generation comparison.
 */
export function commitExplorerLanguageScan(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string | { profileId?: string; project: string },
  scanToken: ExplorerLanguageScanToken,
  result: LanguageFilesResponse,
  scannedAt = Date.now(),
  targetKey = "root",
): ExplorerLanguageScanCommitResult {
  const runtime = runtimeFor(queryClient);
  const scopeKey = explorerLanguageScanScopeKey(project, targetKey);
  const current = getExplorerLanguageScanCache(queryClient, project, targetKey);
  const currentEpoch =
    runtime.epochsByScope.get(scopeKey) ?? runtime.workspaceEpoch;
  if (
    currentEpoch !== scanToken.workspaceEpoch ||
    runtime.latestRequestByProject.get(scopeKey) !== scanToken.requestId
  ) {
    return { committed: false, cache: current };
  }
  if (!current) return { committed: false, cache: undefined };

  const cache = {
    result,
    generation: current.generation,
    resultVersion: current.resultVersion + 1,
    stale: current.generation !== scanToken.generation,
    scannedAt,
  } satisfies ExplorerLanguageScanCache;
  queryClient.setQueryData(
    explorerLanguageScanQueryKey(project, targetKey),
    cache,
  );
  return { committed: true, cache };
}

export function explorerLanguageScanWorkspaceEpoch(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project?: string | { profileId?: string; project: string },
  targetKey = "root",
): number {
  const runtime = runtimeFor(queryClient);
  if (project !== undefined) {
    const scopeKey = explorerLanguageScanScopeKey(project, targetKey);
    return runtime.epochsByScope.get(scopeKey) ?? runtime.workspaceEpoch;
  }
  return runtime.workspaceEpoch;
}
export function removeExplorerLanguageScanCaches(
  queryClient: ExplorerLanguageScanCleanupClient,
  scopeFilter?: string | { profileId?: string },
): Promise<void> {
  const runtime = runtimeFor(queryClient);
  const profileId =
    typeof scopeFilter === "string"
      ? scopeFilter
      : scopeFilter?.profileId;

  if (profileId) {
    // Scope invalidation to this profile only
    for (const [scopeKey] of runtime.epochsByScope) {
      if (scopeKey.startsWith(`${profileId}::`)) {
        runtime.epochsByScope.set(
          scopeKey,
          (runtime.epochsByScope.get(scopeKey) ?? 0) + 1,
        );
      }
    }
    for (const [scopeKey] of runtime.latestRequestByProject) {
      if (scopeKey.startsWith(`${profileId}::`)) {
        runtime.latestRequestByProject.delete(scopeKey);
      }
    }
    const queryPrefix = [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX, profileId];
    queryClient.setQueriesData<ExplorerLanguageScanCache>(
      { queryKey: queryPrefix },
      () => emptyExplorerLanguageScanCache(),
    );
    return queryClient
      .resetQueries({ queryKey: queryPrefix })
      .then(() => {
        queryClient.removeQueries({ queryKey: queryPrefix });
      });
  }

  runtime.workspaceEpoch += 1;
  runtime.epochsByScope.clear();
  runtime.latestRequestByProject.clear();
  const cleanupEpoch = runtime.workspaceEpoch;
  const cleanupRequestId = runtime.nextRequestId;
  queryClient.setQueriesData<ExplorerLanguageScanCache>(
    { queryKey: [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX] },
    () => emptyExplorerLanguageScanCache(),
  );
  return queryClient
    .resetQueries({
      queryKey: [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX],
    })
    .then(() => {
      if (
        runtime.workspaceEpoch !== cleanupEpoch ||
        runtime.nextRequestId !== cleanupRequestId
      ) {
        return;
      }
      queryClient.removeQueries({
        queryKey: [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX],
      });
    });
}
