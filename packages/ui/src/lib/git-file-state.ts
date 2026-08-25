import type { DiffFileEntry } from "@/api/client.js";

export type GitStagedState = "unstaged" | "staged" | "mixed";

export interface GitFileState {
  path: string;
  rootRelativePath: string;
  rootId: string;
  rootPath?: string;
  status: string;
  stagedState: GitStagedState;
  additions: number;
  deletions: number;
  hasConflict: boolean;
}

export interface GitFileStateIndex {
  files: Map<string, GitFileState>;
  changedDirs: Set<string>;
}

const PRIMARY_ROOT_ID = ".";
const STATUS_PRIORITY = [
  "conflicted",
  "deleted",
  "renamed",
  "copied",
  "added",
  "modified",
];

export function projectPathForGitEntry(entry: DiffFileEntry): string {
  const rootId = entry.rootId ?? PRIMARY_ROOT_ID;
  if (rootId === PRIMARY_ROOT_ID || entry.path.startsWith(`${rootId}/`)) {
    return entry.path;
  }
  return `${rootId}/${entry.path}`;
}

function rootRelativePath(projectPath: string, rootId: string): string {
  if (rootId === PRIMARY_ROOT_ID) return projectPath;
  const prefix = `${rootId}/`;
  return projectPath.startsWith(prefix)
    ? projectPath.slice(prefix.length)
    : projectPath;
}

function mergeStatus(current: string, next: string): string {
  const currentRank = STATUS_PRIORITY.indexOf(current);
  const nextRank = STATUS_PRIORITY.indexOf(next);
  if (currentRank === -1) return next;
  if (nextRank === -1) return current;
  return nextRank < currentRank ? next : current;
}

function mergeStagedState(
  current: GitStagedState,
  next: GitStagedState,
): GitStagedState {
  if (current === next) return current;
  return "mixed";
}

function addChangedDirs(changedDirs: Set<string>, path: string) {
  const parts = path.split("/");
  parts.pop();
  while (parts.length > 0) {
    changedDirs.add(parts.join("/"));
    parts.pop();
  }
}

export function buildGitFileStateIndex(
  entries: DiffFileEntry[] | undefined,
): GitFileStateIndex {
  const files = new Map<string, GitFileState>();
  const changedDirs = new Set<string>();

  for (const entry of entries ?? []) {
    const rootId = entry.rootId ?? PRIMARY_ROOT_ID;
    const path = projectPathForGitEntry(entry);
    const stagedState: GitStagedState = entry.staged ? "staged" : "unstaged";
    const existing = files.get(path);

    if (existing) {
      files.set(path, {
        ...existing,
        status: mergeStatus(existing.status, entry.status),
        stagedState: mergeStagedState(existing.stagedState, stagedState),
        additions: existing.additions + entry.additions,
        deletions: existing.deletions + entry.deletions,
        hasConflict: existing.hasConflict || entry.status === "conflicted",
      });
    } else {
      files.set(path, {
        path,
        rootRelativePath: rootRelativePath(path, rootId),
        rootId,
        rootPath: entry.rootPath,
        status: entry.status,
        stagedState,
        additions: entry.additions,
        deletions: entry.deletions,
        hasConflict: entry.status === "conflicted",
      });
    }

    addChangedDirs(changedDirs, path);
  }

  return { files, changedDirs };
}

export function gitStatusShortLabel(state: GitFileState): string {
  if (state.hasConflict) return "!";
  if (state.stagedState === "mixed") return "±";
  switch (state.status) {
    case "added":
      return state.stagedState === "unstaged" ? "?" : "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "M";
  }
}

export function gitStatusClassName(state: GitFileState): string {
  if (state.hasConflict) return "text-red-400 border-red-400/60";
  if (state.status === "deleted")
    return "text-[var(--color-danger)] border-[var(--color-danger)]/60";
  if (state.status === "added")
    return "text-[var(--color-success)] border-[var(--color-success)]/60";
  if (state.stagedState === "staged")
    return "text-green-400 border-green-400/60";
  if (state.stagedState === "mixed")
    return "text-amber-300 border-amber-300/60";
  return "text-[var(--color-primary)] border-[var(--color-primary)]/60";
}

export function gitStateTitle(state: GitFileState): string {
  const staged =
    state.stagedState === "mixed" ? "staged + unstaged" : state.stagedState;
  const stats = `+${state.additions} -${state.deletions}`;
  const conflict = state.hasConflict ? " conflict" : "";
  return `${state.status}${conflict}, ${staged}, ${stats}`;
}
