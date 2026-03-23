export type GitErrorCategory =
  | "network"
  | "auth"
  | "conflict"
  | "lock"
  | "not_repo"
  | "unknown";

export class GitError extends Error {
  category: GitErrorCategory;
  projectName: string;

  constructor(
    message: string,
    category: GitErrorCategory,
    projectName: string,
  ) {
    super(message);
    this.name = "GitError";
    this.category = category;
    this.projectName = projectName;
  }
}

export function classifyGitError(err: Error): GitErrorCategory {
  const msg = err.message.toLowerCase();

  if (
    msg.includes("could not resolve host") ||
    msg.includes("connection refused")
  ) {
    return "network";
  }
  if (
    msg.includes("permission denied") ||
    msg.includes("authentication failed")
  ) {
    return "auth";
  }
  if (
    msg.includes("conflict") ||
    msg.includes("not possible because you have unmerged")
  ) {
    return "conflict";
  }
  if (msg.includes("unable to create") || msg.includes(".lock")) {
    return "lock";
  }
  if (msg.includes("not a git repository")) {
    return "not_repo";
  }
  return "unknown";
}

export function wrapGitError(err: unknown, projectName: string): GitError {
  if (err instanceof GitError) return err;
  const base = err instanceof Error ? err : new Error(String(err));
  return new GitError(base.message, classifyGitError(base), projectName);
}
