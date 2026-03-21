import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverProjects, detectProjectType } from "../discovery.js";

describe("detectProjectType", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-detect-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("detects maven from pom.xml", async () => {
    await writeFile(join(tmpDir, "pom.xml"), "");
    expect(await detectProjectType(tmpDir)).toBe("maven");
  });

  it("detects gradle from build.gradle", async () => {
    await writeFile(join(tmpDir, "build.gradle"), "");
    expect(await detectProjectType(tmpDir)).toBe("gradle");
  });

  it("detects gradle from build.gradle.kts", async () => {
    await writeFile(join(tmpDir, "build.gradle.kts"), "");
    expect(await detectProjectType(tmpDir)).toBe("gradle");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(tmpDir, "pnpm-lock.yaml"), "");
    expect(await detectProjectType(tmpDir)).toBe("pnpm");
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(tmpDir, "package-lock.json"), "");
    expect(await detectProjectType(tmpDir)).toBe("npm");
  });

  it("detects cargo from Cargo.toml", async () => {
    await writeFile(join(tmpDir, "Cargo.toml"), "");
    expect(await detectProjectType(tmpDir)).toBe("cargo");
  });

  it("falls back to npm from package.json", async () => {
    await writeFile(join(tmpDir, "package.json"), "{}");
    expect(await detectProjectType(tmpDir)).toBe("npm");
  });

  it("returns null when no markers found", async () => {
    expect(await detectProjectType(tmpDir)).toBeNull();
  });

  it("cargo wins over maven when both exist", async () => {
    await writeFile(join(tmpDir, "Cargo.toml"), "");
    await writeFile(join(tmpDir, "pom.xml"), "");
    expect(await detectProjectType(tmpDir)).toBe("cargo");
  });
});

describe("discoverProjects", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-discover-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("discovers projects with markers", async () => {
    const apiDir = join(tmpDir, "api");
    const webDir = join(tmpDir, "web");
    await mkdir(apiDir);
    await mkdir(webDir);
    await writeFile(join(apiDir, "pom.xml"), "");
    await writeFile(join(webDir, "pnpm-lock.yaml"), "");

    const projects = await discoverProjects(tmpDir);
    expect(projects).toHaveLength(2);

    const api = projects.find((p) => p.name === "api");
    const web = projects.find((p) => p.name === "web");
    expect(api?.type).toBe("maven");
    expect(web?.type).toBe("pnpm");
  });

  it("skips hidden directories", async () => {
    const hiddenDir = join(tmpDir, ".hidden");
    await mkdir(hiddenDir);
    await writeFile(join(hiddenDir, "pom.xml"), "");

    const projects = await discoverProjects(tmpDir);
    expect(projects).toHaveLength(0);
  });

  it("skips node_modules", async () => {
    const nmDir = join(tmpDir, "node_modules");
    await mkdir(nmDir);
    await writeFile(join(nmDir, "package.json"), "{}");

    const projects = await discoverProjects(tmpDir);
    expect(projects).toHaveLength(0);
  });

  it("skips directories with no markers", async () => {
    const emptyDir = join(tmpDir, "empty-project");
    await mkdir(emptyDir);

    const projects = await discoverProjects(tmpDir);
    expect(projects).toHaveLength(0);
  });

  it("detects isGitRepo correctly", async () => {
    const repoDir = join(tmpDir, "my-repo");
    await mkdir(repoDir);
    await mkdir(join(repoDir, ".git"));
    await writeFile(join(repoDir, "Cargo.toml"), "");

    const projects = await discoverProjects(tmpDir);
    expect(projects[0].isGitRepo).toBe(true);
  });

  it("returns empty array for non-existent directory", async () => {
    const projects = await discoverProjects(join(tmpDir, "nonexistent"));
    expect(projects).toEqual([]);
  });
});
