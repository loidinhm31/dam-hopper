import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { globalConfigPath, readGlobalConfig, writeGlobalConfig } from "../global.js";

describe("globalConfigPath", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/xdg";
    expect(globalConfigPath()).toBe("/custom/xdg/dev-hub/config.toml");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const path = globalConfigPath();
    expect(path).toMatch(/\.config[/\\]dev-hub[/\\]config\.toml$/);
  });
});

describe("readGlobalConfig", () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-global-test-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(async () => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    await rm(tmpDir, { recursive: true });
  });

  it("returns null when global config is absent", async () => {
    const result = await readGlobalConfig();
    expect(result).toBeNull();
  });

  it("parses global config with defaults.workspace", async () => {
    const cfgDir = join(tmpDir, "dev-hub");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "config.toml"),
      `[defaults]\nworkspace = "/my/workspace"\n`,
    );

    const result = await readGlobalConfig();
    expect(result).not.toBeNull();
    expect(result?.defaults?.workspace).toBe("/my/workspace");
  });

  it("returns null for malformed TOML without throwing", async () => {
    const cfgDir = join(tmpDir, "dev-hub");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(join(cfgDir, "config.toml"), "[[[ invalid toml");

    const result = await readGlobalConfig();
    expect(result).toBeNull();
  });
});

describe("writeGlobalConfig", () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-global-write-test-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(async () => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    await rm(tmpDir, { recursive: true });
  });

  it("creates config file with workspace value", async () => {
    await writeGlobalConfig({ defaults: { workspace: "/some/path" } });
    const result = await readGlobalConfig();
    expect(result?.defaults?.workspace).toBe("/some/path");
  });

  it("creates intermediate directories", async () => {
    // XDG_CONFIG_HOME points at tmpDir; dev-hub subdir should be created automatically
    await writeGlobalConfig({ defaults: { workspace: "/ws" } });
    const result = await readGlobalConfig();
    expect(result).not.toBeNull();
  });
});
