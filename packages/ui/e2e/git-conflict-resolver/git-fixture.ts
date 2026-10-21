import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { copyToContainer, execInContainer } from "../fixtures/container-client.js";

export interface GitConflictFixtureMetadata {
  headOid: string;
  featureOid: string;
  conflictedPath: string;
  stagedCleanPath: string;
}

/**
 * Builds a deterministic Git repository with real merge conflicts and copies it
 * into the running E2E container target directory.
 */
export async function setupGitConflictFixture(
  appContainerId: string,
  containerTargetDir = "/e2e/workspace/fixture-project",
): Promise<GitConflictFixtureMetadata> {
  const hostStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "conflict-e2e-fixture-"));

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
    git(["config", "user.name", "Conflict Runner"]);
    git(["config", "user.email", "conflict@example.com"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);

    // Base commit
    const conflictFilePath = path.join(hostStagingDir, "code.ts");
    await fs.writeFile(
      conflictFilePath,
      `// Common Header\nexport function calculate(a: number, b: number): number {\n  return a + b;\n}\n`,
      "utf-8",
    );
    git(["add", "code.ts"]);
    git(["commit", "-m", "init: base calculate function"]);

    // Feature branch
    git(["checkout", "-b", "feature"]);
    await fs.writeFile(
      conflictFilePath,
      `// Common Header\nexport function calculate(a: number, b: number): number {\n  // Feature implementation\n  return (a + b) * 2;\n}\n`,
      "utf-8",
    );
    git(["commit", "-a", "-m", "feat: double sum calculation"]);
    const featureOid = git(["rev-parse", "HEAD"]);

    // Main branch conflicting commit
    git(["checkout", "main"]);
    await fs.writeFile(
      conflictFilePath,
      `// Common Header\nexport function calculate(a: number, b: number): number {\n  // Main branch implementation\n  return a * b;\n}\n`,
      "utf-8",
    );
    git(["commit", "-a", "-m", "feat: product calculation"]);
    const headOid = git(["rev-parse", "HEAD"]);

    // Create merge conflict
    try {
      git(["merge", "feature"]);
    } catch {
      // Expected conflict
    }

    // Add unrelated staged file
    const cleanFilePath = path.join(hostStagingDir, "clean.ts");
    await fs.writeFile(cleanFilePath, `export const ready = true;\n`, "utf-8");
    git(["add", "clean.ts"]);

    // Copy to container
    await copyToContainer(hostStagingDir, appContainerId, containerTargetDir);

    try {
      await execInContainer(appContainerId, ["git", "config", "--global", "--add", "safe.directory", "*"]);
    } catch {
      // Ignore
    }

    return {
      headOid,
      featureOid,
      conflictedPath: "code.ts",
      stagedCleanPath: "clean.ts",
    };
  } finally {
    await fs.rm(hostStagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
