// Project Plans Dashboard queries and owner-bound fencing — Phase 03
// Aligned with contracts.md section 2 and phase-03-owner-bound-client-and-refresh.md

import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { profileQueryKey } from "./query-client.js";
import {
  type ConnectionRef,
  type ProjectTargetRef,
  normalizeProjectTargetRef,
  ConnectionOwnerError,
} from "./ownership.js";
import {
  type ProjectTargetInput,
  type ApiClient,
  ApiRequestError,
  normalizeProjectTarget,
} from "./client.js";
import { getApi, isCurrentConnection } from "./connections.js";
import {
  type PlanFoldersResponse,
  type SelectedPlanResponse,
  decodePlanFoldersResponse,
  decodeSelectedPlanResponse,
} from "./project-plans-types.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

// ── Path Normalization ──────────────────────────────────────────────────────

export function normalizePlansBrowsePath(browsePath?: string | null): string {
  if (!browsePath || browsePath.trim() === "") return "plans";
  const normalized = normalizeProjectTargetPath(browsePath);
  return normalized === "." || normalized === "" ? "plans" : normalized;
}

export function normalizePlanPath(planPath: string): string {
  return normalizeProjectTargetPath(planPath);
}

export function normalizePlanDocumentPath(documentPath: string): string {
  return normalizeProjectTargetPath(documentPath);
}

function resolveNormalizedTarget(target: ProjectTargetInput): ProjectTargetRef {
  const norm = normalizeProjectTarget(target);
  return normalizeProjectTargetRef({
    project: norm.project,
    worktreePath: norm.worktreePath,
    profileId: norm.profileId,
  });
}

// ── Query Key Builders ──────────────────────────────────────────────────────

export function planFoldersQueryKey(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  browsePath?: string | null,
): QueryKey {
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(
    owner,
    "plan-folders",
    t.project,
    t.worktreePath,
    normalizePlansBrowsePath(browsePath),
  );
}

export function selectedPlanQueryKey(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  planPath: string,
): QueryKey {
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(
    owner,
    "plan",
    t.project,
    t.worktreePath,
    normalizePlanPath(planPath),
  );
}

export function planDocumentQueryKey(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  documentPath: string,
  mode: "plan-document" = "plan-document",
): QueryKey {
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(
    owner,
    "plan-document",
    t.project,
    t.worktreePath,
    normalizePlanDocumentPath(documentPath),
    mode,
  );
}

export function planFoldersPrefix(
  owner: ConnectionRef,
  target?: ProjectTargetInput,
): QueryKey {
  if (!target) return profileQueryKey(owner, "plan-folders");
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(owner, "plan-folders", t.project, t.worktreePath);
}

export function selectedPlanPrefix(
  owner: ConnectionRef,
  target?: ProjectTargetInput,
): QueryKey {
  if (!target) return profileQueryKey(owner, "plan");
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(owner, "plan", t.project, t.worktreePath);
}

export function planDocumentPrefix(
  owner: ConnectionRef,
  target?: ProjectTargetInput,
): QueryKey {
  if (!target) return profileQueryKey(owner, "plan-document");
  const t = resolveNormalizedTarget(target);
  return profileQueryKey(owner, "plan-document", t.project, t.worktreePath);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function decodeBase64Utf8(base64: string): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function assertOwnerActive(owner: ConnectionRef): void {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or not connected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
}

// ── Query Fetchers ──────────────────────────────────────────────────────────

export async function fetchPlanFolders(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  browsePath?: string | null,
  signal?: AbortSignal,
  client?: ApiClient,
): Promise<PlanFoldersResponse> {
  assertOwnerActive(owner);
  const apiClient = client ?? getApi(owner);
  const normalizedPath = normalizePlansBrowsePath(browsePath);

  const res = await apiClient.plans.folders(target, normalizedPath);
  if (signal?.aborted) {
    throw new DOMException("Fetch plan folders cancelled", "AbortError");
  }
  assertOwnerActive(owner);
  return decodePlanFoldersResponse(res);
}

export async function fetchSelectedPlan(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  planPath: string,
  signal?: AbortSignal,
  client?: ApiClient,
): Promise<SelectedPlanResponse> {
  assertOwnerActive(owner);
  const apiClient = client ?? getApi(owner);
  const normalizedPath = normalizePlanPath(planPath);

  const res = await apiClient.plans.read(target, normalizedPath);
  if (signal?.aborted) {
    throw new DOMException("Fetch selected plan cancelled", "AbortError");
  }
  assertOwnerActive(owner);
  return decodeSelectedPlanResponse(res);
}

export async function fetchPlanDocument(
  owner: ConnectionRef,
  target: ProjectTargetInput,
  documentPath: string,
  signal?: AbortSignal,
  client?: ApiClient,
): Promise<string> {
  assertOwnerActive(owner);
  const apiClient = client ?? getApi(owner);
  const normalizedPath = normalizePlanDocumentPath(documentPath);

  const res = await apiClient.fs.read(target, normalizedPath, {
    mode: "plan-document",
  });
  if (signal?.aborted) {
    throw new DOMException("Fetch plan document cancelled", "AbortError");
  }
  assertOwnerActive(owner);

  if (!res.ok) {
    const message =
      "message" in res && typeof res.message === "string"
        ? res.message
        : `Failed to read document (${res.code})`;
    throw new ApiRequestError(
      message,
      res.code === "NOT_FOUND" ? 404 : 400,
      res.code,
    );
  }
  return decodeBase64Utf8(res.content);
}

// ── Query Option Factories ──────────────────────────────────────────────────

export function planFoldersQueryOptions(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  browsePath?: string | null,
  options?: { enabled?: boolean; client?: ApiClient },
): UseQueryOptions<PlanFoldersResponse, Error> {
  const isEnabled = Boolean(owner && target && (options?.enabled ?? true));
  const queryKey =
    owner && target
      ? planFoldersQueryKey(owner, target, browsePath)
      : ["plan-folders-disabled"];

  return {
    queryKey,
    queryFn: ({ signal }) => {
      if (!owner || !target) {
        throw new Error("Missing owner or target for plan-folders query");
      }
      return fetchPlanFolders(owner, target, browsePath, signal, options?.client);
    },
    enabled: isEnabled,
    staleTime: Infinity,
  };
}

export function selectedPlanQueryOptions(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  planPath: string | null | undefined,
  options?: { enabled?: boolean; client?: ApiClient },
): UseQueryOptions<SelectedPlanResponse, Error> {
  const isEnabled = Boolean(owner && target && planPath && (options?.enabled ?? true));
  const queryKey =
    owner && target && planPath
      ? selectedPlanQueryKey(owner, target, planPath)
      : ["selected-plan-disabled"];

  return {
    queryKey,
    queryFn: ({ signal }) => {
      if (!owner || !target || !planPath) {
        throw new Error("Missing owner, target, or planPath for plan query");
      }
      return fetchSelectedPlan(owner, target, planPath, signal, options?.client);
    },
    enabled: isEnabled,
    staleTime: Infinity,
  };
}

export function planDocumentQueryOptions(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  documentPath: string | null | undefined,
  options?: { enabled?: boolean; client?: ApiClient },
): UseQueryOptions<string, Error> {
  const isEnabled = Boolean(
    owner && target && documentPath && (options?.enabled ?? true),
  );
  const queryKey =
    owner && target && documentPath
      ? planDocumentQueryKey(owner, target, documentPath)
      : ["plan-document-disabled"];

  return {
    queryKey,
    queryFn: ({ signal }) => {
      if (!owner || !target || !documentPath) {
        throw new Error("Missing owner, target, or documentPath for document query");
      }
      return fetchPlanDocument(
        owner,
        target,
        documentPath,
        signal,
        options?.client,
      );
    },
    enabled: isEnabled,
    staleTime: Infinity,
  };
}

// ── React Hooks ─────────────────────────────────────────────────────────────

export function usePlanFoldersQuery(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  browsePath?: string | null,
  options?: { enabled?: boolean; client?: ApiClient },
) {
  return useQuery(planFoldersQueryOptions(owner, target, browsePath, options));
}

export function useSelectedPlanQuery(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  planPath: string | null | undefined,
  options?: { enabled?: boolean; client?: ApiClient },
) {
  return useQuery(selectedPlanQueryOptions(owner, target, planPath, options));
}

export function usePlanDocumentQuery(
  owner: ConnectionRef | null | undefined,
  target: ProjectTargetInput | null | undefined,
  documentPath: string | null | undefined,
  options?: { enabled?: boolean; client?: ApiClient },
) {
  return useQuery(planDocumentQueryOptions(owner, target, documentPath, options));
}
