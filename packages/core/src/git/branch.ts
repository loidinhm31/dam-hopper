import { simpleGit } from "simple-git";
import { basename } from "node:path";
import type { BranchInfo, BranchUpdateResult } from "./types.js";
import type { GitProgressEmitter } from "./progress.js";
import { emitProgress } from "./progress.js";
import { wrapGitError } from "./errors.js";

export async function listBranches(projectPath: string): Promise<BranchInfo[]> {
  const git = simpleGit(projectPath);
  try {
    const result = await git.branch(["-a", "-vv"]);
    const branches: BranchInfo[] = [];

    for (const [name, branch] of Object.entries(result.branches)) {
      const isRemote = name.startsWith("remotes/");
      const isCurrent = branch.current;

      // Parse tracking info from label e.g. "[origin/main: ahead 2, behind 1]"
      let trackingBranch: string | undefined;
      let ahead = 0;
      let behind = 0;

      const trackMatch = branch.label?.match(/\[([^\]:]+)(?::([^\]]+))?\]/);
      if (trackMatch) {
        trackingBranch = trackMatch[1];
        const detail = trackMatch[2] ?? "";
        const aheadMatch = detail.match(/ahead (\d+)/);
        const behindMatch = detail.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      }

      branches.push({
        name: isRemote ? name.replace(/^remotes\//, "") : name,
        isRemote,
        isCurrent,
        trackingBranch,
        ahead,
        behind,
        lastCommit: branch.commit,
      });
    }

    return branches;
  } catch (err) {
    throw wrapGitError(err, basename(projectPath));
  }
}

export async function updateBranch(
  projectPath: string,
  branch: string,
  remote = "origin",
): Promise<BranchUpdateResult> {
  const git = simpleGit(projectPath);
  try {
    // Cannot update checked-out branch with fetch refspec
    const status = await git.status();
    if (status.current === branch) {
      return {
        branch,
        success: false,
        reason: "checked-out — use pull instead",
      };
    }

    await git.raw(["fetch", remote, `${branch}:${branch}`]);
    return { branch, success: true };
  } catch (err) {
    const gitError = wrapGitError(err, basename(projectPath));
    const msg = gitError.message.toLowerCase();
    const reason =
      msg.includes("non-fast-forward") || msg.includes("would clobber")
        ? "non-fast-forward"
        : msg.includes("couldn't find remote ref")
          ? "not-tracking"
          : gitError.message;
    return { branch, success: false, reason };
  }
}

export async function updateAllBranches(
  projectPath: string,
  emitter?: GitProgressEmitter,
): Promise<BranchUpdateResult[]> {
  const projectName = basename(projectPath);
  const branches = await listBranches(projectPath);
  const localBranches = branches.filter((b) => !b.isRemote && b.trackingBranch);

  const results: BranchUpdateResult[] = [];
  for (const b of localBranches) {
    emitProgress(
      emitter,
      projectName,
      "update-branches",
      "progress",
      `Updating ${b.name}...`,
    );
    const result = await updateBranch(projectPath, b.name);
    results.push(result);
  }
  emitProgress(
    emitter,
    projectName,
    "update-branches",
    "completed",
    `Updated ${results.length} branches`,
  );
  return results;
}
