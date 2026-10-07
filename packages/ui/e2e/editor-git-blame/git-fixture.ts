import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { copyToContainer, execInContainer } from "../fixtures/container-client.js";

export interface GitFixtureMetadata {
  aliceCommitOid: string;
  bobCommitOid: string;
  headOid: string;
  totalCommits: number;
  aliceAuthor: string;
  bobAuthor: string;
  bobCommitSubject: string;
  bobCommitBody: string;
  files: {
    codeTs: string;
    documentMd: string;
    pageHtml: string;
    untrackedTs: string;
  };
}

/**
 * Builds a deterministic Git repository on the host with explicit authors,
 * timestamps, a multiline commit message, diverse source file formats,
 * untracked files, and >200 churn commits for pagination testing.
 * Then copies the repository into the containerized target directory.
 */
export async function setupGitBlameFixture(
  appContainerId: string,
  containerTargetDir = "/e2e/workspace/fixture-project",
): Promise<GitFixtureMetadata> {
  const hostStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "blame-e2e-fixture-"));

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
    git(["config", "user.name", "Fixture Setup"]);
    git(["config", "user.email", "setup@example.com"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);

    const aliceAuthorName = "Alice Dev";
    const aliceAuthorEmail = "alice@example.com";
    const aliceDate = "2026-01-01T10:00:00+00:00";
    const aliceEnv = {
      GIT_AUTHOR_NAME: aliceAuthorName,
      GIT_AUTHOR_EMAIL: aliceAuthorEmail,
      GIT_AUTHOR_DATE: aliceDate,
      GIT_COMMITTER_NAME: aliceAuthorName,
      GIT_COMMITTER_EMAIL: aliceAuthorEmail,
      GIT_COMMITTER_DATE: aliceDate,
    };

    const bobAuthorName = "Bob Reviewer";
    const bobAuthorEmail = "bob@example.com";
    const bobDate = "2026-02-01T12:00:00+00:00";
    const bobEnv = {
      GIT_AUTHOR_NAME: bobAuthorName,
      GIT_AUTHOR_EMAIL: bobAuthorEmail,
      GIT_AUTHOR_DATE: bobDate,
      GIT_COMMITTER_NAME: bobAuthorName,
      GIT_COMMITTER_EMAIL: bobAuthorEmail,
      GIT_COMMITTER_DATE: bobDate,
    };

    // 1. First commit by Alice: code.ts, document.md, page.html
    const codeTsPath = path.join(hostStagingDir, "code.ts");
    const documentMdPath = path.join(hostStagingDir, "document.md");
    const pageHtmlPath = path.join(hostStagingDir, "page.html");
    const churnPath = path.join(hostStagingDir, "churn.txt");

    const initialCode = [
      "// Line 1: Initial codebase by Alice",
      "// Line 2: Original line by Alice",
      "// Line 3: Initial utility by Alice",
      'export function helloWorld() { return "hello"; }',
    ].join("\n") + "\n";

    const initialMd = [
      "# Documentation",
      "Initial draft by Alice.",
      "Shared overview section.",
    ].join("\n") + "\n";

    const initialHtml = [
      "<!DOCTYPE html>",
      "<html>",
      "<body>",
      "  <h1>Hello Blame</h1>",
      "</body>",
      "</html>",
    ].join("\n") + "\n";

    await fs.writeFile(codeTsPath, initialCode, "utf-8");
    await fs.writeFile(documentMdPath, initialMd, "utf-8");
    await fs.writeFile(pageHtmlPath, initialHtml, "utf-8");
    await fs.writeFile(churnPath, "initial churn\n", "utf-8");

    git(["add", "code.ts", "document.md", "page.html", "churn.txt"]);
    git(["commit", "-m", "feat: initial project codebase by Alice"], aliceEnv);
    const aliceCommitOid = git(["rev-parse", "HEAD"]);

    // 2. Second commit by Bob: modifies Line 3 in code.ts, adds multiline commit message
    const bobCommitSubject = "feat(editor): add detailed commit message with multiline body";
    const bobCommitBody =
      "This is a multiline commit message body designed for testing full commit inspection in Workspace Git.\n" +
      "Includes exact hash, author attribution, and file verification.";
    const fullBobMessage = `${bobCommitSubject}\n\n${bobCommitBody}\n`;

    const modifiedCode = [
      "// Line 1: Initial codebase by Alice",
      "// Line 2: Original line by Alice",
      "// Line 3: Modified line by Bob with multiline body",
      'export function helloWorld() { return "hello"; }',
    ].join("\n") + "\n";

    const modifiedMd = [
      "# Documentation",
      "Initial draft by Alice.",
      "Updated section by Bob with extended explanations.",
    ].join("\n") + "\n";

    await fs.writeFile(codeTsPath, modifiedCode, "utf-8");
    await fs.writeFile(documentMdPath, modifiedMd, "utf-8");

    git(["commit", "-a", "-m", fullBobMessage], bobEnv);
    const bobCommitOid = git(["rev-parse", "HEAD"]);

    // 3. Add >200 churn commits touching ONLY churn.txt so Bob's commit is deep in history
    const churnAuthorEnv = {
      GIT_AUTHOR_NAME: "Churn Bot",
      GIT_AUTHOR_EMAIL: "bot@example.com",
      GIT_AUTHOR_DATE: "2026-03-01T00:00:00+00:00",
      GIT_COMMITTER_NAME: "Churn Bot",
      GIT_COMMITTER_EMAIL: "bot@example.com",
      GIT_COMMITTER_DATE: "2026-03-01T00:00:00+00:00",
    };

    const churnCount = 205;
    for (let i = 1; i <= churnCount; i++) {
      await fs.writeFile(churnPath, `churn content revision ${i}\n`, "utf-8");
      git(["commit", "-a", "-m", `chore(churn): iteration ${i}`], churnAuthorEnv);
    }
    const headOid = git(["rev-parse", "HEAD"]);
    const totalCommits = 2 + churnCount;

    // 4. Create untracked file
    const untrackedTsPath = path.join(hostStagingDir, "untracked.ts");
    await fs.writeFile(untrackedTsPath, "// Untracked new file\nexport const untracked = true;\n", "utf-8");

    // 5. Copy into container
    await copyToContainer(hostStagingDir, appContainerId, containerTargetDir);

    // 6. Ensure safe.directory is configured inside container
    try {
      await execInContainer(appContainerId, ["git", "config", "--global", "--add", "safe.directory", "*"]);
    } catch {
      // Ignored if git is run through server flags
    }

    return {
      aliceCommitOid,
      bobCommitOid,
      headOid,
      totalCommits,
      aliceAuthor: aliceAuthorName,
      bobAuthor: bobAuthorName,
      bobCommitSubject,
      bobCommitBody,
      files: {
        codeTs: "code.ts",
        documentMd: "document.md",
        pageHtml: "page.html",
        untrackedTs: "untracked.ts",
      },
    };
  } finally {
    await fs.rm(hostStagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
