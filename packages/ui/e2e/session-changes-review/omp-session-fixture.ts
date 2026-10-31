import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { copyToContainer } from "../fixtures/container-client.js";

export interface OmpSessionFixtureMetadata {
  headOid: string;
  modifiedPath: string;
  untrackedPath: string;
}

/**
 * Builds a deterministic Git repository with tracked modified and untracked files,
 * then stages it into the running E2E container target directory.
 */
export async function setupOmpSessionFixture(
  appContainerId: string,
  containerTargetDir = "/e2e/workspace/fixture-project",
): Promise<OmpSessionFixtureMetadata> {
  const hostStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-e2e-fixture-"));

  try {
    const git = (args: string[], env: Record<string, string> = {}) =>
      execFileSync("git", args, {
        cwd: hostStagingDir,
        encoding: "utf-8",
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          ...env,
        },
      }).trim();

    git(["init", "-b", "main"]);
    git(["config", "user.name", "OMP Review Runner"]);
    git(["config", "user.email", "omp-review@example.com"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);

    // Base commit
    const initialFilePath = path.join(hostStagingDir, "index.ts");
    await fs.writeFile(initialFilePath, "export const sessionState = 'initial';\n", "utf-8");
    git(["add", "."]);
    git(["commit", "-m", "chore: initial commit"]);
    const headOid = git(["rev-parse", "HEAD"]);

    // Dirty changes: modify tracked file and create untracked file
    await fs.writeFile(initialFilePath, "export const sessionState = 'session-modified';\n", "utf-8");
    const untrackedFilePath = path.join(hostStagingDir, "new-file.ts");
    await fs.writeFile(untrackedFilePath, "export const createdDuringSession = true;\n", "utf-8");

    await copyToContainer(hostStagingDir, appContainerId, containerTargetDir);

    return {
      headOid,
      modifiedPath: "index.ts",
      untrackedPath: "new-file.ts",
    };
  } finally {
    await fs.rm(hostStagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
