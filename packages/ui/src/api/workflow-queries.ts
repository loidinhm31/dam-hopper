import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ApiRequestError, api } from "./client.js";
import { getApi } from "./connections.js";
import type { ConnectionRef } from "./ownership.js";
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

export function invalidateWorkflowQueries(
  queryClient: QueryClient,
  owner?: ConnectionRef,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: owner ? profileQueryKey(owner, "workflow") : workflowQueryKeys.all,
  });
}

// ── Query Hooks ─────────────────────────────────────────────────────────────

export function useWorkflowOverview(options?: {
  owner?: ConnectionRef;
  enabled?: boolean;
}) {
  const transportGeneration = useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );

  const queryKey = options?.owner
    ? workflowQueryKeys.overview(options.owner)
    : workflowQueryKeys.overview(transportGeneration);

  const query = useQuery<OverviewDto>({
    queryKey,
    queryFn: () =>
      options?.owner
        ? getApi(options.owner).workflow.overview()
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
  options?: { owner?: ConnectionRef; enabled?: boolean },
) {
  const queryKey = workflowQueryKeys.events(
    query?.cursor,
    query?.limit,
    options?.owner,
  );
  return useQuery<EventsDto>({
    queryKey,
    queryFn: () =>
      options?.owner
        ? getApi(options.owner).workflow.events(query)
        : api.workflow.events(query),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    refetchInterval: false,
    enabled: options?.enabled ?? true,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────────────

export function useCreateWorkflowItem(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateItemRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.createItem(req)
        : api.workflow.createItem(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function usePatchWorkflowItem(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & PatchItemRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.patchItem(id, req)
        : api.workflow.patchItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useDeleteWorkflowItem(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteItemRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.deleteItem(id, req)
        : api.workflow.deleteItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useCreateWorkflowSession(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSessionRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.createSession(req)
        : api.workflow.createSession(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useEndWorkflowSession(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & EndSessionRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.endSession(id, req)
        : api.workflow.endSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useAbandonWorkflowSession(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & AbandonSessionRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.abandonSession(id, req)
        : api.workflow.abandonSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useLinkWorkflowResource(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & LinkResourceRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.linkResource(sessionId, req)
        : api.workflow.linkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useUnlinkWorkflowResource(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & UnlinkResourceRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.unlinkResource(sessionId, req)
        : api.workflow.unlinkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useCreateWorkflowNote(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateNoteRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.createNote(req)
        : api.workflow.createNote(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function useDeleteWorkflowNote(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteNoteRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.deleteNote(id, req)
        : api.workflow.deleteNote(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}

export function usePurgeWorkflowHistory(options?: { owner?: ConnectionRef }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PurgeHistoryRequest) =>
      options?.owner
        ? getApi(options.owner).workflow.purgeHistory(req)
        : api.workflow.purgeHistory(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient, options?.owner),
  });
}
