# Phase 04: Web API, Queries & Agent Store Page

## Context
- Parent plan: [plan.md](./plan.md)
- Dependencies: Phase 01-03 (core module + IPC handlers)

## Overview
- **Date**: 2026-03-28
- **Description**: Build the web frontend layer — API client methods, TanStack Query hooks, and the Agent Store page with inventory view, distribution matrix, and ship/unship controls.
- **Priority**: P1
- **Implementation status**: done

## Architecture

```
packages/web/src/
├── api/
│   ├── client.ts          ← ADD agentStore namespace + types
│   └── queries.ts         ← ADD agent store queries + mutations
├── pages/
│   └── AgentStorePage.tsx  ← NEW — main agent store page
├── components/
│   └── agent-store/       ← NEW — agent store components
│       ├── StoreInventory.tsx    ← central store tree view
│       ├── DistributionMatrix.tsx ← projects × items grid
│       ├── ItemDetail.tsx        ← item info + SKILL.md preview
│       ├── ShipDialog.tsx        ← select projects + method
│       └── HealthStatus.tsx      ← broken links, warnings
├── App.tsx                ← ADD route for /agent-store
└── types/
    └── electron.d.ts      ← UPDATE window.devhub types
```

## Implementation Steps

### Step 1: Add types and API client methods
**File**: `packages/web/src/api/client.ts`

Add types and API wrapper:

```ts
// ── Agent Store Types ─────────────────────────────────────────────────

export type AgentType = "claude" | "gemini";
export type AgentItemCategory =
  | "skill" | "command" | "hook"
  | "mcp-server" | "subagent" | "memory-template";
export type DistributionMethod = "symlink" | "copy";

export interface AgentStoreItem {
  name: string;
  category: AgentItemCategory;
  relativePath: string;
  description?: string;
  compatibleAgents: AgentType[];
  sizeBytes?: number;
}

export interface ShipResult {
  item: string;
  category: AgentItemCategory;
  project: string;
  agent: AgentType;
  method: DistributionMethod;
  success: boolean;
  error?: string;
  targetPath?: string;
}

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

export interface HealthCheckResult {
  brokenSymlinks: Array<{ project: string; path: string; target: string }>;
  orphanedItems: Array<{ project: string; path: string; reason: string }>;
  missingFromManifest: Array<{ project: string; item: string; category: AgentItemCategory }>;
}

// Add to api object:
export const api = {
  // ... existing ...
  agentStore: {
    init: () => window.devhub.agentStore.init(),
    list: (category?: AgentItemCategory) =>
      window.devhub.agentStore.list(category ? { category } : undefined),
    get: (name: string, category: AgentItemCategory) =>
      window.devhub.agentStore.get({ name, category }),
    getContent: (name: string, category: AgentItemCategory, fileName?: string) =>
      window.devhub.agentStore.getContent({ name, category, fileName }),
    add: (category: AgentItemCategory, name?: string) =>
      window.devhub.agentStore.add({ category, name }),
    remove: (name: string, category: AgentItemCategory) =>
      window.devhub.agentStore.remove({ name, category }),
    ship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
      method?: DistributionMethod,
    ) => window.devhub.agentStore.ship({ itemName, category, projectName, agent, method }),
    unship: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => window.devhub.agentStore.unship({ itemName, category, projectName, agent }),
    absorb: (
      itemName: string, category: AgentItemCategory,
      projectName: string, agent: AgentType,
    ) => window.devhub.agentStore.absorb({ itemName, category, projectName, agent }),
    bulkShip: (
      items: Array<{ name: string; category: AgentItemCategory }>,
      targets: Array<{ projectName: string; agent: AgentType }>,
      method?: DistributionMethod,
    ) => window.devhub.agentStore.bulkShip({ items, targets, method }),
    matrix: () => window.devhub.agentStore.matrix(),
    scan: () => window.devhub.agentStore.scan(),
    health: () => window.devhub.agentStore.health(),
  },
};
```

### Step 2: Add TanStack Query hooks
**File**: `packages/web/src/api/queries.ts`

```ts
// ── Agent Store ────────────────────────────────────────────────────────

export function useAgentStoreItems(category?: AgentItemCategory) {
  return useQuery({
    queryKey: ["agent-store", "items", category ?? "all"],
    queryFn: () => api.agentStore.list(category),
  });
}

export function useAgentStoreItem(name: string, category: AgentItemCategory) {
  return useQuery({
    queryKey: ["agent-store", "item", name, category],
    queryFn: () => api.agentStore.get(name, category),
    enabled: !!name,
  });
}

export function useAgentStoreContent(name: string, category: AgentItemCategory) {
  return useQuery({
    queryKey: ["agent-store", "content", name, category],
    queryFn: () => api.agentStore.getContent(name, category),
    enabled: !!name,
  });
}

export function useAgentStoreScan() {
  return useQuery({
    queryKey: ["agent-store", "scan"],
    queryFn: () => api.agentStore.scan(),
  });
}

export function useAgentStoreMatrix() {
  return useQuery({
    queryKey: ["agent-store", "matrix"],
    queryFn: () => api.agentStore.matrix(),
  });
}

export function useAgentStoreHealth() {
  return useQuery({
    queryKey: ["agent-store", "health"],
    queryFn: () => api.agentStore.health(),
    staleTime: 30_000,
  });
}

// ── Mutations ──

export function useAddToStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { category: AgentItemCategory; name?: string }) =>
      api.agentStore.add(opts.category, opts.name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

export function useRemoveFromStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { name: string; category: AgentItemCategory }) =>
      api.agentStore.remove(opts.name, opts.category),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

export function useShipItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string; category: AgentItemCategory;
      projectName: string; agent: AgentType;
      method?: DistributionMethod;
    }) => api.agentStore.ship(
      opts.itemName, opts.category,
      opts.projectName, opts.agent, opts.method,
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store", "matrix"] });
      void qc.invalidateQueries({ queryKey: ["agent-store", "scan"] });
    },
  });
}

export function useUnshipItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string; category: AgentItemCategory;
      projectName: string; agent: AgentType;
    }) => api.agentStore.unship(
      opts.itemName, opts.category,
      opts.projectName, opts.agent,
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store", "matrix"] });
      void qc.invalidateQueries({ queryKey: ["agent-store", "scan"] });
    },
  });
}

export function useAbsorbItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string; category: AgentItemCategory;
      projectName: string; agent: AgentType;
    }) => api.agentStore.absorb(
      opts.itemName, opts.category,
      opts.projectName, opts.agent,
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

export function useBulkShip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      items: Array<{ name: string; category: AgentItemCategory }>;
      targets: Array<{ projectName: string; agent: AgentType }>;
      method?: DistributionMethod;
    }) => api.agentStore.bulkShip(opts.items, opts.targets, opts.method),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}
```

### Step 3: Create Agent Store page
**File**: `packages/web/src/pages/AgentStorePage.tsx`

Layout wireframe:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Agent Store                                    [+ Add] [⚕ Health]   │
├──────────────────────────────┬───────────────────────────────────────┤
│                              │                                       │
│  📦 Central Store            │  📋 Item Detail / Preview             │
│  ─────────────────           │  ──────────────────────               │
│  Filter: [All ▼]             │  Name: planning                      │
│                              │  Category: skill                      │
│  ▼ Skills (12)               │  Description: Plan technical...      │
│    ├── planning        🔗 3  │  Compatible: claude, gemini           │
│    ├── backend-dev     🔗 2  │                                       │
│    ├── databases       🔗 1  │  ┌──────────────────────────────┐    │
│    └── frontend-design ○ 0   │  │ SKILL.md Preview             │    │
│  ▼ Commands (5)              │  │ (rendered markdown)           │    │
│    ├── plan.md         🔗 3  │  │                               │    │
│    └── debug.md        🔗 2  │  └──────────────────────────────┘    │
│  ▼ Hooks (1)                 │                                       │
│  ▼ MCP Servers (2)           │  Actions:                             │
│                              │  [Ship to Project...] [Remove] [Edit] │
│                              │                                       │
├──────────────────────────────┴───────────────────────────────────────┤
│                                                                      │
│  📊 Distribution Matrix                                              │
│  ───────────────────                                                 │
│  Item / Project    │ api-server │ web-app  │ ml-pipe  │             │
│  ─────────────────│────────────│──────────│──────────│             │
│  planning (skill)  │ 🔗claude   │ 🔗claude │ 🔗gemini │             │
│  backend-dev       │ 🔗claude   │          │          │             │
│  plan (command)    │ 🔗claude   │ 🔗claude │          │             │
│                                                                      │
│  Legend: 🔗 = symlinked  📄 = copied  ○ = not shipped               │
└──────────────────────────────────────────────────────────────────────┘
```

Key components:

#### `StoreInventory.tsx`
- Tree view grouped by category (skills, commands, hooks, etc.)
- Category filter dropdown
- Show ship count per item (🔗 badge)
- Click item to show detail in right panel
- Drag & drop zone for adding items

#### `DistributionMatrix.tsx`
- Grid: rows = store items, columns = projects
- Cells show distribution status (symlinked, copied, not shipped)
- Click cell to ship/unship
- Column headers show agent icons (Claude/Gemini)

#### `ItemDetail.tsx`
- Item metadata (name, description, category, compatible agents)
- SKILL.md rendered preview (for skills)
- Action buttons: Ship to Project, Remove, Edit (open in terminal/editor)

#### `ShipDialog.tsx`
- Modal dialog when clicking "Ship to Project"
- Checkbox list of projects
- Agent selector per project (Claude, Gemini, or both)
- Distribution method selector (symlink/copy)
- Batch confirm button

#### `HealthStatus.tsx`
- Summary badges: broken links count, warnings count
- Expandable list of issues with repair actions

### Step 4: Add route
**File**: `packages/web/src/App.tsx`

```tsx
import { AgentStorePage } from "@/pages/AgentStorePage.js";

// Inside <Routes>:
<Route path="/agent-store" element={<AgentStorePage />} />
```

### Step 5: Add sidebar navigation
Add "Agent Store" to the sidebar navigation (wherever the nav component lives, alongside Dashboard, Terminals, Git, Settings).

Icon suggestion: `🧩` (puzzle piece) or a custom agent icon.

## UI Design Notes

### Color Coding
- **Skills**: Blue accent (primary)
- **Commands**: Green accent
- **Hooks**: Orange accent
- **MCP Servers**: Purple accent
- **Memory Templates**: Teal accent
- **Subagents**: Yellow accent

### Status Indicators
- 🔗 Symlinked (primary indicator)
- 📄 Copied
- ○ Not shipped
- ⚠️ Broken link
- ✓ Healthy

### Responsive Layout
- Desktop: 3-panel (inventory | detail | matrix stacked below)
- Narrow: inventory and detail stack vertically, matrix below

## Todo
- [ ] Add agent store types to `client.ts`
- [ ] Add `agentStore` namespace to `api` object
- [ ] Write all TanStack Query hooks (queries + mutations)
- [ ] Create `AgentStorePage.tsx` with layout structure
- [ ] Create `StoreInventory.tsx` (tree view)
- [ ] Create `DistributionMatrix.tsx` (grid)
- [ ] Create `ItemDetail.tsx` (preview panel)
- [ ] Create `ShipDialog.tsx` (modal)
- [ ] Create `HealthStatus.tsx` (warnings panel)
- [ ] Add `/agent-store` route in `App.tsx`
- [ ] Add sidebar navigation item
- [ ] Update `electron.d.ts` types

## Success Criteria
- Agent Store page loads and shows inventory from central store
- Items can be selected and their SKILL.md content previewed
- Distribution matrix shows which items are shipped where
- Ship dialog allows selecting projects and distribution method
- Ship/unship operations work via UI and reflect in matrix
- Health check shows broken symlinks
- Add button opens file/folder picker and adds to store
- Remove button deletes from store (with confirmation)
- Page matches existing Dev-Hub UI style (dark theme, Tailwind)

## Risk Assessment
- **Medium**: Distribution matrix performance — for many items × projects, the grid could be large. Mitigate: virtualization or pagination for >50 items.
- **Low**: Markdown rendering — need a markdown renderer for SKILL.md preview. Use `react-markdown` (likely already a dep or easy to add).
- **Low**: UI consistency — follow existing Dev-Hub patterns (SettingsPage, DashboardPage) for layout and component style.

## Next Steps
→ Phase 05: Memory templates, import from git repo, and polish

**Completed**: 2026-03-29
