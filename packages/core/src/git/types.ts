// --- Status ---
export interface GitStatus {
  projectName: string;
  branch: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  hasStash: boolean;
  lastCommit: { hash: string; message: string; date: string };
  /** false when the project directory does not exist on disk */
  pathExists?: boolean;
  /** populated when status could not be retrieved */
  statusError?: string;
}

// --- Operations ---
export interface GitOperationResult {
  projectName: string;
  operation: "fetch" | "pull" | "push";
  success: boolean;
  summary?: string;
  error?: import("./errors.js").GitError;
  durationMs: number;
}

// --- Worktree ---
export interface Worktree {
  path: string;
  branch: string;
  commitHash: string;
  isMain: boolean;
  isLocked: boolean;
}

export interface WorktreeAddOptions {
  branch: string;
  path?: string;
  createBranch?: boolean;
  baseBranch?: string;
}

// --- Branch ---
export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  trackingBranch?: string;
  ahead: number;
  behind: number;
  lastCommit: string;
}

export interface BranchUpdateResult {
  branch: string;
  success: boolean;
  reason?: string;
}

// --- Progress Events ---
export interface GitProgressEvent {
  projectName: string;
  operation: string;
  phase: "started" | "progress" | "completed" | "failed";
  message: string;
  percent?: number;
}
