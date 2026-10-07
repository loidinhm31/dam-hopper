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
 * and active project target. Mismatched profile, generation, or target project/worktree
 * rejects the reveal request to prevent routing to unqualified or disconnected targets.
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
