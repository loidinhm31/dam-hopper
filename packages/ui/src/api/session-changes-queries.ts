/**
 * Owner-fenced TanStack Query hooks for Session Changes.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
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
