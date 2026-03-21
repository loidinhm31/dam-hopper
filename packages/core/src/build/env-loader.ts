import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectConfig } from "../config/index.js";

/**
 * Parse a .env file and return key-value pairs.
 * Handles: quoted values (single/double), comments, empty lines, export prefix.
 */
export async function loadEnvFile(envFilePath: string): Promise<Record<string, string>> {
  const content = await readFile(envFilePath, "utf-8");
  const result: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Strip optional `export ` prefix
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;

    const eqIdx = stripped.indexOf("=");
    if (eqIdx === -1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = stripped.slice(eqIdx + 1);

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Resolve env for a project: merge process.env with optional .env file values.
 * Env file values override process.env.
 */
export async function resolveEnv(
  project: ProjectConfig,
  workspaceRoot: string,
): Promise<Record<string, string>> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }

  if (!project.envFile) return base;

  const envPath = resolve(project.path || workspaceRoot, project.envFile);
  try {
    const fileEnv = await loadEnvFile(envPath);
    return { ...base, ...fileEnv };
  } catch {
    // If env file doesn't exist or can't be read, fall back to process.env
    return base;
  }
}
