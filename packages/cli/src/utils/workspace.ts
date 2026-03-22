import { dirname, resolve, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import {
  loadWorkspaceConfig,
  findConfigFile,
  readGlobalConfig,
  globalConfigPath,
  type DevHubConfig,
} from "@dev-hub/core";

export interface LoadedWorkspace {
  config: DevHubConfig;
  configPath: string;
  workspaceRoot: string;
}

/** Resolve a path to its directory: if it's a file, return its parent. */
async function normaliseDirPath(p: string): Promise<string> {
  try {
    const s = await stat(p);
    return s.isFile() ? dirname(p) : p;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return p;
  }
}

/**
 * Resolve the workspace directory from flag value, env var, or cwd.
 * Priority: flagValue > DEV_HUB_WORKSPACE > process.cwd()
 * Handles relative paths and file-to-directory resolution.
 */
export async function resolveWorkspaceDir(
  flagValue?: string,
): Promise<string> {
  const raw = flagValue ?? process.env.DEV_HUB_WORKSPACE ?? process.cwd();
  const dir = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  return normaliseDirPath(dir);
}

export async function loadWorkspace(
  startDir?: string,
): Promise<LoadedWorkspace> {
  let cwd = await resolveWorkspaceDir(startDir);

  let configPath = await findConfigFile(cwd);

  // Step 4: XDG global config fallback (only when flag/env/walk-up all miss)
  if (!configPath) {
    const globalCfg = await readGlobalConfig();
    if (globalCfg?.defaults?.workspace) {
      const xdgDir = resolve(globalCfg.defaults.workspace);
      cwd = await normaliseDirPath(xdgDir);
      configPath = await findConfigFile(cwd);
    }
  }

  if (!configPath) {
    console.error(
      `No dev-hub.toml found. Run \`dev-hub init\` to set up a workspace.\n` +
        `  Tip: use --workspace <path>, set DEV_HUB_WORKSPACE, or configure ${globalConfigPath()}`,
    );
    process.exit(1);
  }
  const workspaceRoot = dirname(configPath);
  try {
    const config = await loadWorkspaceConfig(workspaceRoot);
    return { config, configPath, workspaceRoot };
  } catch (err) {
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
