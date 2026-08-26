/**
 * Stable, opaque target segments for project-owned terminal IDs.
 *
 * Terminal IDs are persisted by the server and used as replacement keys, so
 * the same command must not reuse an ID after switching to another worktree.
 * Keep the filesystem path out of the public ID while making the segment
 * deterministic across reloads and browser/server transports.
 */
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36).padStart(13, "0");
}

export function terminalTargetDiscriminator(
  project: string,
  worktreePath?: string,
): string {
  if (!worktreePath) return "root";
  return `wt-${stableHash(`${project}\0${normalizeProjectTargetPath(worktreePath)}`)}`;
}

function targetSuffix(project: string, worktreePath?: string): string {
  const discriminator = terminalTargetDiscriminator(project, worktreePath);
  return discriminator === "root" ? "" : `:${discriminator}`;
}

export function targetScopedCommandSessionId(
  type: "build" | "run" | "custom",
  project: string,
  worktreePath?: string,
  commandKey?: string,
): string {
  const key = commandKey == null ? "" : `:${commandKey}`;
  return `${type}:${project}${key}${targetSuffix(project, worktreePath)}`;
}

export function terminalProfileSessionPrefix(
  project: string,
  profile: string,
  worktreePath?: string,
): string {
  return `terminal:${project}:${profile}${targetSuffix(project, worktreePath)}:`;
}

export function terminalProfileSessionId(
  project: string,
  profile: string,
  worktreePath?: string,
  timestamp = Date.now(),
): string {
  return `${terminalProfileSessionPrefix(project, profile, worktreePath)}${timestamp}`;
}
