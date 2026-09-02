import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ApiRequestError, api } from "./client.js";
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
  overviewRoot: ["workflow", "overview"] as const,
  overview: (transportGeneration: number) =>
    ["workflow", "overview", transportGeneration] as const,
  eventsRoot: ["workflow", "events"] as const,
  events: (cursor?: string | null, limit?: number | null) =>
    [
      "workflow",
      "events",
      { cursor: cursor ?? null, limit: limit ?? null },
    ] as const,
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
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
}

// ── Query Hooks ─────────────────────────────────────────────────────────────

export function useWorkflowOverview(options?: { enabled?: boolean }) {
  const transportGeneration = useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );

  const query = useQuery<OverviewDto>({
    queryKey: workflowQueryKeys.overview(transportGeneration),
    queryFn: () => api.workflow.overview(),
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
  options?: { enabled?: boolean },
) {
  return useQuery<EventsDto>({
    queryKey: workflowQueryKeys.events(query?.cursor, query?.limit),
    queryFn: () => api.workflow.events(query),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    refetchInterval: false,
    enabled: options?.enabled ?? true,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────────────

export function useCreateWorkflowItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateItemRequest) => api.workflow.createItem(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function usePatchWorkflowItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & PatchItemRequest) =>
      api.workflow.patchItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useDeleteWorkflowItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteItemRequest) =>
      api.workflow.deleteItem(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useCreateWorkflowSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSessionRequest) => api.workflow.createSession(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useEndWorkflowSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & EndSessionRequest) =>
      api.workflow.endSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useAbandonWorkflowSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & AbandonSessionRequest) =>
      api.workflow.abandonSession(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useLinkWorkflowResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & LinkResourceRequest) =>
      api.workflow.linkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useUnlinkWorkflowResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      ...req
    }: { sessionId: string } & UnlinkResourceRequest) =>
      api.workflow.unlinkResource(sessionId, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useCreateWorkflowNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateNoteRequest) => api.workflow.createNote(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useDeleteWorkflowNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: { id: string } & DeleteNoteRequest) =>
      api.workflow.deleteNote(id, req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function usePurgeWorkflowHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PurgeHistoryRequest) => api.workflow.purgeHistory(req),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}
