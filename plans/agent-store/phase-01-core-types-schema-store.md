# Phase 01: Core Types, Schema & Store Service

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: None (first phase)

## Overview
- **Date**: 2026-03-28
- **Description**: Define the data model, Zod schemas, and core store service for the agent store. This phase produces the `@dev-hub/core` module that all subsequent phases depend on.
- **Priority**: P1
- **Implementation status**: done (2026-03-28)

## Architecture

```
packages/core/src/
├── agent-store/              ← NEW module
│   ├── index.ts              ← public API (re-exports)
│   ├── types.ts              ← TypeScript types + enums
│   ├── schema.ts             ← Zod schemas for TOML config + SKILL.md parsing
│   ├── store.ts              ← Central store CRUD (list, add, remove, get)
│   ├── parsers.ts            ← Parse SKILL.md frontmatter, command .md, MCP JSON
│   └── __tests__/
│       ├── store.test.ts
│       └── parsers.test.ts
├── config/
│   └── schema.ts             ← EXTEND with agent_store + projects.agents sections
└── index.ts                  ← ADD export for agent-store module
```

## Implementation Steps

### Step 1: Define types
**File**: `packages/core/src/agent-store/types.ts`

```ts
/** Supported AI agents */
export type AgentType = "claude" | "gemini";

/** Categories of items in the agent store */
export type AgentItemCategory = "skill" | "command" | "hook" | "mcp-server" | "subagent" | "memory-template";

/** Distribution method when shipping to projects */
export type DistributionMethod = "symlink" | "copy";

/** Where each agent expects its configs */
export const AGENT_PATHS: Record<AgentType, AgentPathConfig> = {
  claude: {
    root: ".claude",
    skills: ".claude/skills",
    commands: ".claude/commands",
    hooks: ".claude/hooks",
    mcpConfig: ".claude/.mcp.json",
    memoryFile: "CLAUDE.md",
  },
  gemini: {
    root: ".gemini",
    skills: ".gemini/skills",
    commands: ".gemini/commands",
    hooks: ".gemini/hooks",
    mcpConfig: ".gemini/.mcp.json",
    memoryFile: "GEMINI.md",
  },
};

export interface AgentPathConfig {
  root: string;
  skills: string;
  commands: string;
  hooks: string;
  mcpConfig: string;
  memoryFile: string;
}

/** Metadata for a single item in the central store */
export interface AgentStoreItem {
  /** Unique name (directory name for skills, filename without ext for commands) */
  name: string;
  category: AgentItemCategory;
  /** Relative path from agent store root to this item */
  relativePath: string;
  /** Parsed metadata (description from frontmatter, etc.) */
  description?: string;
  /** Which agents this item is compatible with */
  compatibleAgents: AgentType[];
  /** Size in bytes (total for skill folders) */
  sizeBytes?: number;
}

/** A skill parsed from SKILL.md */
export interface SkillMeta {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}

/** A command parsed from frontmatter */
export interface CommandMeta {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Assignment: which items are shipped to which project + agent */
export interface AgentAssignment {
  skills?: string[];
  commands?: string[];
  hooks?: string[];
  mcpServers?: string[];
  subagents?: string[];
  distribution?: DistributionMethod;
  memoryTemplate?: string;
}

/** Per-project agent config: { claude: AgentAssignment, gemini: AgentAssignment } */
export type ProjectAgentConfig = Partial<Record<AgentType, AgentAssignment>>;

/** Result of scanning a project for existing agent configs */
export interface ProjectAgentScanResult {
  projectName: string;
  projectPath: string;
  agents: Partial<Record<AgentType, {
    hasConfig: boolean;
    skills: string[];
    commands: string[];
    hooks: string[];
    hasMemoryFile: boolean;
    hasMcpConfig: boolean;
  }>>;
}

/** Ship/unship operation result */
export interface ShipResult {
  item: string;
  category: AgentItemCategory;
  project: string;
  agent: AgentType;
  method: DistributionMethod;
  success: boolean;
  error?: string;
  /** Absolute path of created symlink or copied file */
  targetPath?: string;
}
```

### Step 2: Define Zod schemas
**File**: `packages/core/src/agent-store/schema.ts`

```ts
import { z } from "zod";

// Schema for SKILL.md YAML frontmatter
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, "Must be lowercase hyphen-case"),
  description: z.string().min(1),
  license: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
});

// Schema for command .md YAML frontmatter
export const CommandFrontmatterSchema = z.object({
  description: z.string().min(1),
  "argument-hint": z.string().optional(),
});

// Schema for [agent_store] section in dev-hub.toml
export const AgentStoreConfigSchema = z.object({
  path: z.string().default(".dev-hub/agent-store"),
});

// Schema for per-project [projects.agents.*] config
export const AgentAssignmentSchema = z.object({
  skills: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  hooks: z.array(z.string()).optional(),
  mcp_servers: z.array(z.string()).optional(),
  subagents: z.array(z.string()).optional(),
  distribution: z.enum(["symlink", "copy"]).default("symlink"),
  memory_template: z.string().optional(),
}).transform(a => ({
  skills: a.skills,
  commands: a.commands,
  hooks: a.hooks,
  mcpServers: a.mcp_servers,
  subagents: a.subagents,
  distribution: a.distribution,
  memoryTemplate: a.memory_template,
}));

export const ProjectAgentsSchema = z.object({
  claude: AgentAssignmentSchema.optional(),
  gemini: AgentAssignmentSchema.optional(),
}).optional();
```

### Step 3: Extend existing config schema
**File**: `packages/core/src/config/schema.ts`

Add `agent_store` to `DevHubConfigSchema` and `agents` to `ProjectConfigSchema`.

- Add optional `agent_store` field to workspace-level config
- Add optional `agents` field to project config
- Both are optional for backward compatibility — existing `dev-hub.toml` files without these sections continue to work

```ts
// In DevHubConfigSchema, add:
import { AgentStoreConfigSchema, ProjectAgentsSchema } from "../agent-store/schema.js";

// Extend workspace-level:
agent_store: AgentStoreConfigSchema.optional(),

// Extend project-level:
agents: ProjectAgentsSchema,
```

### Step 4: Build SKILL.md / Command .md parsers
**File**: `packages/core/src/agent-store/parsers.ts`

```ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { SkillFrontmatterSchema, CommandFrontmatterSchema } from "./schema.js";
import type { SkillMeta, CommandMeta, AgentStoreItem } from "./types.js";

/**
 * Parse YAML frontmatter from a markdown file.
 * Handles --- delimited frontmatter at file start.
 */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  // Simple YAML frontmatter parser (or use a lightweight lib like gray-matter)
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, body: content };
  // Parse YAML key-value pairs (simplified — consider using yaml package)
  // Implementation: use `yaml` package for robust parsing
  // ...
}

/** Parse a SKILL.md file and validate frontmatter */
export async function parseSkillMd(skillDir: string): Promise<SkillMeta> {
  const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
  const { data } = parseFrontmatter(content);
  const parsed = SkillFrontmatterSchema.parse(data);
  return {
    name: parsed.name,
    description: parsed.description,
    license: parsed.license,
    allowedTools: parsed["allowed-tools"],
    metadata: parsed.metadata,
  };
}

/** Parse a command .md file and extract frontmatter */
export async function parseCommandMd(filePath: string): Promise<CommandMeta> {
  const content = await readFile(filePath, "utf-8");
  const { data } = parseFrontmatter(content);
  const parsed = CommandFrontmatterSchema.parse(data);
  return {
    name: basename(filePath, ".md"),
    description: parsed.description,
    argumentHint: parsed["argument-hint"],
  };
}

/** Calculate total size of a directory recursively */
export async function dirSize(dirPath: string): Promise<number> {
  // Recursive directory size calculation
  // ...
}
```

### Step 5: Build central store service
**File**: `packages/core/src/agent-store/store.ts`

```ts
import { readdir, stat, mkdir, cp, rm, lstat, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseSkillMd, parseCommandMd } from "./parsers.js";
import type {
  AgentStoreItem,
  AgentItemCategory,
  AgentType,
} from "./types.js";

const CATEGORY_DIRS: Record<AgentItemCategory, string> = {
  skill: "skills",
  command: "commands",
  hook: "hooks",
  "mcp-server": "mcp-servers",
  subagent: "subagents",
  "memory-template": "memory-templates",
};

export class AgentStoreService {
  constructor(private readonly storePath: string) {}

  /** Ensure the store directory structure exists */
  async init(): Promise<void> {
    for (const dir of Object.values(CATEGORY_DIRS)) {
      await mkdir(join(this.storePath, dir), { recursive: true });
    }
  }

  /** List all items in the central store */
  async list(category?: AgentItemCategory): Promise<AgentStoreItem[]> {
    const categories = category ? [category] : Object.keys(CATEGORY_DIRS) as AgentItemCategory[];
    const items: AgentStoreItem[] = [];
    for (const cat of categories) {
      const dir = join(this.storePath, CATEGORY_DIRS[cat]);
      const catItems = await this.listCategory(dir, cat);
      items.push(...catItems);
    }
    return items;
  }

  /** Add an item to the store (copy from source path) */
  async add(sourcePath: string, category: AgentItemCategory, name?: string): Promise<AgentStoreItem> {
    // Copy source to store/<category>/<name>
    // Parse metadata from SKILL.md / command .md
    // Return created item
  }

  /** Remove an item from the store */
  async remove(name: string, category: AgentItemCategory): Promise<void> {
    const targetDir = join(this.storePath, CATEGORY_DIRS[category], name);
    await rm(targetDir, { recursive: true, force: true });
  }

  /** Get detailed info for a single item */
  async get(name: string, category: AgentItemCategory): Promise<AgentStoreItem | null> {
    // Read and parse the item, return full metadata
  }

  /** Get the content of a file within an item (e.g., SKILL.md body) */
  async getContent(name: string, category: AgentItemCategory, fileName?: string): Promise<string> {
    // Read the main file (SKILL.md for skills, <name>.md for commands)
  }

  private async listCategory(dir: string, category: AgentItemCategory): Promise<AgentStoreItem[]> {
    // For skills: each subdirectory with a SKILL.md
    // For commands: each .md file
    // For hooks: each script file
    // etc.
  }
}
```

### Step 6: Export from core index
**File**: `packages/core/src/index.ts`

```ts
export const VERSION = "0.1.0";
export * from "./config/index.js";
export * from "./git/index.js";
export * from "./build/index.js";
export * from "./commands/index.js";
export * from "./agent-store/index.js"; // NEW
```

### Step 7: Write tests
**File**: `packages/core/src/agent-store/__tests__/store.test.ts`

Test cases:
- `init()` creates directory structure
- `list()` returns empty array for fresh store
- `add()` copies skill folder and parses SKILL.md metadata
- `add()` copies command .md and parses frontmatter
- `remove()` deletes item from store
- `get()` returns null for non-existent item
- `getContent()` returns file content

**File**: `packages/core/src/agent-store/__tests__/parsers.test.ts`

Test cases:
- Parse valid SKILL.md frontmatter (name, description, license, allowed-tools)
- Reject invalid frontmatter (missing name, invalid name format)
- Parse command .md frontmatter (description, argument-hint)
- `parseFrontmatter()` handles files without frontmatter
- `parseFrontmatter()` handles Windows line endings

## Dependencies (npm packages)
- `yaml` — for parsing YAML frontmatter in SKILL.md files (lightweight, pure JS)
  - Alternative: `gray-matter` — widely used, handles frontmatter + body split
  - Recommendation: `yaml` — smaller, no extra deps, we only need the parser

## Todo
- [ ] Create `agent-store/types.ts` with all type definitions
- [ ] Create `agent-store/schema.ts` with Zod schemas
- [ ] Extend `config/schema.ts` with optional `agent_store` and `projects.agents` fields
- [ ] Implement `parsers.ts` (SKILL.md + command .md frontmatter parsing)
- [ ] Implement `store.ts` (AgentStoreService class)
- [ ] Create `agent-store/index.ts` with public exports
- [ ] Update `core/src/index.ts` to export agent-store module
- [ ] Install `yaml` package in `@dev-hub/core`
- [ ] Write unit tests for store and parsers
- [ ] Verify existing `dev-hub.toml` files without `[agent_store]` still parse correctly

## Success Criteria
- All types compile with `strict: true`
- Existing config parsing works unchanged (backward compatible)
- `AgentStoreService.init()` creates correct directory structure
- `AgentStoreService.list()` correctly discovers skills and commands
- `AgentStoreService.add()` copies a skill folder and parses its metadata
- SKILL.md parser extracts name, description, and optional fields
- Command .md parser extracts description and argument-hint
- All unit tests pass

## Risk Assessment
- **Low**: YAML parser choice — `yaml` package is stable, well-maintained
- **Low**: Schema extension — optional fields ensure backward compat
- **Medium**: Frontmatter parsing edge cases — some files may have unusual frontmatter (multi-line descriptions, nested YAML). Mitigate with thorough test coverage and `yaml` package robustness.

## Next Steps
→ Phase 02: Scanner (discover existing agent configs in projects) & Distributor (ship/unship via symlink/copy)
