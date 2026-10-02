import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ConnectionRef,
  AdvisorStatusDto,
  AdvisorSettingsDto,
} from "@/api/client.js";
import {
  getApi,
  isCurrentConnection,
  useConnectionSnapshot,
  getConnectionSnapshot,
} from "@/api/connections.js";
import { checkAuthStatus } from "@/api/auth-client.js";
import { getAuthToken } from "@/api/server-config.js";

/** Query key factory strictly scoped to profile, generation, and query intent. */
export const advisorQueryKeys = {
  all: ["advisor"] as const,
  profile: (
    profileId: string | null | undefined,
    generation: number | undefined,
  ) => ["advisor", profileId ?? "none", generation ?? 0] as const,
  status: (
    profileId: string | null | undefined,
    generation: number | undefined,
  ) => ["advisor", profileId ?? "none", generation ?? 0, "status"] as const,
  auth: (profileId: string | null | undefined) =>
    ["advisor", profileId ?? "none", "auth-status"] as const,
  history: (
    profileId: string | null | undefined,
    generation: number | undefined,
    query?: unknown,
  ) =>
    ["advisor", profileId ?? "none", generation ?? 0, "history", query] as const,
  policy: (
    profileId: string | null | undefined,
    generation: number | undefined,
  ) => ["advisor", profileId ?? "none", generation ?? 0, "policy"] as const,
  evaluations: (
    profileId: string | null | undefined,
    generation: number | undefined,
    query?: unknown,
  ) =>
    ["advisor", profileId ?? "none", generation ?? 0, "evaluations", query] as const,
};

export interface AdvisorAuthStatus {
  isAdmin: boolean;
  isAuthenticated: boolean;
  role: "admin" | "user" | undefined;
  user: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseAdvisorAuthOptions {
  enabled?: boolean;
}

/**
 * Checks authentication status and admin role for a specific profile endpoint.
 * Strict multi-profile isolation: queries ONLY when profileId is provided and
 * connection snapshot is currently "connected". Never falls back to ambient getServerUrl().
 */
export function useAdvisorAuth(
  profileId?: string | null,
  options?: UseAdvisorAuthOptions,
): AdvisorAuthStatus {
  const effectiveProfileId = profileId ?? undefined;
  const snap = effectiveProfileId
    ? getConnectionSnapshot(effectiveProfileId)
    : null;
  const isConnected = snap?.status === "connected";
  const isQueryEnabled = Boolean(
    effectiveProfileId && isConnected && (options?.enabled ?? true),
  );

  const { data, isLoading, error } = useQuery({
    queryKey: advisorQueryKeys.auth(profileId),
    queryFn: async () => {
      if (!effectiveProfileId || !snap || snap.status !== "connected") {
        return {
          authenticated: false,
          user: undefined,
          role: undefined,
        };
      }
      const baseUrl = snap.serverUrl;
      if (!baseUrl) {
        return {
          authenticated: false,
          user: undefined,
          role: undefined,
        };
      }
      const token = getAuthToken(effectiveProfileId);
      const res = await checkAuthStatus(baseUrl, token);
      if (res.authenticated) {
        return {
          authenticated: true,
          user: res.user,
          role: res.role,
        };
      }
      return {
        authenticated: false,
        user: undefined,
        role: undefined,
      };
    },
    enabled: isQueryEnabled,
    staleTime: 30_000,
  });

  return useMemo(
    () => ({
      isAdmin: data?.role === "admin",
      isAuthenticated: Boolean(data?.authenticated),
      role: data?.role,
      user: data?.user,
      isLoading: isQueryEnabled ? isLoading : false,
      error: error instanceof Error ? error : error ? new Error(String(error)) : null,
    }),
    [data, isLoading, isQueryEnabled, error],
  );
}

export interface UseAdvisorStatusOptions {
  enabled?: boolean;
}

/**
 * Reads server-level Advisor status (enabled, available, path, sourceError).
 * Strictly bound to owner ConnectionRef; disabled when owner is missing, stale, or disabled.
 */
export function useAdvisorStatus(
  owner?: ConnectionRef | null,
  options?: UseAdvisorStatusOptions,
) {
  const isOwnerCurrent = Boolean(owner && isCurrentConnection(owner));
  const isQueryEnabled = isOwnerCurrent && (options?.enabled ?? true);

  return useQuery({
    queryKey: advisorQueryKeys.status(owner?.profileId, owner?.generation),
    queryFn: async (): Promise<AdvisorStatusDto> => {
      if (!owner || !isCurrentConnection(owner)) {
        throw new Error("Advisor status query requires a current connection owner");
      }
      const client = getApi(owner);
      return client.advisor.status();
    },
    enabled: isQueryEnabled,
    staleTime: 30_000,
  });
}

export interface AdvisorVisibilityResult {
  /** Combined predicate: connected + admin + enabled */
  isVisible: boolean;
  isConnected: boolean;
  isAdmin: boolean;
  isEnabled: boolean;
  isAvailable: boolean;
  path: string | null;
  sourceError: string | null;
  status: AdvisorStatusDto | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/**
 * Single visibility predicate for all Workspace and launcher surfaces:
 * connected + admin + enabled.
 * History absence (available: false) still renders if enabled, but disabled/non-admin/disconnected
 * are completely hidden and make no data queries.
 */
export function useAdvisorVisibility(
  owner?: ConnectionRef | null,
): AdvisorVisibilityResult {
  const connectionSnapshot = useConnectionSnapshot(owner?.profileId ?? "");
  const isConnected = Boolean(
    owner &&
      isCurrentConnection(owner) &&
      connectionSnapshot?.status === "connected",
  );
  const auth = useAdvisorAuth(owner?.profileId, { enabled: isConnected });
  const isAdmin = auth.isAdmin;
  // Only query Advisor status when connected and caller has admin role
  const statusQuery = useAdvisorStatus(owner, {
    enabled: isConnected && isAdmin,
  });

  const isEnabled = Boolean(statusQuery.data?.enabled);
  const isVisible = isConnected && isAdmin && isEnabled;

  return useMemo(
    () => ({
      isVisible,
      isConnected,
      isAdmin,
      isEnabled,
      isAvailable: Boolean(statusQuery.data?.available),
      path: statusQuery.data?.path ?? null,
      sourceError: statusQuery.data?.sourceError ?? null,
      status: statusQuery.data,
      isLoading: auth.isLoading || statusQuery.isLoading,
      error: auth.error ?? (statusQuery.error instanceof Error ? statusQuery.error : null),
      refetch: statusQuery.refetch,
    }),
    [
      isVisible,
      isConnected,
      isAdmin,
      isEnabled,
      statusQuery.data,
      statusQuery.isLoading,
      statusQuery.error,
      statusQuery.refetch,
      auth.isLoading,
      auth.error,
    ],
  );
}

export interface AdvisorToggleResult {
  result: AdvisorSettingsDto;
  capturedOwner: ConnectionRef;
  capturedValue: boolean;
}

/**
 * Admin mutation for toggling Advisor on/off for a server.
 * Captures owner and intended value before dispatch, and invalidates ONLY the captured owner.
 */
export function useAdvisorToggle(owner?: ConnectionRef | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intendedEnabled: boolean): Promise<AdvisorToggleResult> => {
      if (!owner || !isCurrentConnection(owner)) {
        throw new Error("Advisor toggle requires an active connection owner");
      }
      const capturedOwner: ConnectionRef = {
        profileId: owner.profileId,
        generation: owner.generation,
      };
      const capturedValue = intendedEnabled;
      const client = getApi(capturedOwner);
      const result = await client.advisor.updateSettings({
        enabled: capturedValue,
      });
      return { result, capturedOwner, capturedValue };
    },
    onSuccess: ({ capturedOwner }) => {
      // Invalidate status for this captured owner only
      void queryClient.invalidateQueries({
        queryKey: advisorQueryKeys.status(
          capturedOwner.profileId,
          capturedOwner.generation,
        ),
      });
      // Invalidate general advisor domain queries for this captured owner
      void queryClient.invalidateQueries({
        queryKey: advisorQueryKeys.profile(
          capturedOwner.profileId,
          capturedOwner.generation,
        ),
      });
    },
  });
}
