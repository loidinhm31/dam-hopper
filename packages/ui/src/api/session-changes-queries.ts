/**
 * Owner-fenced TanStack Query hooks for Session Changes.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { ReviewTarget } from "./terminal-session-contract";
import { type ConnectionRef } from "./ownership";
import { profileQueryKey } from "./query-client";
import {
  getBoundApiClient,
  useConfig,
  resolveTargetOwner,
  type OwnerInput,
} from "./queries";
import { useConnectionSnapshot } from "./connections";
import { SessionChangesClient } from "./session-changes-client";
import type {
  Comparison,
  FileDetail,
  FilePage,
  Status,
} from "./session-changes-types";

export const sessionChangesQueryKeys = {
  all: (owner: ConnectionRef) => profileQueryKey(owner, "session-changes"),
  status: (
    owner: ConnectionRef,
    terminalId: string,
    terminalIncarnation: string,
    ompSessionId: string,
    rootId: string = ".",
  ) =>
    profileQueryKey(
      owner,
      "session-changes",
      "status",
      terminalId,
      terminalIncarnation,
      ompSessionId,
      rootId,
    ),
  files: (
    owner: ConnectionRef,
    terminalId: string,
    terminalIncarnation: string,
    ompSessionId: string,
    serverEpoch: string,
    baselineId: string,
    comparisonRevision?: string | null,
    cursor: string | null = null,
    limit: number | null = null,
    rootId: string = ".",
  ) =>
    profileQueryKey(
      owner,
      "session-changes",
      "files",
      terminalId,
      terminalIncarnation,
      ompSessionId,
      serverEpoch,
      baselineId,
      comparisonRevision ?? "initial",
      cursor,
      limit,
      rootId,
    ),
  fileDetail: (
    owner: ConnectionRef,
    terminalId: string,
    terminalIncarnation: string,
    ompSessionId: string,
    serverEpoch: string,
    baselineId: string,
    comparisonRevision: string,
    fileId: string,
    rootId: string = ".",
  ) =>
    profileQueryKey(
      owner,
      "session-changes",
      "file",
      terminalId,
      terminalIncarnation,
      ompSessionId,
      serverEpoch,
      baselineId,
      comparisonRevision,
      fileId,
      rootId,
    ),
};

/**
 * Predicate that matches TanStack query keys against an exact ReviewTarget.
 *
 * Distinguishes 'status', 'files', and 'file' category shapes and checks exact
 * identity tuple (profileId, generation, terminalId, incarnation, ompSessionId, rootId,
 * serverEpoch, baselineId).
 */
export function matchesReviewTargetQuery(
  queryKey: readonly unknown[],
  target: ReviewTarget,
): boolean {
  if (
    queryKey.length < 5 ||
    queryKey[0] !== "profile" ||
    queryKey[1] !== target.profileId ||
    queryKey[2] !== target.generation ||
    queryKey[3] !== "session-changes"
  ) {
    return false;
  }

  const category = queryKey[4];

  if (category === "status") {
    if (
      queryKey[5] === target.terminalId &&
      queryKey[6] === target.terminalIncarnation &&
      queryKey[7] === target.ompSessionId
    ) {
      if (queryKey[8] === undefined || queryKey[8] === target.rootId) {
        return true;
      }
    }
    return false;
  }

  if (category === "files") {
    if (
      queryKey[5] === target.terminalId &&
      queryKey[6] === target.terminalIncarnation &&
      queryKey[7] === target.ompSessionId &&
      queryKey[8] === target.serverEpoch &&
      queryKey[9] === target.baselineId
    ) {
      if (queryKey[13] === undefined || queryKey[13] === target.rootId) {
        return true;
      }
    }
    return false;
  }

  if (category === "file") {
    if (
      queryKey[5] === target.terminalId &&
      queryKey[6] === target.terminalIncarnation &&
      queryKey[7] === target.ompSessionId &&
      queryKey[8] === target.serverEpoch &&
      queryKey[9] === target.baselineId
    ) {
      if (queryKey[12] === undefined || queryKey[12] === target.rootId) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Targeted cancellation for an exact ReviewTarget identity.
 * Does NOT cancel other sessions or sibling review caches under the same owner.
 */
export async function cancelReviewQueries(
  qc: QueryClient,
  target: ReviewTarget,
): Promise<void> {
  await qc.cancelQueries({
    predicate: (query) => matchesReviewTargetQuery(query.queryKey, target),
  });
}

/**
 * Targeted removal for an exact ReviewTarget identity.
 * Does NOT purge sibling review caches under the same owner.
 */
export function removeReviewQueries(
  qc: QueryClient,
  target: ReviewTarget,
): void {
  qc.removeQueries({
    predicate: (query) => matchesReviewTargetQuery(query.queryKey, target),
  });
}

/**
 * Closes a review target safely upon presentation window close:
 * Cancels and removes queries ONLY if no other open window shares that exact review target.
 */
export function closeReviewTargetSafely(
  qc: QueryClient,
  target: ReviewTarget,
  closingWindowId: string,
  sessionWindows: Record<
    string,
    {
      appId?: string;
      runtimeIdentity?: { kind?: string; target?: unknown };
      appState?: Record<string, unknown>;
    }
  >,
): void {
  const hasOtherWindow = Object.entries(sessionWindows).some(([id, w]) => {
    if (id === closingWindowId || w.appId !== "session-changes") return false;
    const otherTarget = (
      w.runtimeIdentity?.kind === "review"
        ? w.runtimeIdentity.target
        : w.appState?.target
    ) as ReviewTarget | undefined;
    if (!otherTarget) return false;
    return (
      otherTarget.terminalId === target.terminalId &&
      otherTarget.terminalIncarnation === target.terminalIncarnation &&
      otherTarget.ompSessionId === target.ompSessionId &&
      otherTarget.serverEpoch === target.serverEpoch &&
      otherTarget.baselineId === target.baselineId
    );
  });
  if (!hasOtherWindow) {
    void cancelReviewQueries(qc, target);
    removeReviewQueries(qc, target);
  }
}

/**
 * Owner-wide purge restricted strictly to retirement, disconnect, or config-disable.
 * Never invoked on normal single-window close.
 */
export async function purgeOwnerReviewQueries(
  qc: QueryClient,
  owner: ConnectionRef,
): Promise<void> {
  const queryKey = sessionChangesQueryKeys.all(owner);
  await qc.cancelQueries({ queryKey });
  qc.removeQueries({ queryKey });
}

function getClient(owner: ConnectionRef): SessionChangesClient {
  const apiClient = getBoundApiClient(owner);
  return new SessionChangesClient({ apiClient });
}

export function useSessionChangesStatus(
  owner: ConnectionRef | undefined,
  terminalId: string,
  terminalIncarnation: string,
  ompSessionId: string,
  rootId: string = ".",
  options?: {
    enabled?: boolean;
    expectedServerEpoch?: string;
  },
) {
  const isEnabled =
    Boolean(owner) &&
    Boolean(terminalId) &&
    Boolean(terminalIncarnation) &&
    Boolean(ompSessionId) &&
    (options?.enabled ?? true);

  return useQuery<Status, Error>({
    queryKey: owner
      ? sessionChangesQueryKeys.status(
          owner,
          terminalId,
          terminalIncarnation,
          ompSessionId,
          rootId,
        )
      : ["session-changes", "status"],
    queryFn: async ({ signal }) => {
      if (!owner) throw new Error("ConnectionRef owner is required");
      const client = getClient(owner);
      return client.getStatus({
        terminalId,
        terminalIncarnation,
        ompSessionId,
        rootId,
        expectedServerEpoch: options?.expectedServerEpoch,
        signal,
      });
    },
    enabled: isEnabled,
    staleTime: 5000,
  });
}

export function useSessionChangesFiles(
  owner: ConnectionRef | undefined,
  terminalId: string,
  terminalIncarnation: string,
  ompSessionId: string,
  serverEpoch: string,
  baselineId: string,
  comparisonRevision?: string | null,
  cursor: string | null = null,
  limit: number | null = null,
  rootId: string = ".",
  options?: {
    enabled?: boolean;
  },
) {
  const isEnabled =
    Boolean(owner) &&
    Boolean(terminalId) &&
    Boolean(terminalIncarnation) &&
    Boolean(ompSessionId) &&
    Boolean(serverEpoch) &&
    Boolean(baselineId) &&
    (options?.enabled ?? true);

  return useQuery<FilePage, Error>({
    queryKey: owner
      ? sessionChangesQueryKeys.files(
          owner,
          terminalId,
          terminalIncarnation,
          ompSessionId,
          serverEpoch,
          baselineId,
          comparisonRevision,
          cursor,
          limit,
          rootId,
        )
      : ["session-changes", "files"],
    queryFn: async ({ signal }) => {
      if (!owner) throw new Error("ConnectionRef owner is required");
      const client = getClient(owner);
      return client.getFiles({
        terminalId,
        terminalIncarnation,
        ompSessionId,
        rootId,
        serverEpoch,
        baselineId,
        comparisonRevision,
        cursor: cursor ?? undefined,
        limit: limit ?? undefined,
        signal,
      });
    },
    enabled: isEnabled,
    staleTime: 10000,
  });
}

export function useSessionChangesFileDetail(
  owner: ConnectionRef | undefined,
  terminalId: string,
  terminalIncarnation: string,
  ompSessionId: string,
  serverEpoch: string,
  baselineId: string,
  comparisonRevision: string,
  fileId: string,
  rootId: string = ".",
  options?: {
    enabled?: boolean;
  },
) {
  const isEnabled =
    Boolean(owner) &&
    Boolean(terminalId) &&
    Boolean(terminalIncarnation) &&
    Boolean(ompSessionId) &&
    Boolean(serverEpoch) &&
    Boolean(baselineId) &&
    Boolean(comparisonRevision) &&
    Boolean(fileId) &&
    (options?.enabled ?? true);

  return useQuery<FileDetail, Error>({
    queryKey: owner
      ? sessionChangesQueryKeys.fileDetail(
          owner,
          terminalId,
          terminalIncarnation,
          ompSessionId,
          serverEpoch,
          baselineId,
          comparisonRevision,
          fileId,
          rootId,
        )
      : ["session-changes", "file"],
    queryFn: async ({ signal }) => {
      if (!owner) throw new Error("ConnectionRef owner is required");
      const client = getClient(owner);
      return client.getFileDetail({
        terminalId,
        terminalIncarnation,
        ompSessionId,
        rootId,
        serverEpoch,
        baselineId,
        comparisonRevision,
        fileId,
        signal,
      });
    },
    enabled: isEnabled,
    staleTime: 30000,
  });
}

export function useSessionChangesRefreshMutation(owner: ConnectionRef | undefined) {
  const qc = useQueryClient();

  return useMutation<
    Comparison,
    Error,
    {
      terminalId: string;
      terminalIncarnation: string;
      ompSessionId: string;
      rootId?: string;
      serverEpoch: string;
      baselineId: string;
      requestId: string;
    }
  >({
    mutationFn: async (params) => {
      if (!owner) throw new Error("ConnectionRef owner is required");
      const client = getClient(owner);
      return client.refreshComparison(params);
    },
    onSuccess: (_, vars) => {
      if (!owner) return;
      void qc.invalidateQueries({
        queryKey: sessionChangesQueryKeys.status(
          owner,
          vars.terminalId,
          vars.terminalIncarnation,
          vars.ompSessionId,
          vars.rootId ?? ".",
        ),
      });
      void qc.invalidateQueries({
        queryKey: sessionChangesQueryKeys.all(owner),
      });
    },
  });
}

export function useSessionChangesEnabled(owner?: OwnerInput): {
  enabled: boolean;
  isLoading: boolean;
  error: unknown;
} {
  const resolved = resolveTargetOwner(owner);
  const { data: config, isLoading, error } = useConfig(resolved);
  const snapshot = useConnectionSnapshot(resolved?.profileId ?? "");
  const isConnected = resolved
    ? snapshot?.status === "connected" &&
      snapshot.owner.generation === resolved.generation
    : true;
  return {
    enabled: Boolean(
      !isLoading && !error && config?.server?.sessionChangesEnabled && isConnected,
    ),
    isLoading,
    error,
  };
}
