import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findConfigFile,
  loadWorkspaceConfig,
  ConfigNotFoundError,
} from "../finder.js";

const MINIMAL_TOML = `
[workspace]
name = "test-ws"
`;

describe("findConfigFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-finder-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("finds config in the start directory", async () => {
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, MINIMAL_TOML);

    const found = await findConfigFile(tmpDir);
    expect(found).toBe(configPath);
  });

  it("finds config by walking up directories", async () => {
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, MINIMAL_TOML);

    const nestedDir = join(tmpDir, "a", "b", "c");
    await mkdir(nestedDir, { recursive: true });

    const found = await findConfigFile(nestedDir);
    expect(found).toBe(configPath);
  });

  it("returns null when no config found", async () => {
    const found = await findConfigFile(tmpDir);
    expect(found).toBeNull();
  });
});

describe("loadWorkspaceConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-load-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("loads config successfully", async () => {
    await writeFile(join(tmpDir, "dev-hub.toml"), MINIMAL_TOML);
    const config = await loadWorkspaceConfig(tmpDir);
    expect(config.workspace.name).toBe("test-ws");
  });

  it("throws ConfigNotFoundError when no config", async () => {
    await expect(loadWorkspaceConfig(tmpDir)).rejects.toThrow(
      ConfigNotFoundError,
    );
  });
});
