import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjects, loadWorkspace } from "../utils/workspace.js";
import type { DevHubConfig } from "@dev-hub/core";
import { globalConfigPath } from "@dev-hub/core";

vi.mock("@dev-hub/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findConfigFile: vi.fn(),
    loadWorkspaceConfig: vi.fn(),
    readGlobalConfig: vi.fn().mockResolvedValue(null),
    // globalConfigPath is NOT mocked — use real implementation so error messages are accurate
  };
});

const mockConfig: DevHubConfig = {
  workspace: { name: "test-ws", root: "." },
  projects: [
    { name: "api", path: "/tmp/api", type: "maven" },
    { name: "web", path: "/tmp/web", type: "npm" },
  ],
};

describe("resolveProjects", () => {
  it("returns all projects when no filter given", () => {
    const result = resolveProjects(mockConfig);
    expect(result).toHaveLength(2);
  });

  it("filters by project name", () => {
    const result = resolveProjects(mockConfig, "api");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("api");
  });

  it("exits on unknown project name", () => {
    let didExit = false;
    const origExit = process.exit;
    process.exit = (() => {
      didExit = true;
      throw new Error("exit");
    }) as never;
    try {
      resolveProjects(mockConfig, "nonexistent");
    } catch {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(didExit).toBe(true);
  });
});

describe("loadWorkspace env var", () => {
  let tmpDir: string;
  const dirsToClean: string[] = [];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dh-ws-"));
    dirsToClean.push(tmpDir);
    delete process.env.DEV_HUB_WORKSPACE;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("exit");
      }) as never);
  });

  afterEach(async () => {
    delete process.env.DEV_HUB_WORKSPACE;
    for (const dir of dirsToClean) {
      await rm(dir, { recursive: true, force: true });
    }
    dirsToClean.length = 0;
    vi.restoreAllMocks();
  });

  it("uses DEV_HUB_WORKSPACE when no startDir given", async () => {
    const { findConfigFile, loadWorkspaceConfig } = await import(
      "@dev-hub/core"
    );
    const configPath = join(tmpDir, "dev-hub.toml");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(configPath);
    (loadWorkspaceConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConfig,
    );

    process.env.DEV_HUB_WORKSPACE = tmpDir;
    const result = await loadWorkspace();

    expect(findConfigFile).toHaveBeenCalledWith(tmpDir);
    expect(result.config).toBe(mockConfig);
  });

  it("startDir overrides DEV_HUB_WORKSPACE", async () => {
    const { findConfigFile, loadWorkspaceConfig } = await import(
      "@dev-hub/core"
    );
    const otherDir = await mkdtemp(join(tmpdir(), "dh-ws2-"));
    dirsToClean.push(otherDir);
    const configPath = join(otherDir, "dev-hub.toml");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(configPath);
    (loadWorkspaceConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConfig,
    );

    process.env.DEV_HUB_WORKSPACE = tmpDir;
    const result = await loadWorkspace(otherDir);

    expect(findConfigFile).toHaveBeenCalledWith(otherDir);
    expect(result.config).toBe(mockConfig);
  });

  it("resolves DEV_HUB_WORKSPACE file path to its directory", async () => {
    const { findConfigFile, loadWorkspaceConfig } = await import(
      "@dev-hub/core"
    );
    const configFile = join(tmpDir, "dev-hub.toml");
    await writeFile(configFile, "");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(configFile);
    (loadWorkspaceConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConfig,
    );

    process.env.DEV_HUB_WORKSPACE = configFile;
    await loadWorkspace();

    // Should resolve file to its parent directory
    expect(findConfigFile).toHaveBeenCalledWith(tmpDir);
  });

  it("error message includes --workspace and DEV_HUB_WORKSPACE hint", async () => {
    const { findConfigFile } = await import("@dev-hub/core");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await loadWorkspace();
    } catch {
      // expected exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls[0][0] as string;
    expect(msg).toContain("--workspace");
    expect(msg).toContain("DEV_HUB_WORKSPACE");
  });
});

describe("loadWorkspace XDG global config fallback", () => {
  let tmpDir: string;
  const dirsToClean: string[] = [];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), "dh-xdg-"));
    dirsToClean.push(tmpDir);
    delete process.env.DEV_HUB_WORKSPACE;
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("exit");
      }) as never);
  });

  afterEach(async () => {
    delete process.env.DEV_HUB_WORKSPACE;
    for (const dir of dirsToClean) {
      await rm(dir, { recursive: true, force: true });
    }
    dirsToClean.length = 0;
    vi.restoreAllMocks();
  });

  it("falls back to global config workspace when walk-up finds nothing", async () => {
    const { findConfigFile, loadWorkspaceConfig, readGlobalConfig } =
      await import("@dev-hub/core");
    const configPath = join(tmpDir, "dev-hub.toml");

    // walk-up returns null first call, config found second call (after XDG applied)
    (findConfigFile as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(configPath);
    (loadWorkspaceConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConfig,
    );
    (readGlobalConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaults: { workspace: tmpDir },
    });

    const result = await loadWorkspace();
    expect(result.config).toBe(mockConfig);
    expect(findConfigFile).toHaveBeenCalledTimes(2);
  });

  it("DEV_HUB_WORKSPACE env var overrides global config (no second findConfigFile call)", async () => {
    const { findConfigFile, loadWorkspaceConfig, readGlobalConfig } =
      await import("@dev-hub/core");
    const configPath = join(tmpDir, "dev-hub.toml");

    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(configPath);
    (loadWorkspaceConfig as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConfig,
    );
    (readGlobalConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaults: { workspace: "/other/path" },
    });

    process.env.DEV_HUB_WORKSPACE = tmpDir;
    await loadWorkspace();

    // findConfigFile called once — env var resolved it, no XDG needed
    expect(findConfigFile).toHaveBeenCalledTimes(1);
    expect(readGlobalConfig).not.toHaveBeenCalled();
  });

  it("missing global config silently ignored — exits with error", async () => {
    const { findConfigFile, readGlobalConfig } = await import("@dev-hub/core");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (readGlobalConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await loadWorkspace();
    } catch {
      // expected exit
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("error message mentions global config tip", async () => {
    const { findConfigFile, readGlobalConfig } = await import("@dev-hub/core");
    (findConfigFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (readGlobalConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await loadWorkspace();
    } catch {
      // expected exit
    }

    const msg = errorSpy.mock.calls[0][0] as string;
    expect(msg).toContain(globalConfigPath());
  });
});
