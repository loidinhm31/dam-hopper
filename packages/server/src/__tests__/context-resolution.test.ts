import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dh-ctx-"));
    dirsToClean.push(tmpDir);
    delete process.env.DEV_HUB_WORKSPACE;
    delete process.env.DEV_HUB_CONFIG;
  });

  afterEach(async () => {
    delete process.env.DEV_HUB_WORKSPACE;
    delete process.env.DEV_HUB_CONFIG;
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
});
