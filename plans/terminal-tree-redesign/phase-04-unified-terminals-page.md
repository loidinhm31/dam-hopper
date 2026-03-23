---
parent: plan.md
phase: "04"
status: done
completed: 2026-03-24
priority: P1
effort: 5h
depends_on: ["02", "03"]
---

# Phase 04: Unified Terminals Page

## Context

- Parent: [plan.md](./plan.md)
- Depends on: Phase 02 (IPC Session Metadata), Phase 03 (CollapsibleSection)
- **PRIMARY deliverable** of the terminal tree redesign
- Absorbs former Phase 04 (ProjectDetailPage redesign) and Phase 05 (tree view)

## Overview

Build a unified Terminals page that replaces ProjectsPage, ProjectDetailPage, ProcessesPage, and BuildPage. Features a project tree sidebar on the left and a context-switching right panel: clicking a project node shows project info (Git, Worktrees, Commands with collapsible sections), clicking a terminal node shows terminal output with tabs. Includes ad-hoc shell support with auto-save to config and hybrid terminal mounting (keep up to 5 MRU mounted).

**Status:** done | **Priority:** P1

## Key Insights

- TerminalPanel persists PTY sessions across unmount, replays scrollback on remount
- `key` prop forces TerminalPanel remount (existing pattern)
- Hybrid mounting: keep 5 MRU terminals in DOM, evict oldest — balance memory vs instant switching
- Context-switching panel: right panel renders EITHER project info OR terminal display based on tree selection
- Ad-hoc shells auto-saved to dev-hub.toml via `config.updateProject` (adds to project.commands)
- Existing content from ProjectDetailPage (Git ops, Worktrees, Commands list) moves into ProjectInfoPanel

## Requirements

### 1. Page Layout — Context-Switching

```
When project node selected:                When terminal node selected:
────────────────────────────────    ────────────────────────────────
│ TREE           │ PROJECT INFO │    │ TREE           │ TERMINAL TABS │
│                │              │    │                │ [api:build] [x]│
│ ▼ api-server   │ api-server   │    │ ▼ api-server   │────────────────│
│  [●] build    │ [maven][main]│    │  [●] build    │ $ mvn clean    │
│  [●] run      │              │    │  [●] run      │   install      │
│  [○] test     │ ▸ Git Ops    │    │  [○] test     │ [INFO] Build   │
│  [+] Shell    │ ▸ Worktrees  │    │  [+] Shell    │ BUILD SUCCESS  │
│ ▸ web-app     │ ▾ Commands   │    │ ▸ web-app     │ Total: 12.3s   │
│ ▸ cli         │  build [▶]   │    │ ▸ cli         │                │
│               │  run   [▶]   │    │               │                │
────────────────────────────────    ────────────────────────────────
```

### 2. Tree View

- Project nodes (collapsible): folder icon + name + active session count badge
- Terminal leaves: status dot + label + play/stop buttons
- Status dots: green=alive, gray=not started, red=exited nonzero, amber=exited 0
- '+ Shell' button per project: launches ad-hoc blank terminal
- Compact styling (text-xs, tight padding), scrollable

### 3. Project Info Panel (right panel — project mode)

When a project node is clicked, the right panel shows:
- Header: project name + type badge + branch badge + clean/dirty status
- CollapsibleSection: Git Operations (fetch/pull/push buttons, branch list)
- CollapsibleSection: Worktrees (add/remove UI)
- CollapsibleSection: Commands (list of available commands with launch buttons)
- Content migrated from former ProjectDetailPage tabs

### 4. Terminal Display (right panel — terminal mode)

When a terminal node is clicked:
- Tab bar showing opened terminals
- Active terminal rendered via TerminalPanel
- Close tab does NOT kill session
- Hybrid mounting: up to 5 MRU terminals stay mounted (display:none for inactive), oldest evicted

### 5. Ad-hoc Shell Support

- '+ Shell' in tree opens prompt for command (or blank for default shell)
- Creates session with ID `shell:${project}:${timestamp}`
- After first run, auto-saves to project config via `config.updateProject` as a custom command
- Saved commands appear in tree on next refresh

### 6. Tab Bar

- Shows opened terminals: status dot + `{project}:{type}` label + close button
- Close tab does NOT kill session
- Horizontal scroll on overflow
- Active tab highlighted

## Architecture

### New Files

```
packages/web/src/
├── pages/TerminalsPage.tsx                          — Page wrapper, state management
├── components/organisms/
│   ├── TerminalTreeView.tsx                         — Tree sidebar
│   ├── ProjectInfoPanel.tsx                         — Project info (Git/Worktrees/Commands)
│   ├── TerminalTabBar.tsx                           — Tab bar for open terminals
│   └── MultiTerminalDisplay.tsx                     — Terminal display with hybrid mounting
└── hooks/useTerminalTree.ts                         — Hook combining projects + sessions
```

### Data Flow

```
useProjects()         → available commands per project
useTerminalSessions() → active PTY sessions with metadata
        ↓
useTerminalTree()     → merged tree data (projects + sessions)
        ↓
TerminalTreeView      → renders tree, user clicks
        ↓
selection state        → "project:name" OR "terminal:sessionId"
        ↓
Right Panel:
  if project selected → ProjectInfoPanel (Git, Worktrees, Commands)
  if terminal selected → TerminalTabBar + MultiTerminalDisplay
```

### useTerminalTree Hook Types

```typescript
interface TreeProject {
  name: string;
  type: ProjectType;
  path: string;
  branch?: string;
  status?: "clean" | "dirty";
  commands: TreeCommand[];
}

interface TreeCommand {
  key: string;           // "build", "run", "test", "shell-1", etc.
  type: "build" | "run" | "custom" | "shell";
  command: string;
  sessionId: string;     // e.g. "build:api-server"
  session?: SessionInfo; // populated if PTY session exists
}
```

### Hybrid Terminal Mounting Strategy

```typescript
const MAX_MOUNTED = 5;

// State tracks MRU order
const [mountedTerminals, setMountedTerminals] = useState<string[]>([]);

// On tab select: promote to front of MRU, evict if > MAX_MOUNTED
// Mounted terminals render with display:none when inactive
// Evicted terminals unmount (will replay scrollback on next select)
```

Benefits:
- Most recently used 5 terminals switch instantly (no flash)
- Memory bounded — max 5 xterm.js instances in DOM at once
- Evicted terminals reconnect via scrollback replay (existing TerminalPanel behavior)

### Ad-hoc Shell Auto-Save Flow

```
User clicks "+ Shell" on project "api-server"
  → Prompt: enter command (or empty for $SHELL)
  → Create PTY: id="shell:api-server:1711234567", project="api-server", command=input
  → Open in tab, activate
  → Auto-save: config.updateProject("api-server", { commands: { ...existing, "shell-1": input } })
  → Tree refreshes via useProjects() polling, shows new command
```

## Related Code Files

| File | Role |
| ---- | ---- |
| `packages/web/src/components/organisms/TerminalPanel.tsx` | Reused for terminal rendering |
| `packages/web/src/components/organisms/UnifiedCommandPanel.tsx` | Reference for launch patterns, may be deleted in Phase 05 |
| `packages/web/src/components/atoms/CollapsibleSection.tsx` | Used in ProjectInfoPanel (Phase 03) |
| `packages/web/src/api/queries.ts` | useTerminalSessions (Phase 02), useProjects, mutations |
| `packages/web/src/components/organisms/Sidebar.tsx` | Add Terminals nav item |
| `packages/web/src/App.tsx` | Add /terminals route |

### Content Migrated from Former Pages

| Source | Destination |
| ------ | ----------- |
| ProjectDetailPage: Git tab | ProjectInfoPanel: Git CollapsibleSection |
| ProjectDetailPage: Worktrees tab | ProjectInfoPanel: Worktrees CollapsibleSection |
| ProjectDetailPage: Commands tab | ProjectInfoPanel: Commands CollapsibleSection |
| ProjectDetailPage: Overview tab (badges) | ProjectInfoPanel: header row |
| ProjectsPage: project list/browse | TerminalTreeView: project nodes |
| ProcessesPage: session list/kill | TerminalTreeView: terminal nodes with status |
| BuildPage: build execution | TerminalTreeView: build command node + launch |

## Implementation Steps

### Step 1: Create useTerminalTree hook
- Combine `useProjects()` + `useTerminalSessions()`
- For each project: compute build/run from presets + custom commands
- Generate session IDs, match against active sessions
- Return `TreeProject[]`

### Step 2: Create TerminalTreeView component
- Props: `projects`, `selectedId`, `onSelectProject`, `onSelectTerminal`, `onLaunchTerminal`, `onKillTerminal`, `onAddShell`
- Collapsible project nodes with command leaves + '+ Shell' button
- Status dots + action buttons per command

### Step 3: Create ProjectInfoPanel component
- Props: `projectName`
- Uses `useProject()`, `useWorktrees()`, `useBranches()`, git mutations
- Header: name + type + branch + status badges
- CollapsibleSection: Git Operations (fetch/pull/push + branch list)
- CollapsibleSection: Worktrees (add/remove form + table)
- CollapsibleSection: Commands (list with launch buttons)
- Content migrated from ProjectDetailPage

### Step 4: Create TerminalTabBar component
- Props: `tabs`, `activeTab`, `onSelectTab`, `onCloseTab`
- Horizontal tabs with status dot + label + close button
- Active tab highlighted, overflow scroll

### Step 5: Create MultiTerminalDisplay component
- Props: `activeSessionId`, `mountedSessions` (up to 5 MRU), session metadata
- Renders up to 5 TerminalPanels, only active one visible (others display:none)
- Manages MRU eviction logic
- Empty state when no terminal selected

### Step 6: Create TerminalsPage
- State: `selection` (project or terminal), `openTabs`, `activeTab`, `expandedProjects`, `mountedTerminals`
- Layout: flex row with tree sidebar (w-64) + right panel (flex-1)
- Context switching: if selection is project → ProjectInfoPanel, if terminal → tabs + display
- Ad-hoc shell flow: prompt, create, auto-save

### Step 7: Update Sidebar navigation
Add "Terminals" nav item (may already have reduced nav from Phase 01):
```typescript
{ to: "/terminals", icon: TerminalSquare, label: "Terminals" }
```
Final nav: Dashboard, Terminals, Git, Settings

### Step 8: Update App.tsx routes
- Add `/terminals` route with TerminalsPage
- Verify old routes removed (Phase 01)

### Step 9: Implement ad-hoc shell flow
- '+ Shell' button triggers input prompt (command or blank)
- Creates PTY session with `shell:project:timestamp` ID
- Opens tab, activates terminal
- Auto-saves to config via `useUpdateProject` mutation (add to project.commands)
- Invalidate queries to refresh tree

### Step 10: Build and test

## Todo List

- [ ] Create useTerminalTree.ts hook
- [ ] Create TerminalTreeView.tsx (tree sidebar)
- [ ] Create ProjectInfoPanel.tsx (Git, Worktrees, Commands sections)
- [ ] Create TerminalTabBar.tsx
- [ ] Create MultiTerminalDisplay.tsx (hybrid mounting, MRU eviction)
- [ ] Create TerminalsPage.tsx (state management, context switching)
- [ ] Update Sidebar.tsx (add Terminals nav)
- [ ] Update App.tsx (add /terminals route)
- [ ] Implement terminal launch flow
- [ ] Implement terminal kill flow
- [ ] Implement tab close (don't kill session)
- [ ] Implement hybrid tab switching (MRU up to 5 mounted)
- [ ] Implement ad-hoc shell: prompt → create → auto-save to config
- [ ] Migrate ProjectDetailPage Git content to ProjectInfoPanel
- [ ] Migrate ProjectDetailPage Worktrees content to ProjectInfoPanel
- [ ] Migrate ProjectDetailPage Commands content to ProjectInfoPanel
- [ ] Handle edge cases: no projects, no commands, all sessions dead
- [ ] Style tree + tab bar + project info panel
- [ ] Run pnpm build
- [ ] Integration test: project info → launch terminal → switch → kill → ad-hoc shell

## Success Criteria

1. Terminals page shows project tree with all projects and their commands
2. Clicking project node shows project info (Git, Worktrees, Commands) in right panel
3. Clicking terminal/command shows terminal output with tab bar
4. Multiple terminals open in tabs, switching between 5 MRU is instant
5. Closing tab doesn't kill PTY session
6. Killing session updates tree + tab status
7. '+ Shell' creates ad-hoc terminal, auto-saves command to config
8. Git operations (fetch/pull/push) work from project info panel
9. Worktree add/remove works from project info panel
10. Sidebar: Dashboard, Terminals, Git, Settings

## Risk Assessment

- **High**: Largest phase (6 new files + significant logic). Mitigate: build incrementally — tree first, then project info, then terminal display, then ad-hoc shells.
- **Medium**: Hybrid mounting adds complexity. Mitigate: start with simple remount, add MRU caching as refinement.
- **Medium**: Migrating ProjectDetailPage content. Mitigate: copy-paste first, then clean up.
- **Low**: Ad-hoc shell auto-save depends on config.updateProject working correctly. Verified in Phase 02.

## Security Considerations

- Uses same IPC paths as existing components — no new security surface
- `terminal.create()` validates ID format and resolves env in main process
- Ad-hoc shell commands are saved to user's own config file — no privilege escalation
- Config mutation uses existing validated `config.updateProject` handler

## Next Steps

Phase 05 cleans up unused components and integrates Dashboard.
