import { readdir, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "../utils/fs.js";
import type { AgentType, AgentPathConfig, ProjectAgentScanResult } from "./types.js";
import { AGENT_PATHS } from "./types.js";

/**
 * Scan a single project directory for agent configurations.
 * Detects .claude/ and .gemini/ directories and catalogs their contents.
 */
export async function scanProject(
  projectName: string,
  projectPath: string,
): Promise<ProjectAgentScanResult> {
  const result: ProjectAgentScanResult = {
    projectName,
    projectPath,
    agents: {},
  };

  await Promise.all(
    (Object.entries(AGENT_PATHS) as [AgentType, AgentPathConfig][]).map(
      async ([agent, paths]) => {
        const rootDir = join(projectPath, paths.root);
        if (!(await fileExists(rootDir))) return;

        const [skills, commands, hooks, hasMemoryFile, hasMcpConfig] =
          await Promise.all([
            listSubdirs(join(projectPath, paths.skills)),
            listMdFiles(join(projectPath, paths.commands)),
            listFiles(join(projectPath, paths.hooks)),
            fileExists(join(projectPath, paths.memoryFile)),
            fileExists(join(projectPath, paths.mcpConfig)),
          ]);

        result.agents[agent] = {
          hasConfig: true,
          skills,
          commands,
          hooks,
          hasMemoryFile,
          hasMcpConfig,
        };
      },
    ),
  );

  return result;
}

/**
 * Scan all projects in the workspace for agent configurations.
 */
export async function scanAllProjects(
  projects: Array<{ name: string; path: string }>,
  workspaceRoot: string,
): Promise<ProjectAgentScanResult[]> {
  return Promise.all(
    projects.map((p) => scanProject(p.name, join(workspaceRoot, p.path))),
  );
}

/**
 * Check if a path is a symlink and resolve its target.
 */
export async function checkSymlink(path: string): Promise<{
  isSymlink: boolean;
  target?: string;
}> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      const target = await readlink(path);
      return { isSymlink: true, target };
    }
    return { isSymlink: false };
  } catch {
    return { isSymlink: false };
  }
}

/** List subdirectory names (for skills — each skill is a folder) */
async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** List .md filenames without extension (for commands) */
async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.slice(0, -3));
  } catch {
    return [];
  }
}

/** List all filenames (for hooks) */
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
