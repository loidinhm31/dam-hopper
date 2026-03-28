import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, lstat, readlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  ship,
  unship,
  absorb,
  bulkShip,
  healthCheck,
} from "../distributor.js";

const mkTmpDir = () =>
  join(tmpdir(), `dev-hub-dist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

let tmpDir: string;
let storePath: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = mkTmpDir();
  storePath = join(tmpDir, "store");
  projectPath = join(tmpDir, "project-a");
  await mkdir(storePath, { recursive: true });
  await mkdir(projectPath, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────

async function makeStoreSkill(name: string): Promise<string> {
  const dir = join(storePath, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill ${name}\n---`);
  return dir;
}

async function makeStoreCommand(name: string): Promise<string> {
  const dir = join(storePath, "commands");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${name}.md`);
  await writeFile(filePath, `---\ndescription: Command ${name}\n---`);
  return filePath;
}

async function makeStoreHook(name: string): Promise<string> {
  const dir = join(storePath, "hooks");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, name);
  await writeFile(filePath, "#!/bin/sh\necho hook");
  return filePath;
}

// ── ship() ───────────────────────────────────────────────────────────

describe("ship()", () => {
  it("creates symlink from project to store (skill)", async () => {
    await makeStoreSkill("planning");

    const result = await ship(storePath, "planning", "skill", projectPath, "claude", "symlink");

    expect(result.success).toBe(true);
    expect(result.method).toBe("symlink");
    const linkPath = join(projectPath, ".claude", "skills", "planning");
    const lstats = await lstat(linkPath);
    expect(lstats.isSymbolicLink()).toBe(true);
    // Check it resolves back to store
    const target = await readlink(linkPath);
    const resolved = resolve(dirname(linkPath), target);
    expect(resolved).toBe(join(storePath, "skills", "planning"));
  });

  it("creates symlink from project to store (command)", async () => {
    await makeStoreCommand("debug");

    const result = await ship(storePath, "debug", "command", projectPath, "claude", "symlink");

    expect(result.success).toBe(true);
    const linkPath = join(projectPath, ".claude", "commands", "debug.md");
    const lstats = await lstat(linkPath);
    expect(lstats.isSymbolicLink()).toBe(true);
  });

  it("copies files when method is copy", async () => {
    await makeStoreSkill("backend-dev");

    const result = await ship(storePath, "backend-dev", "skill", projectPath, "claude", "copy");

    expect(result.success).toBe(true);
    const destPath = join(projectPath, ".claude", "skills", "backend-dev");
    const lstats = await lstat(destPath);
    expect(lstats.isSymbolicLink()).toBe(false);
    expect(lstats.isDirectory()).toBe(true);
  });

  it("creates agent directory if missing", async () => {
    await makeStoreSkill("new-skill");

    const result = await ship(storePath, "new-skill", "skill", projectPath, "gemini", "symlink");

    expect(result.success).toBe(true);
    const expectedDir = join(projectPath, ".gemini", "skills");
    const dirStat = await lstat(expectedDir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it("is idempotent — shipping same item twice is a no-op", async () => {
    await makeStoreSkill("planning");

    const first = await ship(storePath, "planning", "skill", projectPath, "claude");
    const second = await ship(storePath, "planning", "skill", projectPath, "claude");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it("refuses to overwrite non-store files", async () => {
    await makeStoreSkill("planning");
    // Create a real (non-symlink) directory at the target location
    await mkdir(join(projectPath, ".claude", "skills", "planning"), { recursive: true });

    const result = await ship(storePath, "planning", "skill", projectPath, "claude");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a store symlink/);
  });

  it("works for gemini agent", async () => {
    await makeStoreCommand("plan");

    const result = await ship(storePath, "plan", "command", projectPath, "gemini");

    expect(result.success).toBe(true);
    const linkPath = join(projectPath, ".gemini", "commands", "plan.md");
    const lstats = await lstat(linkPath);
    expect(lstats.isSymbolicLink()).toBe(true);
  });

  it("ships hook successfully", async () => {
    await makeStoreHook("pre-tool.sh");

    const result = await ship(storePath, "pre-tool.sh", "hook", projectPath, "claude");

    expect(result.success).toBe(true);
  });
});

// ── unship() ─────────────────────────────────────────────────────────

describe("unship()", () => {
  it("removes a symlink", async () => {
    await makeStoreSkill("planning");
    await ship(storePath, "planning", "skill", projectPath, "claude");

    const result = await unship(storePath, "planning", "skill", projectPath, "claude");

    expect(result.success).toBe(true);
    const linkPath = join(projectPath, ".claude", "skills", "planning");
    const { fileExists } = await import("../../utils/fs.js");
    expect(await fileExists(linkPath)).toBe(false);
  });

  it("is idempotent for already-removed items", async () => {
    const result = await unship(storePath, "non-existent", "skill", projectPath, "claude");

    expect(result.success).toBe(true);
  });

  it("removes a copied item", async () => {
    await makeStoreSkill("backend-dev");
    await ship(storePath, "backend-dev", "skill", projectPath, "claude", "copy");

    const result = await unship(storePath, "backend-dev", "skill", projectPath, "claude", { force: true });

    expect(result.success).toBe(true);
  });

  it("warns when copied item has been modified", async () => {
    await makeStoreSkill("planning");
    await ship(storePath, "planning", "skill", projectPath, "claude", "copy");
    // Modify the copied SKILL.md
    await writeFile(
      join(projectPath, ".claude", "skills", "planning", "SKILL.md"),
      "---\nname: planning\ndescription: Modified locally\n---",
    );

    const result = await unship(storePath, "planning", "skill", projectPath, "claude");

    expect(result.success).toBe(false);
    expect((result as { modified?: boolean }).modified).toBe(true);
  });

  it("force removes modified copied item", async () => {
    await makeStoreSkill("planning");
    await ship(storePath, "planning", "skill", projectPath, "claude", "copy");
    await writeFile(
      join(projectPath, ".claude", "skills", "planning", "SKILL.md"),
      "---\nname: planning\ndescription: Modified locally\n---",
    );

    const result = await unship(storePath, "planning", "skill", projectPath, "claude", { force: true });

    expect(result.success).toBe(true);
  });
});

// ── absorb() ─────────────────────────────────────────────────────────

describe("absorb()", () => {
  it("moves project item to store and symlinks back", async () => {
    // Create skill directly in project (not yet in store)
    const skillDir = join(projectPath, ".claude", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: my-skill\ndescription: My skill\n---");
    // Ensure store skills dir exists
    await mkdir(join(storePath, "skills"), { recursive: true });

    const result = await absorb(storePath, "my-skill", "skill", projectPath, "claude");

    expect(result.success).toBe(true);
    // Store should now have the item
    const { fileExists } = await import("../../utils/fs.js");
    expect(await fileExists(join(storePath, "skills", "my-skill"))).toBe(true);
    // Project should have a symlink
    const linkPath = join(projectPath, ".claude", "skills", "my-skill");
    const lstats = await lstat(linkPath);
    expect(lstats.isSymbolicLink()).toBe(true);
  });

  it("refuses to absorb already-symlinked items", async () => {
    await makeStoreSkill("planning");
    await ship(storePath, "planning", "skill", projectPath, "claude");

    const result = await absorb(storePath, "planning", "skill", projectPath, "claude");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already a symlink/);
  });

  it("returns error when item not found in project", async () => {
    const result = await absorb(storePath, "non-existent", "skill", projectPath, "claude");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("returns error when item already exists in store", async () => {
    await makeStoreSkill("planning");
    // Also put a real copy in the project
    const skillDir = join(projectPath, ".claude", "skills", "planning");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: planning\ndescription: Dupe\n---");

    const result = await absorb(storePath, "planning", "skill", projectPath, "claude");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists in store/);
  });
});

// ── bulkShip() ───────────────────────────────────────────────────────

describe("bulkShip()", () => {
  it("ships multiple items to multiple projects", async () => {
    const projectB = join(tmpDir, "project-b");
    await mkdir(projectB, { recursive: true });
    await makeStoreSkill("planning");
    await makeStoreCommand("debug");

    const results = await bulkShip(
      storePath,
      [
        { name: "planning", category: "skill" },
        { name: "debug", category: "command" },
      ],
      [
        { path: projectPath, agent: "claude" },
        { path: projectB, agent: "claude" },
      ],
    );

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

// ── healthCheck() ────────────────────────────────────────────────────

describe("healthCheck()", () => {
  it("detects broken symlinks", async () => {
    // Create a symlink pointing to a non-existent path
    const skillsDir = join(projectPath, ".claude", "skills");
    await mkdir(skillsDir, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(join(storePath, "skills", "ghost-skill"), join(skillsDir, "ghost-skill"));

    const result = await healthCheck(storePath, [{ name: "project-a", path: projectPath }], ["claude"]);

    expect(result.brokenSymlinks.length).toBeGreaterThanOrEqual(1);
    const broken = result.brokenSymlinks[0]!;
    expect(broken.project).toBe("project-a");
    expect(broken.path).toContain("ghost-skill");
  });

  it("returns empty results for clean projects", async () => {
    await makeStoreSkill("planning");
    await ship(storePath, "planning", "skill", projectPath, "claude");

    const result = await healthCheck(storePath, [{ name: "project-a", path: projectPath }], ["claude"]);

    expect(result.brokenSymlinks).toHaveLength(0);
  });

  it("handles project with no agent dirs gracefully", async () => {
    const emptyProject = join(tmpDir, "empty-project");
    await mkdir(emptyProject, { recursive: true });

    const result = await healthCheck(storePath, [{ name: "empty", path: emptyProject }], ["claude"]);

    expect(result.brokenSymlinks).toHaveLength(0);
  });
});
