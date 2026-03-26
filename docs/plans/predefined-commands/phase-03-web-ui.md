---
parent: plan.md
phase: "03"
status: pending
effort: 2h
dependencies: [phase-01-core.md, phase-02-electron.md]
---

# Phase 03: Web — UI for Predefined Commands

## Context

- Parent: [plan.md](plan.md)
- Depends on: [Phase 01](phase-01-core.md), [Phase 02](phase-02-electron.md)
- Docs: [codebase-summary.md](../../codebase-summary.md)

## Overview

Add predefined commands to the terminal tree sidebar. Each project node shows its predefined commands grouped by category, with play/stop controls and env badge indicators. Commands launch via existing terminal infrastructure.

## Key Insights

- `useTerminalTree` already builds `TreeCommand[]` per project — add predefined commands to this array
- `TerminalTreeView` renders `CommandRow` per command — reuse for predefined commands
- Session ID pattern `predefined:{projectName}:{sanitizedName}` maps to existing patterns
- Categories enable visual grouping (build, run, test, deploy) within project tree nodes

## Requirements

1. Add TanStack Query hook for fetching predefined commands per project
2. Extend `useTerminalTree` to include predefined commands in tree data
3. Extend `TreeCommand` type with `"predefined"` command type
4. Render predefined commands in `TerminalTreeView` grouped by category
5. Launch predefined commands via `onLaunchTerminal` with correct session ID
6. Show env file badge when command has per-command env_file
7. Show description as tooltip on hover

## Related Code Files

| File | Change |
|------|--------|
| `packages/web/src/api/queries.ts` | Add usePredefinedCommands() query hook |
| `packages/web/src/hooks/useTerminalTree.ts` | Include predefined commands in TreeCommand[] |
| `packages/web/src/components/organisms/TerminalTreeView.tsx` | Render predefined command rows with categories |
| `packages/web/src/pages/TerminalsPage.tsx` | Pass predefined command launch handler |

## Architecture

### Tree Structure (Updated)

```
Terminals (section)
├── free-terminal-1
└── free-terminal-2

Projects (section)
└── api-server (project)
    ├── Build                    ← existing (from getEffectiveCommand)
    ├── Run                      ← existing
    ├── Dev                      ← existing
    ├── ── Predefined ──         ← NEW: category divider
    │   ├── 🔨 Build (skip tests)    [▶] [env: .env.build]
    │   ├── 🔨 Package               [▶]
    │   ├── 🚀 Run JAR               [▶] [env: .env.local]
    │   ├── 🧪 Test                   [▶]
    │   └── 🧪 Lint                   [▶]
    ├── custom-cmd-1             ← existing custom commands
    └── Terminals                ← existing terminal profiles
```

### Session ID Pattern

```
predefined:{projectName}:{sanitizedCommandName}
```

Example: `predefined:api-server:build-skip-tests`

Sanitize: lowercase, replace spaces/special chars with `-`.

## Implementation Steps

### 1. Query Hook (`queries.ts`)

```typescript
export function usePredefinedCommands(projectName: string) {
  return useQuery({
    queryKey: ["predefined-commands", projectName],
    queryFn: () => window.devhub.predefinedCommands(projectName),
    staleTime: 60_000,
  });
}
```

### 2. useTerminalTree Extension (`useTerminalTree.ts`)

- Fetch predefined commands for each project
- Map to `TreeCommand[]` with type `"predefined"`
- Session ID: `predefined:{projectName}:{sanitize(cmd.name)}`
- Include `envFile` and `description` in TreeCommand (extend type)
- Insert after existing build/run/dev commands, before custom commands

Extended TreeCommand:
```typescript
type TreeCommand = {
  // existing fields...
  type: "build" | "run" | "custom" | "terminal" | "predefined";
  description?: string;  // NEW: tooltip text
  envFile?: string;       // NEW: per-command env file indicator
  category?: string;      // NEW: for grouping
};
```

### 3. TerminalTreeView Updates (`TerminalTreeView.tsx`)

**PredefinedCommandRow** (new sub-component or extend CommandRow):
- Category icon prefix (🔨 build, 🚀 run, 🧪 test, 📦 deploy)
- Play/stop button (same as CommandRow)
- Env badge: small `[env]` indicator when envFile set
- Title attribute with description for tooltip
- Grouped by category with optional divider

**Rendering in project node**:
- After build/run/dev commands
- Before custom commands and terminal profiles
- Collapsible section "Predefined Commands" if > 3 commands

### 4. TerminalsPage Launch Handler

`onLaunchTerminal` already handles terminal creation. For predefined commands:
- Session ID: `predefined:{projectName}:{sanitize(cmd.name)}`
- Command: `cmd.command`
- Project: project name (for env resolution)

## Todo

- [ ] Add usePredefinedCommands() query hook
- [ ] Extend TreeCommand type with description, envFile, category
- [ ] Update useTerminalTree to include predefined commands
- [ ] Implement sanitize helper for session IDs
- [ ] Render predefined commands in TerminalTreeView
- [ ] Add category icons and env badge
- [ ] Add tooltip with description
- [ ] Handle play/stop for predefined command sessions
- [ ] Test with multiple project types

## Success Criteria

- Predefined commands visible in tree per project
- Commands grouped by category
- Play launches PTY with correct command and env
- Stop kills running predefined command session
- Env badge visible when per-command env_file set
- Description shown on hover
- Existing build/run/dev/custom commands unaffected

## Risk Assessment

- **Low**: Additive UI changes, existing components reused
- **Medium**: Too many commands may clutter tree — mitigated by collapsible section
- **Low**: Session ID collisions unlikely with sanitization + project prefix

## Security Considerations

- Command strings displayed in UI — no injection risk (executed server-side in PTY)
- Env file paths shown as indicator only (not full path in UI)
