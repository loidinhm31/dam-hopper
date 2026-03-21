import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { getStatus } from "../status.js";
import { gitFetch, gitPull } from "../operations.js";
import { listWorktrees, addWorktree, removeWorktree } from "../worktree.js";
import { updateBranch } from "../branch.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-git-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function initRepo(dir: string, name = "test") {
  await mkdir(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test User");
  await writeFile(join(dir, "README.md"), `# ${name}`);
  await git.add(".");
  await git.commit("Initial commit");
  return git;
}

describe("getStatus", () => {
  it("returns status for a clean repo", async () => {
    const repoDir = join(tmpDir, "clean-repo");
    await initRepo(repoDir, "clean");

    const status = await getStatus(repoDir, "clean-repo");

    expect(status.projectName).toBe("clean-repo");
    expect(status.isClean).toBe(true);
    expect(status.staged).toBe(0);
    expect(status.modified).toBe(0);
    expect(status.untracked).toBe(0);
    expect(status.hasStash).toBe(false);
    expect(status.lastCommit.message).toBe("Initial commit");
    expect(status.lastCommit.hash).toBeTruthy();
  });

  it("counts modified and untracked files", async () => {
    const repoDir = join(tmpDir, "dirty-repo");
    await initRepo(repoDir, "dirty");

    // Modify tracked file and add untracked
    await writeFile(join(repoDir, "README.md"), "modified content");
    await writeFile(join(repoDir, "new-file.txt"), "new file");

    const status = await getStatus(repoDir, "dirty-repo");
    expect(status.isClean).toBe(false);
    expect(status.modified).toBe(1);
    expect(status.untracked).toBe(1);
  });

  it("throws GitError for non-repo path", async () => {
    const nonRepo = join(tmpDir, "not-a-repo");
    await mkdir(nonRepo);

    await expect(getStatus(nonRepo, "not-repo")).rejects.toMatchObject({
      name: "GitError",
      category: "not_repo",
      projectName: "not-repo",
    });
  });
});

describe("gitFetch and gitPull", () => {
  it("fetches and pulls from bare remote", async () => {
    // Set up bare remote
    const remoteDir = join(tmpDir, "remote.git");
    const cloneDir = join(tmpDir, "clone");
    await mkdir(remoteDir, { recursive: true });

    // Create bare remote
    const remoteGit = simpleGit(remoteDir);
    await remoteGit.init(["--bare"]);

    // Create local repo and push
    await initRepo(join(tmpDir, "source"), "source");
    const sourceGit = simpleGit(join(tmpDir, "source"));
    await sourceGit.addRemote("origin", remoteDir);
    await sourceGit.push(["--set-upstream", "origin", "master"]);

    // Clone from bare remote
    const rootGit = simpleGit(tmpDir);
    await rootGit.clone(remoteDir, cloneDir);
    const cloneGit = simpleGit(cloneDir);
    await cloneGit.addConfig("user.email", "test@test.com");
    await cloneGit.addConfig("user.name", "Test User");

    // Add a new commit to source and push
    await writeFile(join(tmpDir, "source", "extra.txt"), "extra");
    await sourceGit.add(".");
    await sourceGit.commit("Second commit");
    await sourceGit.push();

    // Fetch in clone
    const fetchResult = await gitFetch(cloneDir, "clone");
    expect(fetchResult.success).toBe(true);
    expect(fetchResult.operation).toBe("fetch");

    // Pull in clone
    const pullResult = await gitPull(cloneDir, "clone");
    expect(pullResult.success).toBe(true);
    expect(pullResult.operation).toBe("pull");
  });
});

describe("worktree operations", () => {
  it("lists, adds, and removes worktrees", async () => {
    const repoDir = join(tmpDir, "wt-repo");
    const git = await initRepo(repoDir, "wt-repo");

    // Create a branch to use in worktree
    await git.checkoutLocalBranch("feature-branch");
    await writeFile(join(repoDir, "feature.txt"), "feature");
    await git.add(".");
    await git.commit("Feature commit");
    await git.checkout("master");

    // List initial worktrees (should be just the main one)
    const initial = await listWorktrees(repoDir);
    expect(initial).toHaveLength(1);
    expect(initial[0].isMain).toBe(true);

    // Add a worktree for the feature branch
    const worktreePath = join(tmpDir, "wt-feature");
    const added = await addWorktree(repoDir, {
      branch: "feature-branch",
      path: worktreePath,
    });
    expect(added.branch).toBe("feature-branch");
    expect(added.isMain).toBe(false);

    // List should now have 2
    const after = await listWorktrees(repoDir);
    expect(after).toHaveLength(2);

    // Remove the worktree
    await removeWorktree(repoDir, worktreePath);
    const final = await listWorktrees(repoDir);
    expect(final).toHaveLength(1);
  });
});

describe("updateBranch", () => {
  it("updates a local branch from remote without checkout", async () => {
    const remoteDir = join(tmpDir, "update-remote.git");
    await mkdir(remoteDir, { recursive: true });

    // Create bare remote and source
    const remoteGit = simpleGit(remoteDir);
    await remoteGit.init(["--bare"]);

    const sourceDir = join(tmpDir, "update-source");
    await initRepo(sourceDir, "source");
    const sourceGit = simpleGit(sourceDir);
    await sourceGit.addRemote("origin", remoteDir);
    await sourceGit.push(["--set-upstream", "origin", "master"]);

    // Create 'develop' branch in source and push
    await sourceGit.checkoutLocalBranch("develop");
    await writeFile(join(sourceDir, "develop.txt"), "develop");
    await sourceGit.add(".");
    await sourceGit.commit("Develop commit");
    await sourceGit.push(["--set-upstream", "origin", "develop"]);
    await sourceGit.checkout("master");

    // Clone from remote
    const cloneDir = join(tmpDir, "update-clone");
    const rootGit = simpleGit(tmpDir);
    await rootGit.clone(remoteDir, cloneDir);
    const cloneGit = simpleGit(cloneDir);
    await cloneGit.addConfig("user.email", "test@test.com");
    await cloneGit.addConfig("user.name", "Test User");

    // Create local develop tracking branch
    await cloneGit.fetch(["--all"]);
    await cloneGit.checkoutBranch("develop", "origin/develop");
    await cloneGit.checkout("master");

    // Push a new commit to develop from source
    await sourceGit.checkout("develop");
    await writeFile(join(sourceDir, "develop2.txt"), "more");
    await sourceGit.add(".");
    await sourceGit.commit("Develop commit 2");
    await sourceGit.push();

    // Fetch first to get remote tracking updated
    await cloneGit.fetch(["--all"]);

    // Update develop branch without checkout
    const result = await updateBranch(cloneDir, "develop");
    expect(result.branch).toBe("develop");
    expect(result.success).toBe(true);
  });

  it("skips update for currently checked-out branch", async () => {
    const repoDir = join(tmpDir, "skip-repo");
    await initRepo(repoDir, "skip");

    // master/main is checked out; attempt to update it
    const git = simpleGit(repoDir);
    const status = await git.status();
    const currentBranch = status.current!;

    const result = await updateBranch(repoDir, currentBranch);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("checked-out");
  });
});
