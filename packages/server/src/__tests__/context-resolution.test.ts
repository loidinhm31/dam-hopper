import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigNotFoundError } from "@dev-hub/core";
import { createServerContext } from "../services/context.js";

const MINIMAL_TOML = `
[workspace]
name = "test-ws"

[[projects]]
name = "proj-a"
path = "."
type = "custom"
`;

describe("createServerContext resolution", () => {
  let tmpDir: string;
  const dirsToClean: string[] = [];
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dh-ctx-"));
    dirsToClean.push(tmpDir);
    delete process.env.DEV_HUB_WORKSPACE;
    delete process.env.DEV_HUB_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(async () => {
    delete process.env.DEV_HUB_WORKSPACE;
    delete process.env.DEV_HUB_CONFIG;
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    for (const dir of dirsToClean) {
      await rm(dir, { recursive: true, force: true });
    }
    dirsToClean.length = 0;
  });

  it("resolves from a directory path argument", async () => {
    await writeFile(join(tmpDir, "dev-hub.toml"), MINIMAL_TOML);

    const ctx = await createServerContext(tmpDir);

    expect(ctx.workspaceRoot).toBe(tmpDir);
    expect(ctx.config.workspace.name).toBe("test-ws");
  });

  it("resolves from a file path argument (normalises to directory)", async () => {
    const configFile = join(tmpDir, "dev-hub.toml");
    await writeFile(configFile, MINIMAL_TOML);

    const ctx = await createServerContext(configFile);

    expect(ctx.workspaceRoot).toBe(tmpDir);
  });

  it("uses DEV_HUB_WORKSPACE env var when no arg given", async () => {
    await writeFile(join(tmpDir, "dev-hub.toml"), MINIMAL_TOML);
    process.env.DEV_HUB_WORKSPACE = tmpDir;

    const ctx = await createServerContext();

    expect(ctx.workspaceRoot).toBe(tmpDir);
  });

  it("DEV_HUB_WORKSPACE takes priority over DEV_HUB_CONFIG", async () => {
    const dir1 = await mkdtemp(join(tmpdir(), "dh-ctx1-"));
    const dir2 = await mkdtemp(join(tmpdir(), "dh-ctx2-"));
    dirsToClean.push(dir1, dir2);

    await writeFile(
      join(dir1, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", "ws-from-workspace"),
    );
    await writeFile(
      join(dir2, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", "ws-from-config"),
    );

    process.env.DEV_HUB_WORKSPACE = dir1;
    process.env.DEV_HUB_CONFIG = join(dir2, "dev-hub.toml");

    const ctx = await createServerContext();

    expect(ctx.config.workspace.name).toBe("ws-from-workspace");
  });

  it("falls back to DEV_HUB_CONFIG when DEV_HUB_WORKSPACE is unset", async () => {
    const configFile = join(tmpDir, "dev-hub.toml");
    await writeFile(configFile, MINIMAL_TOML);

    process.env.DEV_HUB_CONFIG = configFile;

    const ctx = await createServerContext();

    expect(ctx.workspaceRoot).toBe(tmpDir);
  });

  it("throws ConfigNotFoundError when no config exists", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "dh-empty-"));
    dirsToClean.push(emptyDir);

    await expect(createServerContext(emptyDir)).rejects.toThrow(
      ConfigNotFoundError,
    );
  });

  it("explicit arg overrides env vars", async () => {
    const dir1 = await mkdtemp(join(tmpdir(), "dh-arg-"));
    dirsToClean.push(dir1);

    await writeFile(
      join(dir1, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", "from-arg"),
    );
    await writeFile(
      join(tmpDir, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", "from-env"),
    );

    process.env.DEV_HUB_WORKSPACE = tmpDir;

    const ctx = await createServerContext(dir1);

    expect(ctx.config.workspace.name).toBe("from-arg");
  });

  it("falls back to XDG global config defaults.workspace when no config found", async () => {
    const wsDir = await mkdtemp(join(tmpdir(), "dh-xdg-ws-"));
    const xdgDir = await mkdtemp(join(tmpdir(), "dh-xdg-cfg-"));
    dirsToClean.push(wsDir, xdgDir);

    await writeFile(
      join(wsDir, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", "from-xdg"),
    );
    const cfgDir = join(xdgDir, "dev-hub");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "config.toml"),
      `[defaults]\nworkspace = "${wsDir}"\n`,
    );
    process.env.XDG_CONFIG_HOME = xdgDir;

    // Pass an empty dir so findConfigFile returns null and XDG fallback kicks in
    const emptyDir = await mkdtemp(join(tmpdir(), "dh-xdg-empty-"));
    dirsToClean.push(emptyDir);

    const ctx = await createServerContext(emptyDir);

    expect(ctx.config.workspace.name).toBe("from-xdg");
    expect(ctx.workspaceRoot).toBe(wsDir);
  });

  it("context has switching=false and switchWorkspace function", async () => {
    await writeFile(join(tmpDir, "dev-hub.toml"), MINIMAL_TOML);
    const ctx = await createServerContext(tmpDir);
    expect(ctx.switching).toBe(false);
    expect(typeof ctx.switchWorkspace).toBe("function");
  });
});

describe("switchWorkspace()", () => {
  const dirsToClean: string[] = [];
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    // Isolate global config writes so atomic rename doesn't cross filesystems
    const xdgDir = await mkdtemp(join(tmpdir(), "dh-sw-xdg-"));
    dirsToClean.push(xdgDir);
    process.env.XDG_CONFIG_HOME = xdgDir;
  });

  afterEach(async () => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    for (const dir of dirsToClean) {
      await rm(dir, { recursive: true, force: true });
    }
    dirsToClean.length = 0;
  });

  async function makeWorkspaceDir(name: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `dh-sw-${name}-`));
    dirsToClean.push(dir);
    await writeFile(
      join(dir, "dev-hub.toml"),
      MINIMAL_TOML.replace("test-ws", name),
    );
    return dir;
  }

  it("switches workspace — config and workspaceRoot updated", async () => {
    const dir1 = await makeWorkspaceDir("ws-one");
    const dir2 = await makeWorkspaceDir("ws-two");

    const ctx = await createServerContext(dir1);
    expect(ctx.config.workspace.name).toBe("ws-one");

    await ctx.switchWorkspace(dir2);

    expect(ctx.config.workspace.name).toBe("ws-two");
    expect(ctx.workspaceRoot).toBe(dir2);
  });

  it("switching flag is false after a successful switch", async () => {
    const dir1 = await makeWorkspaceDir("ws-a");
    const dir2 = await makeWorkspaceDir("ws-b");

    const ctx = await createServerContext(dir1);
    await ctx.switchWorkspace(dir2);

    expect(ctx.switching).toBe(false);
  });

  it("old service emitters have no listeners after switch (no memory leak)", async () => {
    const dir1 = await makeWorkspaceDir("ws-leak-a");
    const dir2 = await makeWorkspaceDir("ws-leak-b");

    const ctx = await createServerContext(dir1);
    const oldBulkGit = ctx.bulkGitService;
    const oldBuild = ctx.buildService;
    const oldRun = ctx.runService;
    const oldCommand = ctx.commandService;

    await ctx.switchWorkspace(dir2);

    expect(oldBulkGit.emitter.listenerCount("progress")).toBe(0);
    expect(oldBuild.emitter.listenerCount("progress")).toBe(0);
    expect(oldRun.emitter.listenerCount("progress")).toBe(0);
    expect(oldCommand.emitter.listenerCount("progress")).toBe(0);
  });

  it("broadcasts workspace:changed SSE event", async () => {
    const dir1 = await makeWorkspaceDir("ws-bcast-a");
    const dir2 = await makeWorkspaceDir("ws-bcast-b");

    const ctx = await createServerContext(dir1);
    const events: unknown[] = [];
    ctx.sseClients.add({ send: (e) => events.push(e) });

    await ctx.switchWorkspace(dir2);

    const changed = events.find(
      (e) => (e as { type: string }).type === "workspace:changed",
    );
    expect(changed).toBeDefined();
    expect((changed as { data: { name: string } }).data.name).toBe("ws-bcast-b");
  });

  it("throws ConfigNotFoundError for invalid path, switching resets to false", async () => {
    const dir1 = await makeWorkspaceDir("ws-err");
    const emptyDir = await mkdtemp(join(tmpdir(), "dh-sw-empty-"));
    dirsToClean.push(emptyDir);

    const ctx = await createServerContext(dir1);

    await expect(ctx.switchWorkspace(emptyDir)).rejects.toThrow(ConfigNotFoundError);
    expect(ctx.switching).toBe(false);
  });

  it("rejects concurrent switchWorkspace call while one is in progress", async () => {
    const dir1 = await makeWorkspaceDir("ws-conc-a");
    const dir2 = await makeWorkspaceDir("ws-conc-b");

    const ctx = await createServerContext(dir1);

    // Manually set switching to simulate an in-progress switch
    ctx.switching = true;

    await expect(ctx.switchWorkspace(dir2)).rejects.toThrow(
      "Workspace switch already in progress",
    );

    // Reset so cleanup works
    ctx.switching = false;
  });

  it("throws ConfigNotFoundError for path with no dev-hub.toml (path guard is at route level)", async () => {
    const dir1 = await makeWorkspaceDir("ws-path-check");
    const emptyInsideHome = await mkdtemp(join(tmpdir(), "dh-sw-notoml-"));
    dirsToClean.push(emptyInsideHome);

    const ctx = await createServerContext(dir1);

    // switchWorkspace itself has no home-dir restriction; that guard is in the HTTP route
    await expect(ctx.switchWorkspace(emptyInsideHome)).rejects.toThrow(ConfigNotFoundError);
    expect(ctx.switching).toBe(false);
  });
});
