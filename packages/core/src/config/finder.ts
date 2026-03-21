import { dirname, join, parse as parsePath } from "node:path";
import { homedir } from "node:os";
import { fileExists } from "../utils/fs.js";
import { readConfig } from "./parser.js";
import type { DevHubConfig } from "./schema.js";

export const CONFIG_FILENAME = "dev-hub.toml";

export class ConfigNotFoundError extends Error {
  constructor(startDir: string) {
    super(`No ${CONFIG_FILENAME} found starting from: ${startDir}`);
    this.name = "ConfigNotFoundError";
  }
}

export async function findConfigFile(
  startDir: string = process.cwd(),
): Promise<string | null> {
  const home = homedir();
  const { root: fsRoot } = parsePath(startDir);
  let current = startDir;

  while (true) {
    const candidate = join(current, CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    // Stop at filesystem root (handles paths outside home dir too)
    if (parent === current || current === fsRoot) {
      return null;
    }
    // Also stop at home directory to avoid scanning system dirs
    if (current === home) {
      return null;
    }
    current = parent;
  }
}

export async function loadWorkspaceConfig(
  startDir: string = process.cwd(),
): Promise<DevHubConfig> {
  const configPath = await findConfigFile(startDir);
  if (configPath === null) {
    throw new ConfigNotFoundError(startDir);
  }
  return readConfig(configPath);
}
