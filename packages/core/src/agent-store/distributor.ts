import {
  symlink,
  cp,
  rm,
  mkdir,
  lstat,
  readlink,
  unlink,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join, relative, resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileExists } from "../utils/fs.js";
import type {
  AgentType,
  AgentItemCategory,
  DistributionMethod,
  ShipResult,
  AgentPathConfig,
} from "./types.js";
import { AGENT_PATHS } from "./types.js";

export interface HealthCheckResult {
  brokenSymlinks: Array<{ project: string; path: string; target: string }>;
  orphanedItems: Array<{ project: string; path: string; reason: string }>;
}

const CATEGORY_STORE_DIRS: Record<AgentItemCategory, string> = {
  skill: "skills",
  command: "commands",
  hook: "hooks",
  "mcp-server": "mcp-servers",
  subagent: "subagents",
  "memory-template": "memory-templates",
};

/** Reject names that could traverse outside the expected directory */
function assertSafeName(name: string): void {
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(sep) ||
    name === ".." ||
    name === "." ||
    name.trim() === ""
  ) {
    throw new Error(`Invalid item name: "${name}"`);
  }
}

/** Returns true if candidate is within (or equal to) root */
function isWithinRoot(candidate: string, root: string): boolean {
  const normalRoot = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(normalRoot);
}

/**
 * Ship an item from the central store to a project for a specific agent.
 *
 * skill:   <project>/.claude/skills/<name>  → <store>/skills/<name>
 * command: <project>/.claude/commands/<name>.md → <store>/commands/<name>.md
 * hook:    <project>/.claude/hooks/<name>   → <store>/hooks/<name>
 * subagent: <project>/.claude/<name>        → <store>/subagents/<name>
 * mcp-server: append-merge into .mcp.json
 * memory-template: not handled here (Phase 05)
 */
export async function ship(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agent: AgentType,
  method: DistributionMethod = "symlink",
): Promise<ShipResult> {
  const agentPaths = AGENT_PATHS[agent];
  const result: ShipResult = {
    item: itemName,
    category,
    project: projectPath,
    agent,
    method,
    success: false,
  };

  try {
    assertSafeName(itemName);

    if (category === "mcp-server") {
      await shipMcpServer(storePath, itemName, projectPath, agentPaths);
      result.success = true;
      result.targetPath = join(projectPath, agentPaths.mcpConfig);
      return result;
    }

    if (category === "memory-template") {
      throw new Error("memory-template distribution not yet implemented (Phase 05)");
    }

    const { sourcePath, targetPath } = resolveShipPaths(
      storePath,
      itemName,
      category,
      projectPath,
      agentPaths,
    );

    await mkdir(dirname(targetPath), { recursive: true });

    if (await fileExists(targetPath)) {
      const { alreadyLinked } = await checkExistingTarget(targetPath, sourcePath);
      if (alreadyLinked) {
        result.success = true;
        result.targetPath = targetPath;
        return result;
      }
      throw new Error(
        `Target already exists and is not a store symlink: ${targetPath}`,
      );
    }

    if (method === "symlink") {
      const relSource = relative(dirname(targetPath), sourcePath);
      await symlink(relSource, targetPath);
    } else {
      await cp(sourcePath, targetPath, { recursive: true });
    }

    result.success = true;
    result.targetPath = targetPath;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Unship: remove a shipped item from a project.
 * For symlinks: always removes. For copies: warns if content differs from store.
 * Returns an additional `modified` flag when a copied file differs.
 */
export async function unship(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agent: AgentType,
  opts: { force?: boolean } = {},
): Promise<ShipResult & { modified?: boolean }> {
  const agentPaths = AGENT_PATHS[agent];

  const makeResult = (
    method: DistributionMethod,
    success: boolean,
    extra?: Partial<ShipResult & { modified?: boolean }>,
  ): ShipResult & { modified?: boolean } => ({
    item: itemName,
    category,
    project: projectPath,
    agent,
    method,
    success,
    ...extra,
  });

  try {
    assertSafeName(itemName);

    if (category === "mcp-server") {
      await unshipMcpServer(storePath, itemName, projectPath, agentPaths);
      return makeResult("symlink", true);
    }

    if (category === "memory-template") {
      throw new Error("memory-template unship not yet implemented (Phase 05)");
    }

    const { sourcePath, targetPath } = resolveShipPaths(
      storePath,
      itemName,
      category,
      projectPath,
      agentPaths,
    );

    if (!(await fileExists(targetPath))) {
      return makeResult("symlink", true); // Already gone
    }

    const stats = await lstat(targetPath);

    if (stats.isSymbolicLink()) {
      await unlink(targetPath);
      return makeResult("symlink", true);
    }

    // Copy case: hash-compare before removing
    const isModified = await contentDiffers(targetPath, sourcePath, stats.isDirectory());
    if (isModified && !opts.force) {
      return makeResult("copy", false, {
        modified: true,
        error: `Copied item "${itemName}" has been modified. Use force:true to remove anyway.`,
      });
    }
    await rm(targetPath, { recursive: true, force: true });
    return makeResult("copy", true);
  } catch (err) {
    return makeResult("symlink", false, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Absorb: move an existing item from a project into the central store,
 * then create a symlink at the original location.
 * Safety order: cp to store → rm original → ship (symlink). If ship fails
 * after rm, the item is preserved in the store and can be re-shipped manually.
 */
export async function absorb(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agent: AgentType,
): Promise<ShipResult> {
  try {
    assertSafeName(itemName);
  } catch (err) {
    return {
      item: itemName,
      category,
      project: projectPath,
      agent,
      method: "symlink",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const agentPaths = AGENT_PATHS[agent];
  const { sourcePath: storeTarget, targetPath: projectItem } = resolveShipPaths(
    storePath,
    itemName,
    category,
    projectPath,
    agentPaths,
  );

  if (!(await fileExists(projectItem))) {
    return {
      item: itemName,
      category,
      project: projectPath,
      agent,
      method: "symlink",
      success: false,
      error: `Item not found at: ${projectItem}`,
    };
  }

  const stats = await lstat(projectItem);
  if (stats.isSymbolicLink()) {
    return {
      item: itemName,
      category,
      project: projectPath,
      agent,
      method: "symlink",
      success: false,
      error: `Item is already a symlink: ${projectItem}`,
    };
  }

  if (await fileExists(storeTarget)) {
    return {
      item: itemName,
      category,
      project: projectPath,
      agent,
      method: "symlink",
      success: false,
      error: `Item already exists in store: ${storeTarget}`,
    };
  }

  await mkdir(dirname(storeTarget), { recursive: true });
  await cp(projectItem, storeTarget, { recursive: true });
  await rm(projectItem, { recursive: true, force: true });

  return ship(storePath, itemName, category, projectPath, agent, "symlink");
}

/**
 * Bulk ship: ship multiple items to multiple projects.
 * Processes projects sequentially to avoid race conditions per project.
 */
export async function bulkShip(
  storePath: string,
  items: Array<{ name: string; category: AgentItemCategory }>,
  projects: Array<{ path: string; agent: AgentType }>,
  method: DistributionMethod = "symlink",
): Promise<ShipResult[]> {
  const results: ShipResult[] = [];
  for (const proj of projects) {
    for (const item of items) {
      const r = await ship(storePath, item.name, item.category, proj.path, proj.agent, method);
      results.push(r);
    }
  }
  return results;
}

/**
 * Get distribution status: for each store item, which projects have it shipped.
 * Returns: itemKey → projKey(`<projectName>:<agent>`) → { shipped, method }
 * Note: mcp-server and memory-template categories are excluded (not file-based).
 */
export async function getDistributionMatrix(
  storePath: string,
  storeItems: Array<{ name: string; category: AgentItemCategory }>,
  projects: Array<{ name: string; path: string }>,
  agents: AgentType[],
): Promise<Map<string, Map<string, { shipped: boolean; method: DistributionMethod | null }>>> {
  const matrix = new Map<
    string,
    Map<string, { shipped: boolean; method: DistributionMethod | null }>
  >();

  const supportedItems = storeItems.filter(
    (i) => i.category !== "mcp-server" && i.category !== "memory-template",
  );

  for (const storeItem of supportedItems) {
    const itemKey = `${storeItem.category}:${storeItem.name}`;
    const projectMap = new Map<
      string,
      { shipped: boolean; method: DistributionMethod | null }
    >();

    for (const project of projects) {
      for (const agent of agents) {
        const projKey = `${project.name}:${agent}`;
        const agentPaths = AGENT_PATHS[agent];
        try {
          const { targetPath } = resolveShipPaths(
            storePath,
            storeItem.name,
            storeItem.category,
            project.path,
            agentPaths,
          );
          if (await fileExists(targetPath)) {
            const lstats = await lstat(targetPath);
            projectMap.set(projKey, {
              shipped: true,
              method: lstats.isSymbolicLink() ? "symlink" : "copy",
            });
          } else {
            projectMap.set(projKey, { shipped: false, method: null });
          }
        } catch {
          projectMap.set(projKey, { shipped: false, method: null });
        }
      }
    }

    matrix.set(itemKey, projectMap);
  }

  return matrix;
}

/**
 * Health check: find broken symlinks in agent dirs across all projects.
 */
export async function healthCheck(
  storePath: string,
  projects: Array<{ name: string; path: string }>,
  agents: AgentType[],
): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    brokenSymlinks: [],
    orphanedItems: [],
  };

  for (const project of projects) {
    for (const agent of agents) {
      const agentPaths = AGENT_PATHS[agent];
      const dirsToCheck = [
        join(project.path, agentPaths.skills),
        join(project.path, agentPaths.commands),
        join(project.path, agentPaths.hooks),
      ];

      for (const dir of dirsToCheck) {
        if (!(await fileExists(dir))) continue;
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = join(dir, entry.name);
            if (entry.isSymbolicLink()) {
              const target = await readlink(entryPath);
              const resolvedTarget = resolve(dirname(entryPath), target);
              if (!(await fileExists(resolvedTarget))) {
                result.brokenSymlinks.push({
                  project: project.name,
                  path: entryPath,
                  target: resolvedTarget,
                });
              } else if (!isWithinRoot(resolvedTarget, storePath)) {
                result.orphanedItems.push({
                  project: project.name,
                  path: entryPath,
                  reason: "symlink points outside agent store",
                });
              }
            }
          }
        } catch {
          // Directory unreadable — skip
        }
      }
    }
  }

  return result;
}

// ── Internal helpers ─────────────────────────────────────────────────

function resolveShipPaths(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agentPaths: AgentPathConfig,
): { sourcePath: string; targetPath: string } {
  const storeDir = join(storePath, CATEGORY_STORE_DIRS[category]);

  if (category === "command") {
    const fileName = itemName.endsWith(".md") ? itemName : `${itemName}.md`;
    return {
      sourcePath: join(storeDir, fileName),
      targetPath: join(projectPath, agentPaths.commands, fileName),
    };
  }

  if (category === "subagent") {
    return {
      sourcePath: join(storeDir, itemName),
      targetPath: join(projectPath, agentPaths.root, itemName),
    };
  }

  if (category === "skill") {
    return {
      sourcePath: join(storeDir, itemName),
      targetPath: join(projectPath, agentPaths.skills, itemName),
    };
  }

  if (category === "hook") {
    return {
      sourcePath: join(storeDir, itemName),
      targetPath: join(projectPath, agentPaths.hooks, itemName),
    };
  }

  throw new Error(`resolveShipPaths: unhandled category "${category}"`);
}

async function checkExistingTarget(
  targetPath: string,
  expectedSource: string,
): Promise<{ alreadyLinked: boolean }> {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) {
      const actual = await readlink(targetPath);
      const resolved = resolve(dirname(targetPath), actual);
      return { alreadyLinked: resolved === expectedSource };
    }
    return { alreadyLinked: false };
  } catch {
    return { alreadyLinked: false };
  }
}

/** Compute SHA-256 hash of a file */
async function fileHash(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Returns true if target content differs from store source.
 * For directories: compares top-level files only (non-recursive for performance).
 * Nested subdirectory changes are not detected.
 */
async function contentDiffers(
  targetPath: string,
  sourcePath: string,
  isDirectory: boolean,
): Promise<boolean> {
  if (!isDirectory) {
    if (!(await fileExists(sourcePath))) return false;
    const [targetH, sourceH] = await Promise.all([
      fileHash(targetPath),
      fileHash(sourcePath),
    ]);
    return targetH !== sourceH;
  }

  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const tFile = join(targetPath, entry.name);
      const sFile = join(sourcePath, entry.name);
      if (!(await fileExists(sFile))) return true;
      const [th, sh] = await Promise.all([fileHash(tFile), fileHash(sFile)]);
      if (th !== sh) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Append-merge an MCP server entry into the project's .mcp.json */
async function shipMcpServer(
  storePath: string,
  serverName: string,
  projectPath: string,
  agentPaths: AgentPathConfig,
): Promise<void> {
  assertSafeName(serverName);
  const fragmentPath = join(storePath, "mcp-servers", `${serverName}.json`);
  if (!(await fileExists(fragmentPath))) {
    throw new Error(`MCP server fragment not found in store: ${fragmentPath}`);
  }

  const fragmentContent = await readFile(fragmentPath, "utf-8");
  const fragment = JSON.parse(fragmentContent) as Record<string, unknown>;

  const mcpConfigPath = join(projectPath, agentPaths.mcpConfig);
  await mkdir(dirname(mcpConfigPath), { recursive: true });

  let existing: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
  if (await fileExists(mcpConfigPath)) {
    const raw = await readFile(mcpConfigPath, "utf-8");
    existing = JSON.parse(raw) as typeof existing;
  }

  existing.mcpServers = { ...(existing.mcpServers ?? {}), ...fragment };
  await writeFile(mcpConfigPath, JSON.stringify(existing, null, 2), "utf-8");
}

/** Remove an MCP server entry from the project's .mcp.json */
async function unshipMcpServer(
  storePath: string,
  serverName: string,
  projectPath: string,
  agentPaths: AgentPathConfig,
): Promise<void> {
  assertSafeName(serverName);
  const fragmentPath = join(storePath, "mcp-servers", `${serverName}.json`);
  const mcpConfigPath = join(projectPath, agentPaths.mcpConfig);

  if (!(await fileExists(mcpConfigPath))) return;

  const raw = await readFile(mcpConfigPath, "utf-8");
  const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };

  if (!config.mcpServers) return;

  if (await fileExists(fragmentPath)) {
    const fragmentContent = await readFile(fragmentPath, "utf-8");
    const fragment = JSON.parse(fragmentContent) as Record<string, unknown>;
    for (const key of Object.keys(fragment)) {
      delete config.mcpServers[key];
    }
  } else {
    delete config.mcpServers[serverName];
  }

  await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), "utf-8");
}
