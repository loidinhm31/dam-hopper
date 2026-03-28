# Phase 05: Memory Templates & Import from Repo

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: Phase 01-04 (core + IPC + UI in place)

## Overview
- **Date**: 2026-03-28
- **Description**: Add two advanced features — (1) project memory file management (`CLAUDE.md`, `GEMINI.md`) via templates with variable substitution, and (2) import skills/commands from a git repository URL.
- **Priority**: P2
- **Implementation status**: done

## Part A: Memory Templates

### Concept

Memory files (`CLAUDE.md`, `GEMINI.md`) are project-level instruction files that tell the AI agent how to work with the project. Currently, these are manually created per project.

Dev-Hub adds:
1. **Memory templates**: reusable templates stored in the central store
2. **Variable substitution**: templates can reference project properties
3. **View/edit**: inline editor in Agent Store page

### Memory Template Format

Templates are standard markdown files with mustache-style variables:

```markdown
# {{project.name}}

## Architecture
This is a {{project.type}} project located at `{{project.path}}`.

## Commands
{{#if project.type == "maven"}}
- Build: `mvn clean package`
- Test: `mvn test`
{{/if}}
{{#if project.type == "pnpm"}}
- Build: `pnpm build`
- Test: `pnpm test`
{{/if}}

## Workspace
Part of workspace: {{workspace.name}}
```

### Available Template Variables

| Variable | Source | Example |
|---|---|---|
| `{{project.name}}` | `dev-hub.toml` project name | `api-server` |
| `{{project.path}}` | Project relative path | `./api-server` |
| `{{project.type}}` | Project type | `maven` |
| `{{project.tags}}` | Comma-separated tags | `backend, api` |
| `{{workspace.name}}` | Workspace name | `my-workspace` |
| `{{workspace.root}}` | Workspace root path | `/home/user/workspace` |
| `{{agent}}` | Target agent name | `claude` or `gemini` |

### Implementation

#### Step 1: Template renderer
**File**: `packages/core/src/agent-store/memory.ts`

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "../utils/fs.js";
import type { AgentType } from "./types.js";
import { AGENT_PATHS } from "./types.js";

export interface TemplateContext {
  project: {
    name: string;
    path: string;
    type: string;
    tags?: string[];
  };
  workspace: {
    name: string;
    root: string;
  };
  agent: string;
}

/**
 * Render a memory template with variable substitution.
 * Supports {{variable}} syntax and simple conditionals.
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
): string {
  let result = template;
  // Simple variable substitution
  result = result.replace(/\{\{project\.name\}\}/g, context.project.name);
  result = result.replace(/\{\{project\.path\}\}/g, context.project.path);
  result = result.replace(/\{\{project\.type\}\}/g, context.project.type);
  result = result.replace(/\{\{project\.tags\}\}/g, (context.project.tags ?? []).join(", "));
  result = result.replace(/\{\{workspace\.name\}\}/g, context.workspace.name);
  result = result.replace(/\{\{workspace\.root\}\}/g, context.workspace.root);
  result = result.replace(/\{\{agent\}\}/g, context.agent);
  // Note: full conditional support ({{#if}}) can be added later with a
  // lightweight template engine like Handlebars. For MVP, simple replacement.
  return result;
}

/**
 * List all memory templates in the store.
 */
export async function listMemoryTemplates(
  storePath: string,
): Promise<Array<{ name: string; content: string }>> {
  const dir = join(storePath, "memory-templates");
  // List .md files, read each, return name + content
}

/**
 * Get the current memory file content for a project + agent.
 */
export async function getMemoryFile(
  projectPath: string,
  agent: AgentType,
): Promise<string | null> {
  const fileName = AGENT_PATHS[agent].memoryFile;
  const filePath = join(projectPath, fileName);
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath, "utf-8");
}

/**
 * Write/update a project's memory file.
 */
export async function updateMemoryFile(
  projectPath: string,
  agent: AgentType,
  content: string,
): Promise<void> {
  const fileName = AGENT_PATHS[agent].memoryFile;
  const filePath = join(projectPath, fileName);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Apply a template to generate a memory file for a project.
 * Returns the rendered content (caller decides whether to write).
 */
export async function applyTemplate(
  storePath: string,
  templateName: string,
  context: TemplateContext,
): Promise<string> {
  const templatePath = join(storePath, "memory-templates", `${templateName}.md`);
  const template = await readFile(templatePath, "utf-8");
  return renderTemplate(template, context);
}
```

#### Step 2: Memory IPC handlers
**File**: Add to `packages/electron/src/main/ipc/agent-store.ts`

```ts
// ── Memory ────────────────────────────────────────────────────────

ipcMain.handle(CH.AGENT_MEMORY_LIST, async (_e, opts: { projectName: string }) => {
  const ctx = getCtx();
  const project = ctx.config.projects.find(p => p.name === opts.projectName);
  if (!project) throw new Error(`Project not found: ${opts.projectName}`);
  const projectPath = join(ctx.workspaceRoot, project.path);
  const result: Record<AgentType, string | null> = {
    claude: await getMemoryFile(projectPath, "claude"),
    gemini: await getMemoryFile(projectPath, "gemini"),
  };
  return result;
});

ipcMain.handle(CH.AGENT_MEMORY_GET, async (_e, opts: {
  projectName: string; agent: AgentType;
}) => {
  const ctx = getCtx();
  const project = ctx.config.projects.find(p => p.name === opts.projectName);
  if (!project) throw new Error(`Project not found: ${opts.projectName}`);
  return getMemoryFile(join(ctx.workspaceRoot, project.path), opts.agent);
});

ipcMain.handle(CH.AGENT_MEMORY_UPDATE, async (_e, opts: {
  projectName: string; agent: AgentType; content: string;
}) => {
  const ctx = getCtx();
  const project = ctx.config.projects.find(p => p.name === opts.projectName);
  if (!project) throw new Error(`Project not found: ${opts.projectName}`);
  await updateMemoryFile(join(ctx.workspaceRoot, project.path), opts.agent, opts.content);
  return { updated: true };
});

ipcMain.handle(CH.AGENT_MEMORY_TEMPLATES, async () => {
  const ctx = getCtx();
  return listMemoryTemplates(ctx.agentStore.storePath);
});

ipcMain.handle(CH.AGENT_MEMORY_APPLY, async (_e, opts: {
  templateName: string; projectName: string; agent: AgentType;
}) => {
  const ctx = getCtx();
  const project = ctx.config.projects.find(p => p.name === opts.projectName);
  if (!project) throw new Error(`Project not found: ${opts.projectName}`);
  const context: TemplateContext = {
    project: {
      name: project.name,
      path: project.path,
      type: project.type,
      tags: project.tags,
    },
    workspace: { name: ctx.config.workspace.name, root: ctx.workspaceRoot },
    agent: opts.agent,
  };
  const rendered = await applyTemplate(ctx.agentStore.storePath, opts.templateName, context);
  return { content: rendered };
});
```

#### Step 3: Memory UI section
Add a "Memory Files" tab or section to the Agent Store page:

- **Project selector**: dropdown to pick a project
- **Agent tabs**: Claude | Gemini
- **Editor**: textarea/code editor with current `CLAUDE.md` / `GEMINI.md` content
- **Template selector**: dropdown to pick a template
- **Preview**: rendered template preview before applying
- **Apply button**: writes rendered template to project's memory file
- **Save button**: saves direct edits

---

## Part B: Import from Git Repository

### Concept

Users can import skills, commands, and other agent configs from a public git repository (e.g., `https://github.com/anthropics/skills`).

### Implementation

#### Step 1: Importer service
**File**: `packages/core/src/agent-store/importer.ts`

```ts
import { execSync } from "node:child_process";
import { readdir, stat, cp, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileExists } from "../utils/fs.js";
import { parseSkillMd } from "./parsers.js";
import type { AgentStoreItem, AgentItemCategory } from "./types.js";

export interface RepoScanResult {
  repoUrl: string;
  items: Array<{
    name: string;
    category: AgentItemCategory;
    description?: string;
    relativePath: string;
  }>;
}

/**
 * Clone a repo to temp dir and scan for importable items.
 */
export async function scanRepo(repoUrl: string): Promise<RepoScanResult> {
  // 1. Create temp directory
  const tmpDir = await mkdtemp(join(tmpdir(), "devhub-import-"));

  try {
    // 2. Shallow clone (depth=1 for speed)
    execSync(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, {
      stdio: "pipe",
      timeout: 30_000,
    });

    // 3. Scan for skills (directories containing SKILL.md)
    const skills = await findSkills(tmpDir);

    // 4. Scan for commands (.md files in commands/ dirs)
    const commands = await findCommands(tmpDir);

    return {
      repoUrl,
      items: [...skills, ...commands],
    };
  } finally {
    // Cleanup is deferred to after user selects items
    // Store tmpDir path for later cleanup
  }
}

/**
 * Import selected items from a scanned repo into the central store.
 */
export async function importFromRepo(
  tmpDir: string,
  selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>,
  storePath: string,
): Promise<Array<{ name: string; success: boolean; error?: string }>> {
  const results = [];
  for (const item of selectedItems) {
    try {
      const source = join(tmpDir, item.relativePath);
      const categoryDir = item.category === "skill" ? "skills" : "commands";
      const target = join(storePath, categoryDir, item.name);

      if (await fileExists(target)) {
        results.push({ name: item.name, success: false, error: "Already exists in store" });
        continue;
      }

      await cp(source, target, { recursive: true });
      results.push({ name: item.name, success: true });
    } catch (err) {
      results.push({
        name: item.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * Cleanup temp directory after import is complete.
 */
export async function cleanupImport(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}

/** Recursively find directories containing SKILL.md */
async function findSkills(rootDir: string): Promise<Array<{
  name: string; category: AgentItemCategory; description?: string; relativePath: string;
}>> {
  // Walk directory tree, find all SKILL.md files
  // Parse frontmatter for metadata
  // Return list of found skills
}

/** Find .md files with command frontmatter */
async function findCommands(rootDir: string): Promise<Array<{
  name: string; category: AgentItemCategory; description?: string; relativePath: string;
}>> {
  // Look for commands/ directories or .md files with frontmatter
}
```

#### Step 2: Import IPC handlers
Add to `agent-store.ts`:

```ts
ipcMain.handle(CH.AGENT_STORE_IMPORT_REPO, async (_e, opts: { repoUrl: string }) => {
  // Step 1: Scan repo (clone + discover)
  const scanResult = await scanRepo(opts.repoUrl);
  return scanResult;
  // Note: this returns found items to the UI.
  // User selects which to import, then a second IPC call does the actual import.
});

// Add a separate handler for confirming import selection:
ipcMain.handle("agent-store:importConfirm", async (_e, opts: {
  tmpDir: string;
  selectedItems: Array<{ name: string; category: string; relativePath: string }>;
}) => {
  const ctx = getCtx();
  const results = await importFromRepo(opts.tmpDir, opts.selectedItems, ctx.agentStore.storePath);
  await cleanupImport(opts.tmpDir);
  return results;
});
```

#### Step 3: Import UI

Add an "Import from Repo" dialog to the Agent Store page:

1. **URL input**: text field for git repo URL
2. **Scan button**: triggers clone + scan → shows loading spinner
3. **Results list**: checkboxes for each found item (name, description, category)
4. **Select All / Deselect All**: bulk selection
5. **Import button**: imports selected items into central store
6. **Progress/result**: shows success/failure per item

---

## Todo
- [ ] Implement `memory.ts` (template renderer, memory CRUD)
- [ ] Add memory IPC handlers
- [ ] Add memory preload bridge methods
- [ ] Add memory UI section to Agent Store page
- [ ] Create default memory templates (backend-service, frontend-app, generic)
- [ ] Implement `importer.ts` (repo scan, import, cleanup)
- [ ] Add import IPC handlers
- [ ] Add import UI dialog
- [ ] Add import preload bridge methods
- [ ] Write tests for template rendering
- [ ] Write tests for repo scanning

## Success Criteria

### Memory Templates
- Templates render correctly with project variables
- Memory files can be viewed and edited inline
- Templates can be applied to generate memory files
- Generated files write correctly to project directories

### Import from Repo
- Repo URL is cloned and scanned for skills/commands
- Found items are listed with metadata
- User can select items to import
- Selected items are copied to central store
- Temp directory is cleaned up after import
- Already-existing items are flagged (not overwritten)

## Risk Assessment
- **Medium**: Git clone timeout — large repos may take long. Mitigate: shallow clone (depth=1), timeout (30s), show progress.
- **Low**: Template variable injection — variables are project properties from config, not user input. No XSS risk since output is written to files, not rendered in browser.
- **Low**: Temp directory cleanup — use `finally` block and `cleanupImport()` to ensure cleanup even on error.
- **Low**: Template syntax — MVP uses simple `{{var}}` replacement. Full Handlebars-style conditionals can be added later without breaking existing templates.

## Future Enhancements (Post-MVP)
- Full Handlebars template engine for conditionals and loops
- Memory file diff view (template vs current file)
- Auto-detect memory file changes and suggest syncing
- Import from private repos (with SSH key or token)
- Import from specific branch/tag/commit
- Periodic check for upstream updates on imported items

Completed: 2026-03-29
