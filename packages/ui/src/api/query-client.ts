import { getActiveProfileId } from "./server-config.js";
import type { QueryKey } from "@tanstack/react-query";
import type { ConnectionRef, ProfileId } from "./ownership.js";

/** Key builder for owner-scoped queries: ['profile', profileId, generation, ...parts] */
export function profileQueryKey(
  owner: ConnectionRef,
  ...parts: unknown[]
): QueryKey {
  return ["profile", owner.profileId, owner.generation, ...parts];
}

/** Prefix builder for invalidating or matching all queries for a profile across all generations */
export function profileQueryPrefix(profileId: ProfileId): QueryKey {
  return ["profile", profileId];
}

/** Prefix builder for invalidating or matching queries for a specific connection generation */
export function profileGenerationQueryPrefix(owner: ConnectionRef): QueryKey {
  return ["profile", owner.profileId, owner.generation];
}

export function profileProjectsQueryKey(owner: ConnectionRef): QueryKey {
  return profileQueryKey(owner, "projects");
}

export function profileGitQueryKey(
  owner: ConnectionRef,
  project: string,
  normalizedWorktreeOrNull: string | null,
  ...parts: unknown[]
): QueryKey {
  return profileQueryKey(owner, "git", project, normalizedWorktreeOrNull, ...parts);
}

export function profileFsQueryKey(
  owner: ConnectionRef,
  project: string,
  normalizedWorktreeOrNull: string | null,
  path: string,
  ...parts: unknown[]
): QueryKey {
  return profileQueryKey(owner, "fs", project, normalizedWorktreeOrNull, path, ...parts);
}

export function profileTerminalSessionsQueryKey(owner: ConnectionRef): QueryKey {
  return profileQueryKey(owner, "terminal-sessions");
}

export function profileWorkflowOverviewQueryKey(owner: ConnectionRef): QueryKey {
  return profileQueryKey(owner, "workflow", "overview");
}

export function profileUsageQueryKey(
  owner: ConnectionRef,
  ...parts: unknown[]
): QueryKey {
  return profileQueryKey(owner, "usage", ...parts);
}

/**
 * Deterministic key hash.
 * Canonical queries include owner in profileQueryKey.
 */
export function profileScopedQueryKeyHash(queryKey: QueryKey): string {
  return JSON.stringify([
    getActiveProfileId() ?? "no-active-profile",
    queryKey,
  ]);
}
