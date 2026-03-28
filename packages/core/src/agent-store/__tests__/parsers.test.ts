import { describe, it, expect } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter, parseSkillMd, parseCommandMd } from "../parsers.js";

describe("parseFrontmatter", () => {
  it("returns empty data and original body when no frontmatter", () => {
    const content = "Just some content\nno frontmatter";
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });

  it("parses valid YAML frontmatter", () => {
    const content = `---\nname: my-skill\ndescription: A test skill\n---\n# Body`;
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({ name: "my-skill", description: "A test skill" });
    expect(body).toBe("# Body");
  });

  it("handles Windows line endings (CRLF)", () => {
    const content = "---\r\nname: my-skill\r\ndescription: A skill\r\n---\r\n# Body";
    const { data, body } = parseFrontmatter(content);
    expect(data).toMatchObject({ name: "my-skill" });
    expect(body).toContain("Body");
  });

  it("handles file with frontmatter but no body", () => {
    const content = "---\nname: test\ndescription: desc\n---\n";
    const { data, body } = parseFrontmatter(content);
    expect(data).toMatchObject({ name: "test" });
    expect(body).toBe("");
  });

  it("parses array fields", () => {
    const content = `---\nname: tool\ndescription: desc\nallowed-tools:\n  - Read\n  - Write\n---\n`;
    const { data } = parseFrontmatter(content);
    expect(data["allowed-tools"]).toEqual(["Read", "Write"]);
  });
});

describe("parseSkillMd", () => {
  const tmpDir = join(tmpdir(), `dev-hub-parsers-test-${Date.now()}`);

  it("parses a valid SKILL.md", async () => {
    const skillDir = join(tmpDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill\ndescription: Does something useful\nlicense: MIT\nallowed-tools:\n  - Read\n  - Write\n---\n# My Skill\nBody content`,
    );

    const meta = await parseSkillMd(skillDir);
    expect(meta.name).toBe("my-skill");
    expect(meta.description).toBe("Does something useful");
    expect(meta.license).toBe("MIT");
    expect(meta.allowedTools).toEqual(["Read", "Write"]);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects invalid name format (uppercase)", async () => {
    const skillDir = join(tmpDir, "BadSkill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: BadSkill\ndescription: desc\n---\n`,
    );

    await expect(parseSkillMd(skillDir)).rejects.toThrow();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects missing description", async () => {
    const skillDir = join(tmpDir, "my-skill-2");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: my-skill-2\n---\n`,
    );

    await expect(parseSkillMd(skillDir)).rejects.toThrow();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("parseCommandMd", () => {
  const tmpDir = join(tmpdir(), `dev-hub-cmd-test-${Date.now()}`);

  it("parses a valid command .md file", async () => {
    await mkdir(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "deploy.md");
    await writeFile(
      filePath,
      `---\ndescription: Deploy the application\nargument-hint: "[env]"\n---\nRun deployment`,
    );

    const meta = await parseCommandMd(filePath);
    expect(meta.name).toBe("deploy");
    expect(meta.description).toBe("Deploy the application");
    expect(meta.argumentHint).toBe("[env]");

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("parses command without argument-hint", async () => {
    await mkdir(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "build.md");
    await writeFile(
      filePath,
      `---\ndescription: Build the project\n---\nBuild instructions`,
    );

    const meta = await parseCommandMd(filePath);
    expect(meta.name).toBe("build");
    expect(meta.description).toBe("Build the project");
    expect(meta.argumentHint).toBeUndefined();

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects command with missing description", async () => {
    await mkdir(tmpDir, { recursive: true });
    const filePath = join(tmpDir, "bad.md");
    await writeFile(filePath, `---\n---\nNo description`);

    await expect(parseCommandMd(filePath)).rejects.toThrow();
    await rm(tmpDir, { recursive: true, force: true });
  });
});
