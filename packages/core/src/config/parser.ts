import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "smol-toml";
import type { ZodError } from "zod";
import { DevHubConfigSchema } from "./schema.js";
import type { DevHubConfig, ProjectConfig } from "./schema.js";

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export class ConfigParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConfigParseError";
  }
}

export function validateConfig(
  raw: unknown,
): Result<DevHubConfig, ZodError> {
  const result = DevHubConfigSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error };
}

export async function readConfig(filePath: string): Promise<DevHubConfig> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new ConfigParseError(`Cannot read config file: ${filePath}`, err);
  }

  let raw: unknown;
  try {
    raw = parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigParseError(`Invalid TOML in ${filePath}: ${msg}`, err);
  }

  const result = validateConfig(raw);
  if (!result.ok) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigParseError(
      `Config validation failed in ${filePath}:\n${issues}`,
    );
  }

  const configDir = dirname(resolve(filePath));
  const config = result.value;

  // Resolve project paths to absolute at runtime
  const resolvedProjects: ProjectConfig[] = config.projects.map((p) => ({
    ...p,
    path: resolve(configDir, p.path),
  }));

  return { ...config, projects: resolvedProjects };
}

export async function writeConfig(
  filePath: string,
  config: DevHubConfig,
): Promise<void> {
  const absFilePath = resolve(filePath);
  const configDir = dirname(absFilePath);

  // Convert absolute project paths back to relative (relative to config file dir)
  const raw = {
    workspace: config.workspace,
    projects: config.projects.map((p) => {
      const projectPath = resolve(p.path);
      const relPath = relative(configDir, projectPath) || ".";
      return {
        name: p.name,
        path: relPath,
        type: p.type,
        ...(p.buildCommand !== undefined && { build_command: p.buildCommand }),
        ...(p.runCommand !== undefined && { run_command: p.runCommand }),
        ...(p.envFile !== undefined && { env_file: p.envFile }),
        ...(p.tags !== undefined && { tags: p.tags }),
      };
    }),
  };

  const toml = stringify(raw as Parameters<typeof stringify>[0]);

  // Atomic write: write to temp file in same directory, then rename
  const tmpPath = join(configDir, `.dev-hub-tmp-${randomBytes(6).toString("hex")}.toml`);
  try {
    await writeFile(tmpPath, toml, "utf-8");
    await rename(tmpPath, absFilePath);
  } catch (err) {
    // Best-effort cleanup
    try {
      await writeFile(tmpPath, "", "utf-8");
    } catch {
      // ignore
    }
    throw err;
  }
}
