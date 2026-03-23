import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  globalConfigPath,
  readGlobalConfig,
  writeGlobalConfig,
  listKnownWorkspaces,
  addKnownWorkspace,
  removeKnownWorkspace,
} from "../global.js";

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

describe("listKnownWorkspaces", () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-known-test-"));
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

  it("returns empty array when no config exists", async () => {
    expect(await listKnownWorkspaces()).toEqual([]);
  });

  it("returns empty array when workspaces key is absent", async () => {
    await writeGlobalConfig({ defaults: { workspace: "/some/path" } });
    expect(await listKnownWorkspaces()).toEqual([]);
  });

  it("returns known workspaces", async () => {
    await writeGlobalConfig({
      workspaces: [{ name: "my-ws", path: "/my/path" }],
    });
    const result = await listKnownWorkspaces();
    expect(result).toEqual([{ name: "my-ws", path: "/my/path" }]);
  });
});

describe("addKnownWorkspace", () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-add-ws-test-"));
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

  it("creates config and adds workspace when none exists", async () => {
    await addKnownWorkspace("my-project", "/abs/path/my-project");
    const workspaces = await listKnownWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toEqual({
      name: "my-project",
      path: "/abs/path/my-project",
    });
  });

  it("appends to existing workspaces", async () => {
    await addKnownWorkspace("ws-a", "/path/a");
    await addKnownWorkspace("ws-b", "/path/b");
    const workspaces = await listKnownWorkspaces();
    expect(workspaces).toHaveLength(2);
    expect(workspaces.map((w) => w.path)).toContain("/path/a");
    expect(workspaces.map((w) => w.path)).toContain("/path/b");
  });

  it("deduplicates by path — updates name if it changed", async () => {
    await addKnownWorkspace("ws-a", "/path/a");
    await addKnownWorkspace("ws-a-renamed", "/path/a"); // same path, new name
    const workspaces = await listKnownWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe("ws-a-renamed"); // name updated
  });

  it("deduplicates by path — no-op when name and path are identical", async () => {
    await addKnownWorkspace("ws-a", "/path/a");
    await addKnownWorkspace("ws-a", "/path/a"); // exact duplicate
    expect(await listKnownWorkspaces()).toHaveLength(1);
  });

  it("preserves existing defaults while adding workspaces", async () => {
    await writeGlobalConfig({ defaults: { workspace: "/default" } });
    await addKnownWorkspace("ws", "/path");
    const cfg = await readGlobalConfig();
    expect(cfg?.defaults?.workspace).toBe("/default");
    expect(cfg?.workspaces).toHaveLength(1);
  });
});

describe("removeKnownWorkspace", () => {
  let tmpDir: string;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-rm-ws-test-"));
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

  it("removes workspace by path", async () => {
    await addKnownWorkspace("ws-a", "/path/a");
    await addKnownWorkspace("ws-b", "/path/b");
    await removeKnownWorkspace("/path/a");
    const workspaces = await listKnownWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].path).toBe("/path/b");
  });

  it("is a no-op for unknown path", async () => {
    await addKnownWorkspace("ws", "/known/path");
    await removeKnownWorkspace("/unknown/path");
    expect(await listKnownWorkspaces()).toHaveLength(1);
  });

  it("handles remove when config is empty", async () => {
    // Should not throw
    await expect(removeKnownWorkspace("/any/path")).resolves.toBeUndefined();
  });
});
