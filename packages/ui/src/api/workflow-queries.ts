import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ApiRequestError, api } from "./client.js";
import { getApi, getConnectionSnapshot } from "./connections.js";
import type { ConnectionRef, ProfileId } from "./ownership.js";
import {
  profileQueryKey,
  profileWorkflowOverviewQueryKey,
} from "./query-client.js";
import {
  getTransportGeneration,
  subscribeTransportChanges,
} from "./transport.js";
import type {
  AbandonSessionRequest,
  CreateItemRequest,
  CreateNoteRequest,
  CreateSessionRequest,
  DeleteItemRequest,
  DeleteNoteRequest,
  EndSessionRequest,
  EventsDto,
  EventsQuery,
  LinkResourceRequest,
  OverviewDto,
  PatchItemRequest,
  PurgeHistoryRequest,
  UnlinkResourceRequest,
} from "./workflow-types.js";

// ── Query Keys ──────────────────────────────────────────────────────────────

export type WorkflowOverviewAvailability =
  | "loading"
  | "available"
  | "unavailable"
  | "error";

/** Classify only the overview's profile-scoped 404 as feature unavailable. */
export function classifyWorkflowOverviewError(
  error: unknown,
): "unavailable" | "error" {
  return error instanceof ApiRequestError && error.status === 404
    ? "unavailable"
    : "error";
}

export function isWorkflowOverviewUnavailable(error: unknown): boolean {
  return classifyWorkflowOverviewError(error) === "unavailable";
}

export const workflowQueryKeys = {
  all: ["workflow"] as const,
  byOwner: (owner: ConnectionRef) => profileQueryKey(owner, "workflow"),
  overviewRoot: ["workflow", "overview"] as const,
  overview: (ownerOrGeneration: ConnectionRef | number) =>
    typeof ownerOrGeneration === "object" && ownerOrGeneration !== null
      ? profileWorkflowOverviewQueryKey(ownerOrGeneration)
      : (["workflow", "overview", ownerOrGeneration] as const),
  eventsRoot: ["workflow", "events"] as const,
  events: (
    cursor?: string | null,
    limit?: number | null,
    owner?: ConnectionRef,
  ) =>
    owner
      ? profileQueryKey(owner, "workflow", "events", {
          cursor: cursor ?? null,
          limit: limit ?? null,
        })
      : ([
          "workflow",
          "events",
          { cursor: cursor ?? null, limit: limit ?? null },
        ] as const),
};

// ── Request ID & Invalidation Helpers ───────────────────────────────────────

export function generateWorkflowRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4 generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function resolveWorkflowOwner(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}): ConnectionRef | undefined {
  if (options?.owner) return options.owner;
  if (options?.profileId) {
    const snap = getConnectionSnapshot(options.profileId);
    return snap ? snap.owner : undefined;
  }
  return undefined;
}

export function invalidateWorkflowQueries(
  queryClient: QueryClient,
  ownerOrOptions?: ConnectionRef | { owner?: ConnectionRef; profileId?: ProfileId },
): Promise<void> {
  const owner =
    typeof ownerOrOptions === "object" && ownerOrOptions !== null && "generation" in ownerOrOptions
      ? (ownerOrOptions as ConnectionRef)
      : resolveWorkflowOwner(ownerOrOptions as { owner?: ConnectionRef; profileId?: ProfileId } | undefined);
  return queryClient.invalidateQueries({
    queryKey: owner ? profileQueryKey(owner, "workflow") : workflowQueryKeys.all,
  });
}
// ── Query Hooks ─────────────────────────────────────────────────────────────

export function useWorkflowOverview(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
  enabled?: boolean;
}) {
  const transportGeneration = useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );
  const owner = resolveWorkflowOwner(options);

  const queryKey = owner
    ? workflowQueryKeys.overview(owner)
    : workflowQueryKeys.overview(transportGeneration);

  const query = useQuery<OverviewDto>({
    queryKey,
    queryFn: () =>
      owner
        ? getApi(owner).workflow.overview()
        : api.workflow.overview(),
    staleTime: 0,
    refetchInterval: false,
    retry: (failureCount, error) =>
      isWorkflowOverviewUnavailable(error) ? false : failureCount < 1,
    enabled: options?.enabled ?? true,
  });

  const availability: WorkflowOverviewAvailability = query.isPending
    ? "loading"
    : query.isError
      ? classifyWorkflowOverviewError(query.error)
      : "available";

  return {
    ...query,
    availability,
    isUnavailable: availability === "unavailable",
  };
}

export function useWorkflowEvents(
  query?: EventsQuery,
  options?: { owner?: ConnectionRef; profileId?: ProfileId; enabled?: boolean },
) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = workflowQueryKeys.events(
    query?.cursor,
    query?.limit,
    owner,
  );
  return useQuery<EventsDto>({
    queryKey,
    queryFn: () =>
      owner
        ? getApi(owner).workflow.events(query)
        : api.workflow.events(query),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    refetchInterval: false,
    enabled: options?.enabled ?? true,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────────────

export function useCreateWorkflowItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (req: CreateItemRequest) =>
      owner ? getApi(owner).workflow.createItem(req) : api.workflow.createItem(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function usePatchWorkflowItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & PatchItemRequest) =>
      owner
        ? getApi(owner).workflow.patchItem(id, req)
        : api.workflow.patchItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useDeleteWorkflowItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteItemRequest) =>
      owner
        ? getApi(owner).workflow.deleteItem(id, req)
        : api.workflow.deleteItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useCreateWorkflowSession(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (req: CreateSessionRequest) =>
      owner
        ? getApi(owner).workflow.createSession(req)
        : api.workflow.createSession(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useEndWorkflowSession(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & EndSessionRequest) =>
      owner
        ? getApi(owner).workflow.endSession(id, req)
        : api.workflow.endSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useAbandonWorkflowSession(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & AbandonSessionRequest) =>
      owner
        ? getApi(owner).workflow.abandonSession(id, req)
        : api.workflow.abandonSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useLinkWorkflowResource(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & LinkResourceRequest) =>
      owner
        ? getApi(owner).workflow.linkResource(sessionId, req)
        : api.workflow.linkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useUnlinkWorkflowResource(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & UnlinkResourceRequest) =>
      owner
        ? getApi(owner).workflow.unlinkResource(sessionId, req)
        : api.workflow.unlinkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useCreateWorkflowNote(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (req: CreateNoteRequest) =>
      owner
        ? getApi(owner).workflow.createNote(req)
        : api.workflow.createNote(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function useDeleteWorkflowNote(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteNoteRequest) =>
      owner
        ? getApi(owner).workflow.deleteNote(id, req)
        : api.workflow.deleteNote(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}

export function usePurgeWorkflowHistory(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const queryClient = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (req: PurgeHistoryRequest) =>
      owner
        ? getApi(owner).workflow.purgeHistory(req)
        : api.workflow.purgeHistory(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, owner),
  });
}
