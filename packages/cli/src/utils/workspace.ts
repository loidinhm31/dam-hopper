import { dirname } from "node:path";
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

export async function loadWorkspace(startDir?: string): Promise<LoadedWorkspace> {
  const cwd = startDir ?? process.cwd();
  const configPath = await findConfigFile(cwd);
  if (!configPath) {
    console.error(
      `No dev-hub.toml found. Run \`dev-hub init\` to set up a workspace.`,
    );
    process.exit(1);
  }
  try {
    const config = await loadWorkspaceConfig(cwd);
    return { config, configPath, workspaceRoot: dirname(configPath) };
  } catch (err) {
    if (err instanceof ConfigNotFoundError) {
      console.error(
        `No dev-hub.toml found. Run \`dev-hub init\` to set up a workspace.`,
      );
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load workspace config: ${msg}`);
    process.exit(1);
  }
}

export function resolveProjects(
  config: DevHubConfig,
  filter?: string,
) {
  if (!filter) return config.projects;
  const matched = config.projects.filter((p) => p.name === filter);
  if (matched.length === 0) {
    console.error(`Project "${filter}" not found in workspace.`);
    process.exit(1);
  }
  return matched;
}
