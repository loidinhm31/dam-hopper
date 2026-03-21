import { simpleGit } from "simple-git";
import type { GitStatus } from "./types.js";
import { wrapGitError } from "./errors.js";

export async function getStatus(
  projectPath: string,
  projectName: string,
): Promise<GitStatus> {
  const git = simpleGit(projectPath);
  try {
    const [status, stashList, log] = await Promise.all([
      git.status(),
      git.stashList(),
      git.log(["-1"]),
    ]);

    const lastCommitEntry = log.latest;
    const lastCommit = lastCommitEntry
      ? {
          hash: lastCommitEntry.hash,
          message: lastCommitEntry.message,
          date: lastCommitEntry.date,
        }
      : { hash: "", message: "", date: "" };

    return {
      projectName,
      branch: status.current ?? "HEAD",
      isClean: status.isClean(),
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged.length,
      modified: status.modified.length,
      untracked: status.not_added.length,
      hasStash: stashList.total > 0,
      lastCommit,
    };
  } catch (err) {
    throw wrapGitError(err, projectName);
  }
}
