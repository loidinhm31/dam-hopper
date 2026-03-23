import { simpleGit } from "simple-git";
import { basename, dirname, resolve } from "node:path";
import type { Worktree, WorktreeAddOptions } from "./types.js";
import { wrapGitError, GitError } from "./errors.js";

// Reject branch/path inputs that could inject git flags or path traversal tricks
function validateBranchName(branch: string): void {
  if (branch.startsWith("-")) {
    throw new GitError(`Invalid branch name: ${branch}`, "unknown", "");
  }
  if (branch.includes("..") || branch.includes("\x00")) {
    throw new GitError(`Invalid branch name: ${branch}`, "unknown", "");
  }
}

export function parseWorktreePorcelain(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const blocks = output.trim().split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split("\n");
    let path = "";
    let commitHash = "";
    let branch = "";
    let isMain = false;
    let isLocked = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        commitHash = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        branch = "(bare)";
      } else if (line === "detached") {
        branch = "(detached)";
      } else if (line.startsWith("locked")) {
        isLocked = true;
      }
    }

    // First worktree in the list is the main one
    if (worktrees.length === 0) {
      isMain = true;
    }

    if (path) {
      worktrees.push({ path, branch, commitHash, isMain, isLocked });
    }
  }

  return worktrees;
}

export async function listWorktrees(projectPath: string): Promise<Worktree[]> {
  const git = simpleGit(projectPath);
  try {
    const output = await git.raw(["worktree", "list", "--porcelain"]);
    return parseWorktreePorcelain(output);
  } catch (err) {
    throw wrapGitError(err, basename(projectPath));
  }
}

export async function addWorktree(
  projectPath: string,
  options: WorktreeAddOptions,
): Promise<Worktree> {
  validateBranchName(options.branch);
  if (options.baseBranch) validateBranchName(options.baseBranch);

  const git = simpleGit(projectPath);
  // Resolve relative to projectPath's parent so result is predictable regardless of CWD
  const worktreePath = options.path
    ? resolve(options.path)
    : resolve(
        dirname(projectPath),
        `${basename(projectPath)}-${options.branch}`,
      );

  try {
    const args = ["worktree", "add"];
    if (options.createBranch) {
      args.push("-b", options.branch);
    }
    args.push(worktreePath);
    if (!options.createBranch) {
      args.push(options.branch);
    }
    if (options.baseBranch) {
      args.push(options.baseBranch);
    }

    await git.raw(args);

    const worktrees = await listWorktrees(projectPath);
    const created = worktrees.find((w) => w.path === worktreePath);
    if (!created) {
      throw new Error(
        `Worktree created at ${worktreePath} but not found in list`,
      );
    }
    return created;
  } catch (err) {
    throw wrapGitError(err, basename(projectPath));
  }
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
): Promise<void> {
  const git = simpleGit(projectPath);
  try {
    await git.raw(["worktree", "remove", worktreePath]);
  } catch (err) {
    throw wrapGitError(err, basename(projectPath));
  }
}

export async function pruneWorktrees(projectPath: string): Promise<void> {
  const git = simpleGit(projectPath);
  try {
    await git.raw(["worktree", "prune"]);
  } catch (err) {
    throw wrapGitError(err, basename(projectPath));
  }
}
