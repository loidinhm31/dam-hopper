import { dirname, resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import {
  loadWorkspaceConfig,
  findConfigFile,
  ConfigNotFoundError,
  type DevHubConfig,
} from "@dev-hub/core";

export interface LoadedWorkspace {
  config: DevHubConfig;
  configPath: string;
  workspaceRoot: string;
}

/**
 * Resolve the workspace directory from flag value, env var, or cwd.
 * Priority: flagValue > DEV_HUB_WORKSPACE > process.cwd()
 * Handles relative paths and file-to-directory resolution.
 */
export async function resolveWorkspaceDir(
  flagValue?: string,
): Promise<string> {
  let dir = flagValue ?? process.env.DEV_HUB_WORKSPACE ?? process.cwd();

  if (!isAbsolute(dir)) {
    dir = resolve(process.cwd(), dir);
  }

  // If the path points directly to a file, use its directory
  try {
    const s = await stat(dir);
    if (s.isFile()) {
      dir = dirname(dir);
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  return dir;
}

export async function loadWorkspace(
  startDir?: string,
): Promise<LoadedWorkspace> {
  const cwd = await resolveWorkspaceDir(startDir);

  const configPath = await findConfigFile(cwd);
  if (!configPath) {
    console.error(
      `No dev-hub.toml found. Run \`dev-hub init\` to set up a workspace.\n` +
        `  Tip: use --workspace <path> or set DEV_HUB_WORKSPACE`,
    );
    process.exit(1);
  }
  const workspaceRoot = dirname(configPath);
  try {
    const config = await loadWorkspaceConfig(workspaceRoot);
    return { config, configPath, workspaceRoot };
  } catch (err) {
    if (err instanceof ConfigNotFoundError) {
      console.error(
        `No dev-hub.toml found. Run \`dev-hub init\` to set up a workspace.\n` +
          `  Tip: use --workspace <path> or set DEV_HUB_WORKSPACE`,
      );
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load workspace config: ${msg}`);
    process.exit(1);
  }
}

export function resolveProjects(config: DevHubConfig, filter?: string) {
  if (!filter) return config.projects;
  const matched = config.projects.filter((p) => p.name === filter);
  if (matched.length === 0) {
    console.error(`Project "${filter}" not found in workspace.`);
    process.exit(1);
  }
  return matched;
}
