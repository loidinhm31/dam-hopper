import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFile, resolveEnv } from "../env-loader.js";
import type { ProjectConfig } from "../../config/index.js";

describe("loadEnvFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `env-loader-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(content: string) {
    const p = join(dir, ".env");
    await writeFile(p, content, "utf-8");
    return p;
  }

  it("parses basic KEY=VALUE pairs", async () => {
    const p = await write("FOO=bar\nBAZ=qux\n");
    expect(await loadEnvFile(p)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("skips empty lines and comments", async () => {
    const p = await write("# comment\n\nFOO=bar\n# another\nBAZ=qux\n");
    expect(await loadEnvFile(p)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("handles double-quoted values", async () => {
    const p = await write('DB_URL="postgresql://localhost:5432/db"\n');
    expect(await loadEnvFile(p)).toEqual({ DB_URL: "postgresql://localhost:5432/db" });
  });

  it("handles single-quoted values", async () => {
    const p = await write("SECRET='my secret value'\n");
    expect(await loadEnvFile(p)).toEqual({ SECRET: "my secret value" });
  });

  it("strips export prefix", async () => {
    const p = await write("export PORT=3000\nexport HOST=localhost\n");
    expect(await loadEnvFile(p)).toEqual({ PORT: "3000", HOST: "localhost" });
  });

  it("handles values with equals signs", async () => {
    const p = await write("TOKEN=abc=def=ghi\n");
    expect(await loadEnvFile(p)).toEqual({ TOKEN: "abc=def=ghi" });
  });

  it("returns empty object for empty file", async () => {
    const p = await write("");
    expect(await loadEnvFile(p)).toEqual({});
  });
});

describe("resolveEnv", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `resolve-env-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeProject(envFile?: string): ProjectConfig {
    return {
      name: "proj",
      path: dir,
      type: "custom",
      buildCommand: undefined,
      runCommand: undefined,
      envFile,
      tags: undefined,
    };
  }

  it("returns process.env when no envFile set", async () => {
    const env = await resolveEnv(makeProject(), dir);
    expect(env).toMatchObject(
      Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
    );
  });

  it("env file values override process.env", async () => {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "MY_CUSTOM_VAR=from_file\n", "utf-8");

    const env = await resolveEnv(makeProject(".env"), dir);
    expect(env.MY_CUSTOM_VAR).toBe("from_file");
  });

  it("falls back to process.env if envFile does not exist", async () => {
    const env = await resolveEnv(makeProject("nonexistent.env"), dir);
    // Should not throw; returns base env
    expect(typeof env).toBe("object");
  });
});
