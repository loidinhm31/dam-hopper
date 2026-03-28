import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importFromRepo, cleanupImport } from "../importer.js";
// Note: scanRepo (git clone) is not tested here — requires network/git binary.
// findSkills and findCommands are internal — tested indirectly via a fixture dir.

const mkTmpDir = () =>
  join(tmpdir(), `dev-hub-importer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function makeSkillDir(root: string, name: string, description = `Desc ${name}`) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}`,
  );
  return dir;
}

async function makeCommandFile(root: string, name: string, description = `Cmd ${name}`) {
  const cmdDir = join(root, "commands");
  await mkdir(cmdDir, { recursive: true });
  const filePath = join(cmdDir, `${name}.md`);
  await writeFile(filePath, `---\ndescription: ${description}\n---\nDo ${name}`);
  return filePath;
}

describe("importFromRepo()", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = mkTmpDir();
    storePath = mkTmpDir();
    await mkdir(join(storePath, "skills"), { recursive: true });
    await mkdir(join(storePath, "commands"), { recursive: true });
    await makeSkillDir(tmpDir, "planning");
    await makeCommandFile(tmpDir, "plan");
  });

  afterEach(async () => {
    await Promise.all([
      rm(tmpDir, { recursive: true, force: true }),
      rm(storePath, { recursive: true, force: true }),
    ]);
  });

  it("copies a skill directory into the store", async () => {
    const results = await importFromRepo(
      tmpDir,
      [{ name: "planning", category: "skill", relativePath: "planning" }],
      storePath,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "planning", success: true });
    const entries = await readdir(join(storePath, "skills"));
    expect(entries).toContain("planning");
  });

  it("copies a command .md file into the store", async () => {
    const results = await importFromRepo(
      tmpDir,
      [{ name: "plan", category: "command", relativePath: "commands/plan.md" }],
      storePath,
    );
    expect(results[0]).toMatchObject({ name: "plan", success: true });
    const entries = await readdir(join(storePath, "commands"));
    expect(entries).toContain("plan.md");
  });

  it("fails gracefully when item already exists in store", async () => {
    // Pre-create the target to simulate conflict
    await mkdir(join(storePath, "skills", "planning"), { recursive: true });
    const results = await importFromRepo(
      tmpDir,
      [{ name: "planning", category: "skill", relativePath: "planning" }],
      storePath,
    );
    expect(results[0]).toMatchObject({ name: "planning", success: false });
    expect(results[0]?.error).toMatch(/already exists/i);
  });

  it("handles partial failures — continues after one item fails", async () => {
    // First item conflicts, second should succeed
    await mkdir(join(storePath, "skills", "planning"), { recursive: true });
    await makeSkillDir(tmpDir, "coding");
    const results = await importFromRepo(
      tmpDir,
      [
        { name: "planning", category: "skill", relativePath: "planning" },
        { name: "coding", category: "skill", relativePath: "coding" },
      ],
      storePath,
    );
    expect(results).toHaveLength(2);
    const failed = results.find((r) => r.name === "planning");
    const ok = results.find((r) => r.name === "coding");
    expect(failed?.success).toBe(false);
    expect(ok?.success).toBe(true);
  });

  it("returns empty array when selectedItems is empty", async () => {
    const results = await importFromRepo(tmpDir, [], storePath);
    expect(results).toEqual([]);
  });
});

describe("cleanupImport()", () => {
  it("removes the temp directory", async () => {
    const dir = mkTmpDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test.txt"), "content");
    await cleanupImport(dir);
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("does not throw when directory does not exist", async () => {
    await expect(cleanupImport("/tmp/nonexistent-devhub-dir")).resolves.toBeUndefined();
  });
});
