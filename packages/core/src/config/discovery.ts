import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { fileExists } from "../utils/fs.js";
import { PRESETS } from "./presets.js";
import type { ProjectType } from "./schema.js";

export interface DiscoveredProject {
  name: string;
  path: string;
  type: ProjectType;
  isGitRepo: boolean;
}

// Priority-ordered detection: first match wins
const DETECTION_ORDER: ProjectType[] = [
  "cargo",
  "maven",
  "gradle",
  "pnpm",
  "npm",
];

export async function detectProjectType(
  projectDir: string,
): Promise<ProjectType | null> {
  for (const type of DETECTION_ORDER) {
    const markers = PRESETS[type].markerFiles;
    for (const marker of markers) {
      if (await fileExists(join(projectDir, marker))) {
        return type;
      }
    }
  }
  // Fallback: if package.json exists, treat as npm
  if (await fileExists(join(projectDir, "package.json"))) {
    return "npm";
  }
  return null;
}

export async function discoverProjects(
  rootDir: string,
): Promise<DiscoveredProject[]> {
  let entries: Dirent[];
  try {
    entries = (await readdir(rootDir, { withFileTypes: true })) as Dirent[];
  } catch {
    return [];
  }

  const dirEntries = entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      const name = String(e.name);
      return !name.startsWith(".") && name !== "node_modules";
    });

  const results = await Promise.all(
    dirEntries.map(async (entry) => {
      const entryName = String(entry.name);
      const projectPath = join(rootDir, entryName);
      const type = await detectProjectType(projectPath);
      if (type === null) return null;

      const isGitRepo = await fileExists(join(projectPath, ".git"));
      return { name: entryName, path: projectPath, type, isGitRepo } satisfies DiscoveredProject;
    }),
  );

  return results.filter((r): r is DiscoveredProject => r !== null);
}
