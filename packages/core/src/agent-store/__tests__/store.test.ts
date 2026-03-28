import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentStoreService } from "../store.js";

const mkTmpDir = () =>
  join(tmpdir(), `dev-hub-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function makeSkillDir(dir: string, name: string): Promise<string> {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Description for ${name}\nlicense: MIT\n---\n# ${name}\nContent`,
  );
  return skillDir;
}

async function makeCommandFile(dir: string, name: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${name}.md`);
  await writeFile(
    filePath,
    `---\ndescription: Command ${name}\n---\nDo ${name}`,
  );
  return filePath;
}

describe("AgentStoreService", () => {
  let storeDir: string;
  let service: AgentStoreService;
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = mkTmpDir();
    storeDir = join(tmpBase, "agent-store");
    service = new AgentStoreService(storeDir);
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  describe("init()", () => {
    it("creates all category directories", async () => {
      await service.init();
      const { readdir } = await import("node:fs/promises");
      const dirs = await readdir(storeDir);
      expect(dirs).toContain("skills");
      expect(dirs).toContain("commands");
      expect(dirs).toContain("hooks");
      expect(dirs).toContain("mcp-servers");
      expect(dirs).toContain("subagents");
      expect(dirs).toContain("memory-templates");
    });

    it("is idempotent (calling twice doesn't throw)", async () => {
      await service.init();
      await expect(service.init()).resolves.toBeUndefined();
    });
  });

  describe("list()", () => {
    it("returns empty array for fresh store", async () => {
      await service.init();
      const items = await service.list();
      expect(items).toEqual([]);
    });

    it("lists added skills", async () => {
      await service.init();
      const src = join(tmpBase, "src-skills");
      const skillSrc = await makeSkillDir(src, "planning");
      await service.add(skillSrc, "skill", "planning");

      const items = await service.list("skill");
      expect(items).toHaveLength(1);
      expect(items[0]?.name).toBe("planning");
      expect(items[0]?.category).toBe("skill");
    });

    it("lists added commands", async () => {
      await service.init();
      const src = join(tmpBase, "src-cmds");
      const cmdFile = await makeCommandFile(src, "deploy");
      await service.add(cmdFile, "command", "deploy");

      const items = await service.list("command");
      expect(items).toHaveLength(1);
      expect(items[0]?.name).toBe("deploy");
    });

    it("lists items across all categories when no filter", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const skillSrc = await makeSkillDir(src, "planning");
      await service.add(skillSrc, "skill", "planning");
      const cmdFile = await makeCommandFile(src, "debug");
      await service.add(cmdFile, "command", "debug");

      const all = await service.list();
      const categories = all.map((i) => i.category);
      expect(categories).toContain("skill");
      expect(categories).toContain("command");
    });
  });

  describe("add()", () => {
    it("copies a skill folder and parses SKILL.md metadata", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const skillSrc = await makeSkillDir(src, "backend-development");
      const item = await service.add(skillSrc, "skill", "backend-development");

      expect(item.name).toBe("backend-development");
      expect(item.category).toBe("skill");
      expect(item.description).toBe("Description for backend-development");
      expect(item.compatibleAgents).toEqual(["claude", "gemini"]);
      expect(item.sizeBytes).toBeGreaterThan(0);
    });

    it("copies a command .md and parses frontmatter", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const cmdFile = await makeCommandFile(src, "plan");
      const item = await service.add(cmdFile, "command", "plan");

      expect(item.name).toBe("plan");
      expect(item.category).toBe("command");
      expect(item.description).toBe("Command plan");
    });
  });

  describe("remove()", () => {
    it("deletes a skill from the store", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const skillSrc = await makeSkillDir(src, "planning");
      await service.add(skillSrc, "skill", "planning");

      await service.remove("planning", "skill");
      const items = await service.list("skill");
      expect(items).toHaveLength(0);
    });

    it("does not throw when removing non-existent item", async () => {
      await service.init();
      await expect(
        service.remove("nonexistent", "skill"),
      ).resolves.toBeUndefined();
    });
  });

  describe("get()", () => {
    it("returns null for non-existent item", async () => {
      await service.init();
      const result = await service.get("nonexistent", "skill");
      expect(result).toBeNull();
    });

    it("returns item with full metadata for existing skill", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const skillSrc = await makeSkillDir(src, "testing");
      await service.add(skillSrc, "skill", "testing");

      const item = await service.get("testing", "skill");
      expect(item).not.toBeNull();
      expect(item?.name).toBe("testing");
      expect(item?.description).toBe("Description for testing");
    });
  });

  describe("getContent()", () => {
    it("returns SKILL.md content for a skill", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const skillSrc = await makeSkillDir(src, "planning");
      await service.add(skillSrc, "skill", "planning");

      const content = await service.getContent("planning", "skill");
      expect(content).toContain("name: planning");
      expect(content).toContain("# planning");
    });

    it("returns .md content for a command", async () => {
      await service.init();
      const src = join(tmpBase, "src");
      const cmdFile = await makeCommandFile(src, "debug");
      await service.add(cmdFile, "command", "debug");

      const content = await service.getContent("debug", "command");
      expect(content).toContain("description: Command debug");
    });
  });
});
