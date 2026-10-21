import type { ConflictSnapshot } from "@/api/client.js";
import type { DraftOwnerScope, DraftTargetIdentity } from "./conflict-draft-types.js";
/**
 * Creates an immutable deterministic tuple key uniquely identifying a conflict draft.
 */
export function createDraftKey(
  scope: DraftOwnerScope,
  target: Pick<DraftTargetIdentity, "conflictId" | "snapshotVersion">,
  serverIdentity?: Pick<ConflictSnapshot, "repositoryRoot" | "worktreeRoot" | "fullIndexFingerprint">,
): string {
  return JSON.stringify([
    scope.profileId,
    scope.generation,
    scope.serverUrl,
    scope.configuredRoot ?? "",
    scope.project,
    scope.worktreePath ?? "",
    scope.root ?? "",
    serverIdentity?.repositoryRoot ?? "",
    serverIdentity?.worktreeRoot ?? "",
    serverIdentity?.fullIndexFingerprint ?? "",
    target.conflictId,
    target.snapshotVersion,
  ]);
}


/**
 * Validates whether two scopes refer to the same owner, server binding, project, and worktree.
 */
export function matchesOwnerScope(
  a: DraftOwnerScope,
  b: DraftOwnerScope,
): boolean {
  return (
    a.profileId === b.profileId &&
    a.generation === b.generation &&
    a.serverUrl === b.serverUrl &&
    (a.configuredRoot ?? "") === (b.configuredRoot ?? "") &&
    a.project === b.project &&
    (a.worktreePath ?? "") === (b.worktreePath ?? "") &&
    (a.root ?? "") === (b.root ?? "")
  );
}

/**
 * Returns true if the draft scope matches the currently active connection generation and profile.
 */
export function isOwnerActive(
  scope: DraftOwnerScope,
  activeProfileId?: string,
  activeGeneration?: number,
): boolean {
  if (!activeProfileId || activeGeneration == null) return false;
  return (
    scope.profileId === activeProfileId &&
    scope.generation === activeGeneration
  );
}
