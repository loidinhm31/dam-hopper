import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { BulkGitService } from "../bulk.js";
import type { GitProgressEvent } from "../types.js";
import type { ProjectConfig } from "../../config/schema.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-bulk-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function createCloneWithRemote(
  name: string,
): Promise<{ localPath: string; remotePath: string }> {
  const remotePath = join(tmpDir, `${name}-remote.git`);
  const sourcePath = join(tmpDir, `${name}-source`);
  const localPath = join(tmpDir, name);

  // Create bare remote
  await mkdir(remotePath, { recursive: true });
  const remoteGit = simpleGit(remotePath);
  await remoteGit.init(["--bare", "-b", "main"]);

  // Create source repo with a commit and push to remote
  await mkdir(sourcePath, { recursive: true });
  const sourceGit = simpleGit(sourcePath);
  await sourceGit.init(["-b", "main"]);
  await sourceGit.addConfig("user.email", "test@test.com");
  await sourceGit.addConfig("user.name", "Test User");
  await writeFile(join(sourcePath, "README.md"), `# ${name}`);
  await sourceGit.add(".");
  await sourceGit.commit("Initial commit");
  await sourceGit.addRemote("origin", remotePath);
  await sourceGit.push("origin", "main", ["--set-upstream"]);

  // Clone for local
  const rootGit = simpleGit(tmpDir);
  await rootGit.clone(remotePath, localPath);
  const localGit = simpleGit(localPath);
  await localGit.addConfig("user.email", "test@test.com");
  await localGit.addConfig("user.name", "Test User");

  return { localPath, remotePath };
}

function makeProject(name: string, path: string): ProjectConfig {
  return { name, path, type: "custom" };
}

describe("BulkGitService", () => {
  it("fetchAll succeeds for multiple repos with concurrency", async () => {
    const r1 = await createCloneWithRemote("repo1");
    const r2 = await createCloneWithRemote("repo2");
    const r3 = await createCloneWithRemote("repo3");

    const service = new BulkGitService({ concurrency: 2 });
    const projects = [
      makeProject("repo1", r1.localPath),
      makeProject("repo2", r2.localPath),
      makeProject("repo3", r3.localPath),
    ];

    const results = await service.fetchAll(projects);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.success).toBe(true);
    }
  });

  it("fetchAll emits progress events for each project", async () => {
    const r1 = await createCloneWithRemote("evt-repo1");
    const r2 = await createCloneWithRemote("evt-repo2");

    const service = new BulkGitService({ concurrency: 2 });
    const progressEvents: GitProgressEvent[] = [];
    service.emitter.on("progress", (event: GitProgressEvent) => {
      progressEvents.push(event);
    });

    const projects = [
      makeProject("evt-repo1", r1.localPath),
      makeProject("evt-repo2", r2.localPath),
    ];

    await service.fetchAll(projects);

    // Should have progress events (per-project bulk-fetch progress + completed)
    const bulkEvents = progressEvents.filter(
      (e) => e.operation === "bulk-fetch",
    );
    expect(bulkEvents.length).toBeGreaterThanOrEqual(2);

    const completedEvent = bulkEvents.find((e) => e.phase === "completed");
    expect(completedEvent).toBeDefined();
  });

  it("statusAll returns status for each project", async () => {
    const r1 = await createCloneWithRemote("status-repo1");
    const r2 = await createCloneWithRemote("status-repo2");

    const service = new BulkGitService();
    const projects = [
      makeProject("status-repo1", r1.localPath),
      makeProject("status-repo2", r2.localPath),
    ];

    const statuses = await service.statusAll(projects);

    expect(statuses).toHaveLength(2);
    expect(statuses[0].projectName).toBe("status-repo1");
    expect(statuses[1].projectName).toBe("status-repo2");
    expect(statuses[0].isClean).toBe(true);
    expect(statuses[1].isClean).toBe(true);
  });

  it("fetchAll returns failure for a repo with a broken remote", async () => {
    const r1 = await createCloneWithRemote("partial-repo1");

    // Create a git repo with a non-existent remote URL — fetch will fail
    const brokenDir = join(tmpDir, "broken-remote");
    await mkdir(brokenDir, { recursive: true });
    const brokenGit = simpleGit(brokenDir);
    await brokenGit.init();
    await brokenGit.addConfig("user.email", "test@test.com");
    await brokenGit.addConfig("user.name", "Test User");
    await writeFile(join(brokenDir, "README.md"), "# broken");
    await brokenGit.add(".");
    await brokenGit.commit("Initial commit");
    await brokenGit.addRemote("origin", "/this/path/does/not/exist.git");

    const service = new BulkGitService();
    const projects = [
      makeProject("partial-repo1", r1.localPath),
      makeProject("broken-remote", brokenDir),
    ];

    const results = await service.fetchAll(projects);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    // Repo with invalid remote returns failure
    expect(results[1].success).toBe(false);
  });
});
