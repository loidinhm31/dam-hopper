# Phase 03: IPC Channels & Electron Handlers

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: Phase 01 (types, store service), Phase 02 (scanner, distributor)

## Overview
- **Date**: 2026-03-28
- **Description**: Create IPC channels and Electron main-process handlers that expose agent store operations to the renderer. Follows the existing `registerXxxHandlers(holder)` pattern.
- **Priority**: P1
- **Implementation status**: done

## Architecture

```
packages/electron/src/
├── ipc-channels.ts                  ← ADD agent store channel constants
├── main/
│   ├── index.ts                     ← Initialize AgentStoreService in context
│   ├── ipc/
│   │   ├── index.ts                 ← Import + call registerAgentStoreHandlers
│   │   └── agent-store.ts           ← NEW — all agent store IPC handlers
│   └── ...
└── preload/index.ts                 ← ADD agentStore namespace to contextBridge
```

## Implementation Steps

### Step 1: Add IPC channel constants
**File**: `packages/electron/src/ipc-channels.ts`

Add to the `CH` object:

```ts
// Agent Store
AGENT_STORE_LIST:       "agent-store:list",
AGENT_STORE_ADD:        "agent-store:add",
AGENT_STORE_REMOVE:     "agent-store:remove",
AGENT_STORE_GET:        "agent-store:get",
AGENT_STORE_GET_CONTENT: "agent-store:getContent",
AGENT_STORE_INIT:       "agent-store:init",

// Distribution (ship/unship)
AGENT_STORE_SHIP:       "agent-store:ship",
AGENT_STORE_UNSHIP:     "agent-store:unship",
AGENT_STORE_BULK_SHIP:  "agent-store:bulkShip",
AGENT_STORE_ABSORB:     "agent-store:absorb",
AGENT_STORE_MATRIX:     "agent-store:matrix",

// Scanner
AGENT_STORE_SCAN:       "agent-store:scan",
AGENT_STORE_HEALTH:     "agent-store:health",

// Memory (project memory files)
AGENT_MEMORY_LIST:      "agent-memory:list",
AGENT_MEMORY_GET:       "agent-memory:get",
AGENT_MEMORY_UPDATE:    "agent-memory:update",
AGENT_MEMORY_TEMPLATES: "agent-memory:templates",
AGENT_MEMORY_APPLY:     "agent-memory:apply",

// Import
AGENT_STORE_IMPORT_LOCAL: "agent-store:importLocal",
AGENT_STORE_IMPORT_REPO:  "agent-store:importRepo",
```

### Step 2: Initialize AgentStoreService in context
**File**: `packages/electron/src/main/index.ts`

Currently, `CtxHolder` has a `current` property that holds the active workspace context. Extend it to include an `AgentStoreService` instance.

```ts
import { AgentStoreService } from "@dev-hub/core";

// Inside initContext() or wherever workspace is loaded:
const agentStorePath = resolve(
  workspaceRoot,
  config.agentStore?.path ?? ".dev-hub/agent-store",
);
const agentStore = new AgentStoreService(agentStorePath);
await agentStore.init(); // ensure directory structure exists

// Add to context:
holder.current = {
  ...existingContext,
  agentStore,
  workspaceRoot,
};
```

> **Design note**: `agentStore` is part of the workspace context because each workspace has its own agent store. When workspace switches, the agent store instance is recreated for the new workspace.

### Step 3: Create agent store IPC handlers
**File**: `packages/electron/src/main/ipc/agent-store.ts` (NEW)

```ts
import { ipcMain, dialog } from "electron";
import { join } from "node:path";
import {
  scanAllProjects,
  ship,
  unship,
  bulkShip,
  absorb,
  getDistributionMatrix,
  healthCheck,
} from "@dev-hub/core";
import type {
  AgentItemCategory,
  AgentType,
  DistributionMethod,
} from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

export function registerAgentStoreHandlers(holder: CtxHolder): void {
  const getCtx = () => {
    if (!holder.current) throw new Error("No workspace loaded");
    return holder.current;
  };

  // ── Store CRUD ──────────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_STORE_INIT, async () => {
    const ctx = getCtx();
    await ctx.agentStore.init();
    return { initialized: true };
  });

  ipcMain.handle(CH.AGENT_STORE_LIST, async (_e, opts?: { category?: AgentItemCategory }) => {
    const ctx = getCtx();
    return ctx.agentStore.list(opts?.category);
  });

  ipcMain.handle(CH.AGENT_STORE_GET, async (_e, opts: { name: string; category: AgentItemCategory }) => {
    const ctx = getCtx();
    return ctx.agentStore.get(opts.name, opts.category);
  });

  ipcMain.handle(CH.AGENT_STORE_GET_CONTENT, async (_e, opts: {
    name: string;
    category: AgentItemCategory;
    fileName?: string;
  }) => {
    const ctx = getCtx();
    return ctx.agentStore.getContent(opts.name, opts.category, opts.fileName);
  });

  ipcMain.handle(CH.AGENT_STORE_ADD, async (_e, opts: {
    category: AgentItemCategory;
    name?: string;
  }) => {
    const ctx = getCtx();
    // Show folder picker for skills, file picker for commands
    const isFolder = opts.category === "skill" || opts.category === "subagent";
    const result = await dialog.showOpenDialog({
      title: `Add ${opts.category} to Agent Store`,
      properties: isFolder ? ["openDirectory"] : ["openFile"],
      filters: isFolder ? [] : [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return ctx.agentStore.add(result.filePaths[0], opts.category, opts.name);
  });

  ipcMain.handle(CH.AGENT_STORE_REMOVE, async (_e, opts: {
    name: string;
    category: AgentItemCategory;
  }) => {
    const ctx = getCtx();
    await ctx.agentStore.remove(opts.name, opts.category);
    return { removed: true };
  });

  // ── Distribution ────────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_STORE_SHIP, async (_e, opts: {
    itemName: string;
    category: AgentItemCategory;
    projectName: string;
    agent: AgentType;
    method?: DistributionMethod;
  }) => {
    const ctx = getCtx();
    const project = ctx.config.projects.find((p) => p.name === opts.projectName);
    if (!project) throw new Error(`Project not found: ${opts.projectName}`);
    const projectPath = join(ctx.workspaceRoot, project.path);
    return ship(
      ctx.agentStore.storePath,
      opts.itemName,
      opts.category,
      projectPath,
      opts.agent,
      opts.method ?? "symlink",
    );
  });

  ipcMain.handle(CH.AGENT_STORE_UNSHIP, async (_e, opts: {
    itemName: string;
    category: AgentItemCategory;
    projectName: string;
    agent: AgentType;
  }) => {
    const ctx = getCtx();
    const project = ctx.config.projects.find((p) => p.name === opts.projectName);
    if (!project) throw new Error(`Project not found: ${opts.projectName}`);
    const projectPath = join(ctx.workspaceRoot, project.path);
    return unship(
      ctx.agentStore.storePath,
      opts.itemName,
      opts.category,
      projectPath,
      opts.agent,
    );
  });

  ipcMain.handle(CH.AGENT_STORE_ABSORB, async (_e, opts: {
    itemName: string;
    category: AgentItemCategory;
    projectName: string;
    agent: AgentType;
  }) => {
    const ctx = getCtx();
    const project = ctx.config.projects.find((p) => p.name === opts.projectName);
    if (!project) throw new Error(`Project not found: ${opts.projectName}`);
    const projectPath = join(ctx.workspaceRoot, project.path);
    return absorb(
      ctx.agentStore.storePath,
      opts.itemName,
      opts.category,
      projectPath,
      opts.agent,
    );
  });

  ipcMain.handle(CH.AGENT_STORE_BULK_SHIP, async (_e, opts: {
    items: Array<{ name: string; category: AgentItemCategory }>;
    targets: Array<{ projectName: string; agent: AgentType }>;
    method?: DistributionMethod;
  }) => {
    const ctx = getCtx();
    const resolvedTargets = opts.targets.map((t) => {
      const project = ctx.config.projects.find((p) => p.name === t.projectName);
      if (!project) throw new Error(`Project not found: ${t.projectName}`);
      return { path: join(ctx.workspaceRoot, project.path), agent: t.agent };
    });
    return bulkShip(ctx.agentStore.storePath, opts.items, resolvedTargets, opts.method);
  });

  ipcMain.handle(CH.AGENT_STORE_MATRIX, async () => {
    const ctx = getCtx();
    const items = await ctx.agentStore.list();
    const projects = ctx.config.projects.map((p) => ({
      name: p.name,
      path: join(ctx.workspaceRoot, p.path),
    }));
    return getDistributionMatrix(
      ctx.agentStore.storePath,
      items.map((i) => ({ name: i.name, category: i.category })),
      projects,
      ["claude", "gemini"],
    );
  });

  // ── Scanner / Health ────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_STORE_SCAN, async () => {
    const ctx = getCtx();
    const projects = ctx.config.projects.map((p) => ({
      name: p.name,
      path: join(ctx.workspaceRoot, p.path),
    }));
    return scanAllProjects(projects, ctx.workspaceRoot);
  });

  ipcMain.handle(CH.AGENT_STORE_HEALTH, async () => {
    const ctx = getCtx();
    const projects = ctx.config.projects.map((p) => ({
      name: p.name,
      path: join(ctx.workspaceRoot, p.path),
    }));
    return healthCheck(ctx.agentStore.storePath, projects, ["claude", "gemini"]);
  });
}
```

### Step 4: Register handlers in IPC index
**File**: `packages/electron/src/main/ipc/index.ts`

```ts
import { registerAgentStoreHandlers } from "./agent-store.js";

export function registerIpcHandlers(
  holder: CtxHolder,
  store: Store<StoreSchema>,
): void {
  // ... existing registrations ...
  registerAgentStoreHandlers(holder);  // ADD
}
```

### Step 5: Add preload bridge
**File**: `packages/electron/src/preload/index.ts`

Add `agentStore` namespace to the `contextBridge.exposeInMainWorld("devhub", { ... })` object:

```ts
agentStore: {
  init: () => ipcRenderer.invoke(CH.AGENT_STORE_INIT),
  list: (opts?: { category?: string }) =>
    ipcRenderer.invoke(CH.AGENT_STORE_LIST, opts),
  get: (opts: { name: string; category: string }) =>
    ipcRenderer.invoke(CH.AGENT_STORE_GET, opts),
  getContent: (opts: { name: string; category: string; fileName?: string }) =>
    ipcRenderer.invoke(CH.AGENT_STORE_GET_CONTENT, opts),
  add: (opts: { category: string; name?: string }) =>
    ipcRenderer.invoke(CH.AGENT_STORE_ADD, opts),
  remove: (opts: { name: string; category: string }) =>
    ipcRenderer.invoke(CH.AGENT_STORE_REMOVE, opts),
  ship: (opts: {
    itemName: string; category: string;
    projectName: string; agent: string; method?: string;
  }) => ipcRenderer.invoke(CH.AGENT_STORE_SHIP, opts),
  unship: (opts: {
    itemName: string; category: string;
    projectName: string; agent: string;
  }) => ipcRenderer.invoke(CH.AGENT_STORE_UNSHIP, opts),
  absorb: (opts: {
    itemName: string; category: string;
    projectName: string; agent: string;
  }) => ipcRenderer.invoke(CH.AGENT_STORE_ABSORB, opts),
  bulkShip: (opts: {
    items: Array<{ name: string; category: string }>;
    targets: Array<{ projectName: string; agent: string }>;
    method?: string;
  }) => ipcRenderer.invoke(CH.AGENT_STORE_BULK_SHIP, opts),
  matrix: () => ipcRenderer.invoke(CH.AGENT_STORE_MATRIX),
  scan: () => ipcRenderer.invoke(CH.AGENT_STORE_SCAN),
  health: () => ipcRenderer.invoke(CH.AGENT_STORE_HEALTH),
},
```

### Step 6: Update TypeScript types for window.devhub
**File**: `packages/web/src/types/electron.d.ts`

Add the `agentStore` namespace type definitions to `Window["devhub"]`.

## Todo
- [ ] Add ~18 IPC channel constants to `ipc-channels.ts`
- [ ] Extend workspace context with `AgentStoreService` instance
- [ ] Create `agent-store.ts` IPC handler file
- [ ] Register agent store handlers in `ipc/index.ts`
- [ ] Add `agentStore` namespace to preload bridge
- [ ] Update `window.devhub` TypeScript types
- [ ] Test all IPC channels respond correctly

## Success Criteria
- All IPC channels are registered and respond
- `agent-store:list` returns items from the central store
- `agent-store:ship` creates a symlink from project to store
- `agent-store:scan` discovers agent configs across all projects
- `agent-store:health` reports broken symlinks
- Preload bridge exposes all methods
- TypeScript types compile correctly

## Risk Assessment
- **Low**: `CtxHolder` extension — adding `agentStore` to context follows existing pattern (like `bulkGitService`)
- **Low**: Workspace switch — `agentStore` instance is recreated for the new workspace, matching the lifecycle of other context-bound services
- **Medium**: IPC payload size for `matrix` — could be large for workspaces with many projects. Mitigate: paginate or summarize. For MVP, acceptable.

## Next Steps
→ Phase 04: Web API client, TanStack Query hooks, and the Agent Store page UI
