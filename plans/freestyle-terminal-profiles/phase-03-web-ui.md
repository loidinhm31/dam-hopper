---
parent: ./plan.md
phase: 3
status: done
completed: 2026-03-25
depends_on: [phase-01, phase-02]
---

# Phase 03: Web UI Components

## Overview
Add project terminal profile UI — minimal launch form, save-from-tab action, expandable tree with multi-instance children, and remove old shell auto-save.

## Context
- Terminals page: `packages/web/src/pages/TerminalsPage.tsx`
- Tree view: `packages/web/src/components/organisms/TerminalTreeView.tsx`
- Tree hook: `packages/web/src/hooks/useTerminalTree.ts`
- Types: `packages/web/src/types/electron.d.ts`
- Queries: `packages/web/src/api/queries.ts`

## Key Insights
- Current shell form: projectName + command → auto-saves with timestamp key
- Replace with: projectName + path + command → launch only, save is separate action
- Tree already uses CollapsibleSection — extend for profile parent → instance children
- Session ID `terminal:{project}:{profile}:{ts}` lets us group instances under profiles

## Requirements
1. Minimal launch form: project + path + command → spawns terminal (no save)
2. Save action on running terminal tab → prompts for name → persists as profile
3. Tree: saved terminals as expandable nodes under each project
4. Tree: running instances as children of their profile node
5. Click profile node → spawns new instance
6. Delete/edit profile via context action
7. Remove old shell auto-save (`shell-${Date.now()}` keys)

## Architecture

### Tree Structure (multi-instance)
```
[▼ api-server]
  ├─ build                          (preset command)
  ├─ run                            (preset command)
  ├─ [▼ Claude Agent]       [▶][✕]  (saved terminal — ▶ launch, ✕ delete)
  │   ├─ ● instance #1              (running, click to focus)
  │   └─ ● instance #2              (running, click to focus)
  └─ [▼ Dev Server]         [▶][✕]
      └─ ○ (no instances)           (idle)
```

### Launch Form (inline in TerminalsPage)
Replaces current shell prompt form:
```
┌──────────────────────────────────┐
│ Project: [api-server      ▼]     │
│ Path:    [./src           ] [📁]  │
│ Command: [claude          ]      │
│                    [Launch]      │
└──────────────────────────────────┘
```

- Project dropdown: select from configured projects
- Path: relative to project root, with folder picker button
- Command: defaults to user's shell
- Launch button: creates PTY immediately, no save

### Save Action (from running tab)
```
Tab bar:
[● claude @ api-server/src] [💾] [✕]

Click 💾 → inline prompt:
[Name: Claude Agent    ] [Save]
```

Save flow:
1. User clicks save icon on running tab
2. Inline name input appears
3. On submit: calls `config.updateProject(projectName, { terminals: [...existing, { name, command, cwd }] })`
4. Profile appears in tree, current session shown as child instance

### Type Updates
```typescript
// electron.d.ts
interface TerminalCreateOpts {
  id: string;
  project: string;
  command: string;
  cwd?: string;              // NEW
  cols: number;
  rows: number;
}

interface SessionInfo {
  id: string;
  project: string;
  command: string;
  cwd: string;               // NEW
  type: "build" | "run" | "custom" | "shell" | "terminal" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}

interface TerminalProfile {
  name: string;
  command: string;
  cwd: string;
}
```

### Tree Hook Changes (useTerminalTree.ts)

```typescript
interface TreeCommand {
  key: string;
  type: "build" | "run" | "custom" | "terminal";  // add "terminal"
  command: string;
  cwd?: string;                    // NEW: for terminal profiles
  sessionId: string;               // Base session ID (without timestamp for profiles)
  session?: SessionInfo;           // Single session (for build/run/custom)
  sessions?: SessionInfo[];        // NEW: multiple instances (for terminal profiles)
  profileName?: string;            // NEW: saved profile name
}
```

Population logic for terminals:
```typescript
// For each project.terminals profile:
for (const terminal of project.terminals ?? []) {
  const prefix = `terminal:${project.name}:${terminal.name}:`;
  const matchingSessions = allSessions.filter(s => s.id.startsWith(prefix));
  commands.push({
    key: terminal.name,
    type: "terminal",
    command: terminal.command,
    cwd: terminal.cwd,
    sessionId: prefix,  // used as launch prefix
    sessions: matchingSessions,
    profileName: terminal.name,
  });
}
```

### Removals
- Remove `shellPrompt` state and `handleShellSubmit` that auto-saves with timestamp keys
- Remove shell session entries from tree (replaced by saved terminal profiles)
- Clean up existing `shell-*` command keys? (migration: optionally convert to profiles on first load, or just leave them as custom commands)

## Implementation Steps

1. Update `electron.d.ts` with new types (cwd on opts/session, TerminalProfile, terminal type)
2. Update `useTerminalTree.ts`:
   - Add terminal profile → TreeCommand mapping with multi-session tracking
   - Match sessions to profiles via `terminal:{project}:{profile}:` ID prefix
3. Update `TerminalTreeView.tsx`:
   - Render saved terminals as expandable nodes with launch/delete buttons
   - Render running instances as children with status dots
   - Click profile name → launch new instance
   - Click instance → focus that terminal tab
4. Update `TerminalsPage.tsx`:
   - Replace shell prompt form with new launch form (project + path + command)
   - Add `handleLaunchTerminal(project, cwd, command)` — creates session with `terminal:` prefix
   - Add `handleLaunchProfile(project, profile)` — same but from saved profile
   - Add `handleSaveProfile(sessionId)` — prompts for name, saves to project config
   - Remove old `handleShellSubmit` and shell auto-save logic
5. Update `TerminalTabBar.tsx`:
   - Show cwd in tab tooltip for terminal sessions
   - Add save icon button for unsaved terminal sessions
   - Add inline name prompt when save is clicked
6. Update `queries.ts` if needed (profile data comes from config query, may not need new hooks)

## Related Code Files
- `packages/web/src/pages/TerminalsPage.tsx:29-33` — ShellPromptState (replace)
- `packages/web/src/pages/TerminalsPage.tsx:131-166` — handleShellSubmit (remove)
- `packages/web/src/hooks/useTerminalTree.ts:67-95` — custom command + shell mapping (refactor)
- `packages/web/src/components/organisms/TerminalTreeView.tsx` — tree rendering (extend)
- `packages/web/src/components/organisms/TerminalTabBar.tsx` — tab display (add save action)

## Success Criteria
- [x] Launch form: project + path + command → spawns terminal at custom cwd
- [x] Save action: running tab → name prompt → persists as `[[projects.terminals]]`
- [x] Tree: saved terminals appear under their project as expandable nodes
- [x] Tree: multiple running instances shown as children of profile node
- [x] Click profile → launches new instance (unique session ID with timestamp)
- [x] Click instance → focuses that terminal tab
- [x] Delete profile removes from config and tree
- [x] Old shell auto-save logic removed
- [x] Tab tooltip shows cwd for terminal sessions

## Risk Assessment
- **Medium**: Tree refactoring — TreeCommand gains `sessions[]` (plural) for multi-instance. Ensure build/run/custom still work with single `session?`
- **Low**: CollapsibleSection already exists for expandable tree nodes
- **Low**: Save action is simple config update via existing `updateProject` IPC
