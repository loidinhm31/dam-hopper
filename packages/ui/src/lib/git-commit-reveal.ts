import type { ProjectTargetRef } from "@/api/client.js";

export interface GitCommitRevealOwner {
  profileId: string;
  generation: number;
}

export interface GitCommitRevealRequest {
  nonce: number;
  owner: GitCommitRevealOwner;
  target: ProjectTargetRef;
  rootId: string;
  hash: string;
}

/**
 * Validates that a reveal request matches the currently connected profile/generation
 * and target project. When currentTarget is root (worktreePath == null), it accepts
 * any reveal request from the project's worktrees. When currentTarget is worktree-scoped,
 * it requires exact worktree match. Mismatched profile, generation, or project is rejected.
 */
export function isGitCommitRevealRequestMatchingTarget(
  request: GitCommitRevealRequest,
  currentOwner: GitCommitRevealOwner | null | undefined,
  currentTarget: ProjectTargetRef | null | undefined,
): boolean {
  if (!currentOwner || !currentTarget) return false;
  if (
    request.owner.profileId !== currentOwner.profileId ||
    request.owner.generation !== currentOwner.generation
  ) {
    return false;
  }
  if (request.target.project !== currentTarget.project) {
    return false;
  }
  const requestWorktree = request.target.worktreePath ?? null;
  const currentWorktree = currentTarget.worktreePath ?? null;
  if (currentWorktree == null) {
    return true;
  }
  return requestWorktree === currentWorktree;
}

/**
 * Format author timestamp and timezone offset into a readable string.
 * Example: "Oct 6, 2026, 6:30 AM (UTC+7)"
 */
export function formatGitCommitAuthorTimestamp(
  timestampSeconds: number,
  timezoneOffsetMinutes?: number,
): string {
  if (!timestampSeconds || Number.isNaN(timestampSeconds)) return "";

  if (typeof timezoneOffsetMinutes !== "number" || Number.isNaN(timezoneOffsetMinutes)) {
    return new Date(timestampSeconds * 1000).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const authoredEpoch = (timestampSeconds + timezoneOffsetMinutes * 60) * 1000;
  const baseFormatted = new Date(authoredEpoch).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  const sign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(timezoneOffsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const tzString =
    minutes === 0
      ? `UTC${sign}${hours}`
      : `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;

  return `${baseFormatted} (${tzString})`;
}
