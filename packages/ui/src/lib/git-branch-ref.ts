import type { Branch } from "@/api/client.js";

/**
 * Persisted branch selection mode.
 * - 'follow-active': tracks current checked-out branch or HEAD when detached.
 * - 'pinned': pinned canonical ref (refs/heads/... or refs/remotes/...) independent of checkout.
 */
export type HistoryBranchPreference =
  | { mode: "follow-active" }
  | { mode: "pinned"; ref: string };

export interface ResolvedHistoryBranch {
  branch?: Branch;
  isFollowActive: boolean;
  canonicalRef?: string;
  notFound?: boolean;
}

/**
 * Derives a branch's canonical ref using Branch.name and isRemote.
 * Disambiguates local branches from remote branches:
 * - Remote branches become refs/remotes/<name>
 * - Local branches become refs/heads/<name>
 *
 * For example:
 * - Local 'origin/main' (isRemote: false) -> 'refs/heads/origin/main'
 * - Remote 'origin/main' (isRemote: true) -> 'refs/remotes/origin/main'
 */
export function toBranchCanonicalRef(branch: {
  name: string;
  isRemote: boolean;
}): string {
  if (!branch || typeof branch.name !== "string") return "";
  const trimmed = branch.name.trim();
  if (trimmed === "") return "";

  if (branch.isRemote) {
    if (trimmed.startsWith("refs/remotes/")) return trimmed;
    const clean = trimmed.startsWith("refs/")
      ? trimmed.replace(/^refs\//, "")
      : trimmed;
    return `refs/remotes/${clean}`;
  }

  if (trimmed.startsWith("refs/heads/")) return trimmed;
  const clean = trimmed.startsWith("refs/")
    ? trimmed.replace(/^refs\//, "")
    : trimmed;
  return `refs/heads/${clean}`;
}

/**
 * Validates whether a string is a canonical Git ref prefix.
 * Canonical refs must begin with refs/heads/ or refs/remotes/ and contain a ref name.
 */
export function isBranchCanonicalRef(ref: string): boolean {
  if (typeof ref !== "string") return false;
  return (
    (ref.startsWith("refs/heads/") && ref.slice(11).trim().length > 0) ||
    (ref.startsWith("refs/remotes/") && ref.slice(13).trim().length > 0)
  );
}

/**
 * Resolves a branch preference against discovered repository branches.
 * - 'follow-active': finds current checked-out local branch, returns isFollowActive: true.
 * - 'pinned': finds matching canonical ref. Returns isFollowActive: false even if the pinned branch matches active.
 */
export function resolveHistoryBranch(
  branches: readonly Branch[],
  preference?: HistoryBranchPreference | null,
): ResolvedHistoryBranch {
  if (!preference || preference.mode === "follow-active") {
    const currentBranch =
      branches.find((b) => b.isCurrent && !b.isRemote) ??
      branches.find((b) => b.isCurrent);
    if (currentBranch) {
      return {
        branch: currentBranch,
        isFollowActive: true,
        canonicalRef: toBranchCanonicalRef(currentBranch),
      };
    }
    return {
      branch: undefined,
      isFollowActive: true,
      canonicalRef: undefined,
    };
  }

  const pinnedRef = preference.ref;
  const match = branches.find((b) => toBranchCanonicalRef(b) === pinnedRef);
  if (match) {
    return {
      branch: match,
      isFollowActive: false,
      canonicalRef: pinnedRef,
    };
  }

  return {
    branch: undefined,
    isFollowActive: false,
    canonicalRef: pinnedRef,
    notFound: true,
  };
}
