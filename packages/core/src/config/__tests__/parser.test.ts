import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfig, writeConfig, validateConfig } from "../parser.js";

describe("validateConfig", () => {
  it("returns ok for valid config", () => {
    const result = validateConfig({
      workspace: { name: "test-ws" },
      projects: [{ name: "api", path: "./api", type: "maven" }],
    });
    expect(result.ok).toBe(true);
  });

  it("returns error for invalid config", () => {
    const result = validateConfig({ workspace: {} });
    expect(result.ok).toBe(false);
  });
});

describe("readConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("parses a valid TOML config file", async () => {
    const toml = `
[workspace]
name = "my-workspace"

[[projects]]
name = "api"
path = "./api"
type = "maven"
build_command = "mvn package"
`;
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, toml);

    const config = await readConfig(configPath);
    expect(config.workspace.name).toBe("my-workspace");
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].name).toBe("api");
    expect(config.projects[0].buildCommand).toBe("mvn package");
    expect(config.projects[0].type).toBe("maven");
  });

  it("resolves project paths to absolute", async () => {
    const toml = `
[workspace]
name = "ws"

[[projects]]
name = "api"
path = "./api"
type = "cargo"
`;
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, toml);

    const config = await readConfig(configPath);
    expect(config.projects[0].path).toBe(join(tmpDir, "api"));
  });

  it("throws on invalid TOML", async () => {
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, "not = valid = toml !!!");

    await expect(readConfig(configPath)).rejects.toThrow("Invalid TOML");
  });

  it("throws on schema violations", async () => {
    const toml = `
[workspace]
name = ""
`;
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, toml);

    await expect(readConfig(configPath)).rejects.toThrow(
      "Config validation failed",
    );
  });
});

describe("writeConfig + readConfig round-trip", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("round-trips config without data loss", async () => {
    const toml = `
[workspace]
name = "round-trip-ws"

[[projects]]
name = "backend"
path = "./backend"
type = "gradle"
`;
    const configPath = join(tmpDir, "dev-hub.toml");
    await writeFile(configPath, toml);

    const original = await readConfig(configPath);

    // Write back to the same directory
    const configPath2 = join(tmpDir, "dev-hub2.toml");
    await writeConfig(configPath2, original);

    // Paths must be relative (not absolute) in the written file
    const content = await readFile(configPath2, "utf-8");
    expect(content).toContain("round-trip-ws");
    expect(content).toContain("backend");
    expect(content).toContain("gradle");
    expect(content).not.toContain(tmpDir); // no absolute paths leaked

    // Re-reading should produce the same absolute paths
    const reread = await readConfig(configPath2);
    expect(reread.projects[0].path).toBe(original.projects[0].path);
  });

  it("writeConfig fails gracefully on unwritable directory", async () => {
    const config = await readConfig(
      await (async () => {
        const p = join(tmpDir, "dev-hub.toml");
        await writeFile(p, "[workspace]\nname = \"ws\"\n");
        return p;
      })(),
    );
    const badPath = join(tmpDir, "nonexistent-dir", "dev-hub.toml");
    await expect(writeConfig(badPath, config)).rejects.toThrow();
  });
});
