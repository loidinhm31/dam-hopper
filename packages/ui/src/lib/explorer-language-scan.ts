import type { QueryClient } from "@tanstack/react-query";
import type { LanguageFilesResponse } from "@/api/fs-types.js";

export const EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX =
  "explorer-language-scan" as const;

export interface ExplorerLanguageScanCache {
  result: LanguageFilesResponse | null;
  generation: number;
  stale: boolean;
  /** Epoch milliseconds for the last completed scan, including stale results. */
  scannedAt: number | null;
}

type ExplorerLanguageScanCacheQueryClient = Pick<
  QueryClient,
  "getQueryData" | "setQueryData"
>;
type ExplorerLanguageScanCleanupClient = Pick<QueryClient, "removeQueries">;

export interface ExplorerLanguageScanToken {
  generation: number;
  workspaceEpoch: number;
  requestId: number;
}

interface ExplorerLanguageScanRuntime {
  workspaceEpoch: number;
  nextRequestId: number;
  latestRequestByProject: Map<string, number>;
}

const runtimes = new WeakMap<object, ExplorerLanguageScanRuntime>();

function runtimeFor(queryClient: object): ExplorerLanguageScanRuntime {
  let runtime = runtimes.get(queryClient);
  if (!runtime) {
    runtime = {
      workspaceEpoch: 0,
      nextRequestId: 0,
      latestRequestByProject: new Map(),
    };
    runtimes.set(queryClient, runtime);
  }
  return runtime;
}

export function explorerLanguageScanQueryKey(project: string) {
  return [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX, project] as const;
}

export function emptyExplorerLanguageScanCache(): ExplorerLanguageScanCache {
  return {
    result: null,
    generation: 0,
    stale: true,
    scannedAt: null,
  };
}

export function getExplorerLanguageScanCache(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string,
): ExplorerLanguageScanCache | undefined {
  return queryClient.getQueryData<ExplorerLanguageScanCache>(
    explorerLanguageScanQueryKey(project),
  );
}

/** Create a placeholder only when an explicit scan needs a cache entry. */
export function beginExplorerLanguageScan(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string,
): ExplorerLanguageScanToken {
  const runtime = runtimeFor(queryClient);
  const current = getExplorerLanguageScanCache(queryClient, project);
  if (!current) {
    queryClient.setQueryData(
      explorerLanguageScanQueryKey(project),
      emptyExplorerLanguageScanCache(),
    );
  }
  const requestId = ++runtime.nextRequestId;
  runtime.latestRequestByProject.set(project, requestId);
  return {
    generation: current?.generation ?? 0,
    workspaceEpoch: runtime.workspaceEpoch,
    requestId,
  };
}

/** Mark a project result stale without invalidating or refetching a query. */
export function markExplorerLanguageScanStale(
  queryClient: ExplorerLanguageScanCacheQueryClient,
  project: string,
  workspaceEpoch?: number,
): void {
  const runtime = runtimeFor(queryClient);
  if (
    workspaceEpoch !== undefined &&
    runtime.workspaceEpoch !== workspaceEpoch
  ) {
    return;
  }
  const current = getExplorerLanguageScanCache(queryClient, project);
  if (!current) return;
  queryClient.setQueryData(explorerLanguageScanQueryKey(project), {
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
  project: string,
  scanToken: ExplorerLanguageScanToken,
  result: LanguageFilesResponse,
  scannedAt = Date.now(),
): void {
  const runtime = runtimeFor(queryClient);
  if (
    runtime.workspaceEpoch !== scanToken.workspaceEpoch ||
    runtime.latestRequestByProject.get(project) !== scanToken.requestId
  ) {
    return;
  }
  const current = getExplorerLanguageScanCache(queryClient, project);
  if (!current) return;

  queryClient.setQueryData(explorerLanguageScanQueryKey(project), {
    result,
    generation: current.generation,
    stale: current.generation !== scanToken.generation,
    scannedAt,
  } satisfies ExplorerLanguageScanCache);
}

export function explorerLanguageScanWorkspaceEpoch(
  queryClient: ExplorerLanguageScanCacheQueryClient,
): number {
  return runtimeFor(queryClient).workspaceEpoch;
}

export function removeExplorerLanguageScanCaches(
  queryClient: ExplorerLanguageScanCleanupClient,
): void {
  const runtime = runtimeFor(queryClient);
  runtime.workspaceEpoch += 1;
  runtime.latestRequestByProject.clear();
  queryClient.removeQueries({
    queryKey: [EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX],
  });
}
