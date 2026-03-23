import { simpleGit } from "simple-git";
import type { GitOperationResult } from "./types.js";
import type { GitProgressEmitter } from "./progress.js";
import { emitProgress } from "./progress.js";
import { wrapGitError } from "./errors.js";

function makeProgressCallback(
  emitter: GitProgressEmitter | undefined,
  projectName: string,
  operation: string,
) {
  return ({
    method,
    stage,
    progress,
  }: {
    method: string;
    stage: string;
    progress: number;
  }) => {
    emitter?.emit("progress", {
      projectName,
      operation,
      phase: "progress",
      message: `${method} ${stage}`,
      percent: progress,
    });
  };
}

export async function gitFetch(
  projectPath: string,
  projectName: string,
  emitter?: GitProgressEmitter,
): Promise<GitOperationResult> {
  const start = performance.now();
  const git = simpleGit(projectPath, {
    progress: makeProgressCallback(emitter, projectName, "fetch"),
  });

  try {
    emitProgress(emitter, projectName, "fetch", "started", "Fetching...");
    await git.fetch(["--all", "--prune"]);
    const durationMs = performance.now() - start;
    emitProgress(emitter, projectName, "fetch", "completed", "Fetch complete");
    return {
      projectName,
      operation: "fetch",
      success: true,
      summary: "Fetched all remotes",
      durationMs,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    const gitError = wrapGitError(err, projectName);
    emitProgress(emitter, projectName, "fetch", "failed", gitError.message);
    return {
      projectName,
      operation: "fetch",
      success: false,
      error: gitError,
      durationMs,
    };
  }
}

export async function gitPull(
  projectPath: string,
  projectName: string,
  emitter?: GitProgressEmitter,
): Promise<GitOperationResult> {
  const start = performance.now();
  const git = simpleGit(projectPath, {
    progress: makeProgressCallback(emitter, projectName, "pull"),
  });

  try {
    emitProgress(emitter, projectName, "pull", "started", "Pulling...");
    const result = await git.pull(["--ff-only"]);
    const durationMs = performance.now() - start;
    const pulled =
      result.summary.changes +
      result.summary.insertions +
      result.summary.deletions;
    const summary =
      pulled > 0
        ? `${result.summary.changes} file(s) changed`
        : "Already up to date";
    emitProgress(emitter, projectName, "pull", "completed", summary);
    return {
      projectName,
      operation: "pull",
      success: true,
      summary,
      durationMs,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    const gitError = wrapGitError(err, projectName);
    emitProgress(emitter, projectName, "pull", "failed", gitError.message);
    return {
      projectName,
      operation: "pull",
      success: false,
      error: gitError,
      durationMs,
    };
  }
}

export async function gitPush(
  projectPath: string,
  projectName: string,
  emitter?: GitProgressEmitter,
): Promise<GitOperationResult> {
  const start = performance.now();
  const git = simpleGit(projectPath, {
    progress: makeProgressCallback(emitter, projectName, "push"),
  });

  try {
    emitProgress(emitter, projectName, "push", "started", "Pushing...");
    await git.push();
    const durationMs = performance.now() - start;
    emitProgress(emitter, projectName, "push", "completed", "Push complete");
    return {
      projectName,
      operation: "push",
      success: true,
      summary: "Pushed to remote",
      durationMs,
    };
  } catch (err) {
    const durationMs = performance.now() - start;
    const gitError = wrapGitError(err, projectName);
    emitProgress(emitter, projectName, "push", "failed", gitError.message);
    return {
      projectName,
      operation: "push",
      success: false,
      error: gitError,
      durationMs,
    };
  }
}
