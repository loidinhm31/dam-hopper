# Phase 02: Scanner & Distributor (Ship/Unship)

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: Phase 01 (types, schema, store service)

## Overview
- **Date**: 2026-03-28
- **Description**: Build two core services — Scanner (discover existing agent configs in projects) and Distributor (ship/unship items from central store to projects via symlink or copy).
- **Priority**: P1
- **Implementation status**: done (2026-03-28)

## Architecture

```
packages/core/src/agent-store/
├── scanner.ts           ← NEW — discover .claude/, .gemini/ in projects
├── distributor.ts       ← NEW — ship/unship via symlink or copy
├── types.ts             ← FROM Phase 01
├── schema.ts            ← FROM Phase 01
├── store.ts             ← FROM Phase 01
├── parsers.ts           ← FROM Phase 01
└── __tests__/
    ├── scanner.test.ts  ← NEW
    └── distributor.test.ts ← NEW
```

## Implementation Steps

### Step 1: Scanner Service
**File**: `packages/core/src/agent-store/scanner.ts`

The scanner walks each project directory and detects agent config presence.

```ts
import { readdir, stat, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentType,
  ProjectAgentScanResult,
  AgentPathConfig,
} from "./types.js";
import { AGENT_PATHS } from "./types.js";
import { fileExists } from "../utils/fs.js";

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

  for (const [agent, paths] of Object.entries(AGENT_PATHS) as [AgentType, AgentPathConfig][]) {
    const rootDir = join(projectPath, paths.root);
    if (!(await fileExists(rootDir))) continue;

    const skills = await listSubdirs(join(projectPath, paths.skills));
    const commands = await listMdFiles(join(projectPath, paths.commands));
    const hooks = await listFiles(join(projectPath, paths.hooks));
    const hasMemoryFile = await fileExists(join(projectPath, paths.memoryFile));
    const hasMcpConfig = await fileExists(join(projectPath, paths.mcpConfig));

    result.agents[agent] = {
      hasConfig: true,
      skills,
      commands,
      hooks,
      hasMemoryFile,
      hasMcpConfig,
    };
  }

  return result;
}

/**
 * Scan all projects in the workspace for agent configurations.
 * Uses the project list from dev-hub.toml config.
 */
export async function scanAllProjects(
  projects: Array<{ name: string; path: string }>,
  workspaceRoot: string,
): Promise<ProjectAgentScanResult[]> {
  return Promise.all(
    projects.map((p) =>
      scanProject(p.name, join(workspaceRoot, p.path)),
    ),
  );
}

/**
 * Check if a path is a symlink and resolve its target.
 * Used to detect items already shipped from central store.
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
async function listSubdirs(dir: string): Promise<string[]> { /* ... */ }

/** List .md files (for commands) */
async function listMdFiles(dir: string): Promise<string[]> { /* ... */ }

/** List all files (for hooks) */
async function listFiles(dir: string): Promise<string[]> { /* ... */ }
```

### Step 2: Distributor Service
**File**: `packages/core/src/agent-store/distributor.ts`

The distributor ships items from central store to project agent directories.

```ts
import { symlink, cp, rm, mkdir, lstat, readlink, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileExists } from "../utils/fs.js";
import type {
  AgentType,
  AgentItemCategory,
  DistributionMethod,
  ShipResult,
  AgentPathConfig,
} from "./types.js";
import { AGENT_PATHS } from "./types.js";

/** Maps item category to the agent subdirectory where it belongs */
const CATEGORY_TO_AGENT_DIR: Record<AgentItemCategory, keyof AgentPathConfig> = {
  skill: "skills",
  command: "commands",
  hook: "hooks",
  "mcp-server": "mcpConfig",  // special handling — merges into .mcp.json
  subagent: "root",           // placed in agent root dir
  "memory-template": "root",  // special handling — generates memory file
};

/**
 * Ship an item from central store to a project for a specific agent.
 *
 * For skills:   symlink  <project>/.claude/skills/<name>  →  <store>/skills/<name>
 * For commands: symlink  <project>/.claude/commands/<name>.md  →  <store>/commands/<name>.md
 *
 * @param storePath  Absolute path to agent store root
 * @param itemName   Name of the item to ship
 * @param category   Category of the item
 * @param projectPath Absolute path to the project directory
 * @param agent      Target agent (claude or gemini)
 * @param method     Distribution method (symlink or copy)
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
    // Determine source and target paths
    const { sourcePath, targetPath } = resolveShipPaths(
      storePath, itemName, category, projectPath, agentPaths,
    );

    // Ensure parent directory exists
    const targetDir = join(targetPath, "..");
    await mkdir(targetDir, { recursive: true });

    // Check if target already exists
    if (await fileExists(targetPath)) {
      const linkInfo = await checkExistingTarget(targetPath, sourcePath);
      if (linkInfo.alreadyLinked) {
        result.success = true;
        result.targetPath = targetPath;
        return result; // Already shipped, no-op
      }
      // Target exists but is not a link to our store — refuse to overwrite
      throw new Error(
        `Target already exists and is not a store symlink: ${targetPath}`,
      );
    }

    // Create symlink or copy
    if (method === "symlink") {
      // Use relative path for symlink to be workspace-portable
      const relSource = relative(targetDir, sourcePath);
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
 * Only removes symlinks pointing to our store, or copies with a manifest match.
 */
export async function unship(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agent: AgentType,
): Promise<ShipResult> {
  const agentPaths = AGENT_PATHS[agent];
  const result: ShipResult = {
    item: itemName,
    category,
    project: projectPath,
    agent,
    method: "symlink",
    success: false,
  };

  try {
    const { targetPath } = resolveShipPaths(
      storePath, itemName, category, projectPath, agentPaths,
    );

    if (!(await fileExists(targetPath))) {
      result.success = true; // Already gone
      return result;
    }

    // Safety: only remove if it's a symlink to our store
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) {
      await unlink(targetPath);
    } else {
      // For copies, remove the directory/file
      await rm(targetPath, { recursive: true, force: true });
    }

    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Bulk ship: ship multiple items to multiple projects.
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
 * Get distribution status: for each item in store, which projects have it shipped.
 */
export async function getDistributionMatrix(
  storePath: string,
  storeItems: Array<{ name: string; category: AgentItemCategory }>,
  projects: Array<{ name: string; path: string }>,
  agents: AgentType[],
): Promise<Map<string, Map<string, { shipped: boolean; method: DistributionMethod | null }>>> {
  // Returns: itemKey → projectName → { shipped, method }
  // Check each project for the presence of each item (symlink or file)
}

/**
 * Health check: find broken symlinks, items shipped but not in manifest, etc.
 */
export async function healthCheck(
  storePath: string,
  projects: Array<{ name: string; path: string }>,
  agents: AgentType[],
): Promise<HealthCheckResult> {
  // Scan for broken symlinks
  // Compare manifest (dev-hub.toml) vs filesystem reality
  // Report discrepancies
}

export interface HealthCheckResult {
  brokenSymlinks: Array<{ project: string; path: string; target: string }>;
  orphanedItems: Array<{ project: string; path: string; reason: string }>;
  missingFromManifest: Array<{ project: string; item: string; category: AgentItemCategory }>;
}

// ── Internal helpers ─────────────────────────────────────────────────

function resolveShipPaths(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agentPaths: AgentPathConfig,
): { sourcePath: string; targetPath: string } {
  // Map category to store source and project target
  // Skills: store/skills/<name> → project/.claude/skills/<name>
  // Commands: store/commands/<name>.md → project/.claude/commands/<name>.md
  // ...
}

async function checkExistingTarget(
  targetPath: string,
  expectedSource: string,
): Promise<{ alreadyLinked: boolean }> {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) {
      const actual = await readlink(targetPath);
      // Check if symlink already points to our store item
      return { alreadyLinked: resolve(join(targetPath, "..", actual)) === expectedSource };
    }
    return { alreadyLinked: false };
  } catch {
    return { alreadyLinked: false };
  }
}
```

### Step 3: Absorb — centralize existing project skills
**File**: Add to `distributor.ts`

```ts
/**
 * Absorb: move an existing skill/command from a project into the central store,
 * then create a symlink at the original location.
 *
 * This is the "centralize" operation for first-time setup.
 */
export async function absorb(
  storePath: string,
  itemName: string,
  category: AgentItemCategory,
  projectPath: string,
  agent: AgentType,
): Promise<ShipResult> {
  const agentPaths = AGENT_PATHS[agent];
  const { sourcePath: storeTarget, targetPath: projectItem } = resolveShipPaths(
    storePath, itemName, category, projectPath, agentPaths,
  );

  // 1. Check item exists in project and is NOT already a symlink
  if (!(await fileExists(projectItem))) {
    throw new Error(`Item not found at: ${projectItem}`);
  }
  const stats = await lstat(projectItem);
  if (stats.isSymbolicLink()) {
    throw new Error(`Item is already a symlink: ${projectItem}`);
  }

  // 2. Check store doesn't already have it
  if (await fileExists(storeTarget)) {
    throw new Error(`Item already exists in store: ${storeTarget}`);
  }

  // 3. Move to store
  await cp(projectItem, storeTarget, { recursive: true });

  // 4. Remove original
  await rm(projectItem, { recursive: true, force: true });

  // 5. Create symlink back
  return ship(storePath, itemName, category, projectPath, agent, "symlink");
}
```

### Step 4: Update agent-store/index.ts exports
**File**: `packages/core/src/agent-store/index.ts`

```ts
export * from "./types.js";
export * from "./schema.js";
export * from "./parsers.js";
export * from "./store.js";
export * from "./scanner.js";
export * from "./distributor.js";
```

### Step 5: Write tests

**File**: `packages/core/src/agent-store/__tests__/scanner.test.ts`

Test cases:
- `scanProject()` detects `.claude/` dir with skills and commands
- `scanProject()` detects `.gemini/` dir
- `scanProject()` returns empty agents for project with no agent config
- `scanProject()` detects `CLAUDE.md` presence
- `scanAllProjects()` scans multiple projects concurrently
- `checkSymlink()` correctly identifies symlinks vs regular files

**File**: `packages/core/src/agent-store/__tests__/distributor.test.ts`

Test cases:
- `ship()` creates symlink from project to store (skill)
- `ship()` creates symlink from project to store (command)
- `ship()` with copy method copies files instead of symlink
- `ship()` creates agent directory if missing (`.claude/skills/`)
- `ship()` is idempotent — shipping same item twice is a no-op
- `ship()` refuses to overwrite non-store files
- `unship()` removes symlink
- `unship()` is idempotent for already-removed items
- `absorb()` moves project item to store and symlinks back
- `absorb()` refuses to absorb already-symlinked items
- `bulkShip()` ships to multiple projects
- `healthCheck()` detects broken symlinks

## Todo
- [ ] Implement `scanner.ts` with `scanProject()` and `scanAllProjects()`
- [ ] Implement `distributor.ts` with `ship()`, `unship()`, `bulkShip()`, `absorb()`
- [ ] Implement `healthCheck()` for broken symlink detection
- [ ] Implement `getDistributionMatrix()` for inventory UI
- [ ] Update `index.ts` exports
- [ ] Write scanner tests
- [ ] Write distributor tests (with temp directories)

## Success Criteria
- Scanner correctly discovers agent configs across projects
- `ship()` creates working symlinks that agents can follow
- `unship()` cleanly removes shipped items
- `absorb()` centralizes existing items without breaking agent behavior
- `healthCheck()` detects broken symlinks
- All operations are idempotent and safe (no data loss)

## Risk Assessment
- **Medium**: Symlink path relativity — must use relative paths for workspace portability. Test with nested project structures.
- **Medium**: Race conditions in bulk operations — items shipped concurrently to same project. Mitigate with sequential per-project processing.
- **Low**: Permission errors on symlink creation — Node.js `fs.symlink()` may fail on some systems. Detect and fallback to copy.
- **Low**: Windows compatibility — symlinks require Developer Mode. Detect at runtime.

## Security Considerations
- `absorb()` only processes items within the workspace — no path traversal outside workspace root
- `unship()` verifies item is a symlink to our store before removing — won't delete user's non-managed files
- Symlinks use relative paths — can't escape workspace boundary

## Next Steps
→ Phase 03: IPC channels and Electron main-process handlers to expose store/scanner/distributor to the renderer
