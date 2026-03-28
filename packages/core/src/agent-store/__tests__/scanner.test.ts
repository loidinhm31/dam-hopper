import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanProject, scanAllProjects, checkSymlink } from "../scanner.js";

const mkTmpDir = () =>
  join(tmpdir(), `dev-hub-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkTmpDir();
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("scanProject()", () => {
  it("detects .claude/ dir with skills and commands", async () => {
    const projectDir = join(tmpDir, "project-a");
    await mkdir(join(projectDir, ".claude", "skills", "planning"), { recursive: true });
    await mkdir(join(projectDir, ".claude", "commands"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "commands", "plan.md"), "---\ndescription: Plan\n---");

    const result = await scanProject("project-a", projectDir);

    expect(result.projectName).toBe("project-a");
    expect(result.projectPath).toBe(projectDir);
    expect(result.agents.claude).toBeDefined();
    expect(result.agents.claude?.hasConfig).toBe(true);
    expect(result.agents.claude?.skills).toContain("planning");
    expect(result.agents.claude?.commands).toContain("plan");
  });

  it("detects .gemini/ dir", async () => {
    const projectDir = join(tmpDir, "project-b");
    await mkdir(join(projectDir, ".gemini", "skills", "backend-dev"), { recursive: true });
    await mkdir(join(projectDir, ".gemini", "commands"), { recursive: true });

    const result = await scanProject("project-b", projectDir);

    expect(result.agents.gemini).toBeDefined();
    expect(result.agents.gemini?.skills).toContain("backend-dev");
    expect(result.agents.claude).toBeUndefined();
  });

  it("returns empty agents for project with no agent config", async () => {
    const projectDir = join(tmpDir, "plain-project");
    await mkdir(join(projectDir, "src"), { recursive: true });

    const result = await scanProject("plain-project", projectDir);

    expect(result.agents).toEqual({});
  });

  it("detects CLAUDE.md presence", async () => {
    const projectDir = join(tmpDir, "project-c");
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, "CLAUDE.md"), "# Instructions");

    const result = await scanProject("project-c", projectDir);

    expect(result.agents.claude?.hasMemoryFile).toBe(true);
  });

  it("detects .mcp.json presence", async () => {
    const projectDir = join(tmpDir, "project-mcp");
    await mkdir(join(projectDir, ".claude"), { recursive: true });
    await writeFile(join(projectDir, ".claude", ".mcp.json"), "{}");

    const result = await scanProject("project-mcp", projectDir);

    expect(result.agents.claude?.hasMcpConfig).toBe(true);
  });

  it("reports hasMemoryFile false when CLAUDE.md absent", async () => {
    const projectDir = join(tmpDir, "project-no-mem");
    await mkdir(join(projectDir, ".claude"), { recursive: true });

    const result = await scanProject("project-no-mem", projectDir);

    expect(result.agents.claude?.hasMemoryFile).toBe(false);
  });

  it("lists hooks correctly", async () => {
    const projectDir = join(tmpDir, "project-hooks");
    await mkdir(join(projectDir, ".claude", "hooks"), { recursive: true });
    await writeFile(join(projectDir, ".claude", "hooks", "pre-tool.sh"), "#!/bin/sh");

    const result = await scanProject("project-hooks", projectDir);

    expect(result.agents.claude?.hooks).toContain("pre-tool.sh");
  });
});

describe("scanAllProjects()", () => {
  it("scans multiple projects concurrently", async () => {
    const workspaceDir = join(tmpDir, "workspace");
    await mkdir(join(workspaceDir, "proj-a", ".claude"), { recursive: true });
    await mkdir(join(workspaceDir, "proj-b", ".gemini"), { recursive: true });

    const results = await scanAllProjects(
      [
        { name: "proj-a", path: "proj-a" },
        { name: "proj-b", path: "proj-b" },
      ],
      workspaceDir,
    );

    expect(results).toHaveLength(2);
    const names = results.map((r) => r.projectName);
    expect(names).toContain("proj-a");
    expect(names).toContain("proj-b");
    const projA = results.find((r) => r.projectName === "proj-a")!;
    expect(projA.agents.claude).toBeDefined();
  });
});

describe("checkSymlink()", () => {
  it("identifies regular files as non-symlinks", async () => {
    const filePath = join(tmpDir, "regular.txt");
    await writeFile(filePath, "content");

    const result = await checkSymlink(filePath);

    expect(result.isSymlink).toBe(false);
    expect(result.target).toBeUndefined();
  });

  it("identifies symlinks and returns their target", async () => {
    const realFile = join(tmpDir, "real.txt");
    const linkPath = join(tmpDir, "link.txt");
    await writeFile(realFile, "content");
    await symlink(realFile, linkPath);

    const result = await checkSymlink(linkPath);

    expect(result.isSymlink).toBe(true);
    expect(result.target).toBe(realFile);
  });

  it("returns isSymlink false for non-existent path", async () => {
    const result = await checkSymlink(join(tmpDir, "does-not-exist"));

    expect(result.isSymlink).toBe(false);
  });
});
