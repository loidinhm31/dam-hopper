---
parent: plan.md
phase: "01"
status: done
completed: 2026-03-23
priority: P1
effort: 2h
depends_on: []
---

# Phase 01: UnifiedCommandPanel Component

## Context

- Parent: [plan.md](./plan.md)
- Depends on: none
- Builds on: [custom-commands-web](../custom-commands-web/plan.md) (completed)

## Overview

Create `UnifiedCommandPanel` — a single component that renders build, run, and custom
commands with type filtering, concurrent execution, and collapsible output panels.

**Status:** pending | **Priority:** P1

## Key Insights

- Build tab code (ProjectDetailPage:382-418): `CommandPreview` + `useBuild` + result badge + `BuildLog` SSE
- Run tab code (ProjectDetailPage:420-470): `CommandPreview` + start/stop/restart + process log viewer
- Custom commands (CommandRunner.tsx): `useExecCommand` + inline edit/delete/add + result display
- All three share a pattern: command info → action button → collapsible output
- `BuildLog` listens to SSE `build:progress` events — reuse directly
- Process logs use `useProcessLogs(name, 200)` with 3s refetch — reuse pattern
- Custom exec uses `useExecCommand` returning `BuildResult` — reuse directly

## Requirements

### 1. Type Filter Tabs

```
[All] [Build] [Run] [Custom]
```

- Default: "all" shows all command cards
- Filter hides non-matching cards
- Badge counts per type in filter tabs

### 2. Command Card Layout (consistent for all types)

Each card:

```
┌─────────────────────────────────────────────────────────┐
│ [type badge] command-name    `shell command`   [actions]│
├─────────────────────────────────────────────────────────┤
│ (collapsible output panel — logs, result, etc.)         │
└─────────────────────────────────────────────────────────┘
```

### 3. Build Command Card

- Auto-derived from `getEffectiveCommand(project, "build")`
- Type badge: "build" (primary color)
- Actions: [Build] button
- Output: `BuildLog` component (SSE streaming) + result summary badge
- Name: "build" (or first service name)

### 4. Run Command Card

- Auto-derived from `getEffectiveCommand(project, "run")`
- Type badge: "run" (success color)
- Actions: [Start] [Stop] [Restart] buttons
- Output: process logs (reuse `useProcessLogs` pattern)
- Name: "run" (or first service name)

### 5. Custom Command Cards

- From `project.commands` (`Record<string, string>`)
- Type badge: "custom" (neutral)
- Actions: [Run] [Edit] [Delete] buttons
- Output: exec result (success/fail, exit code, duration, stdout/stderr)
- Inline editing: same as current CommandRunner (edit key/value, validate duplicates)
- Add command form at bottom

### 6. Concurrent Execution

- `expanded: Set<string>` — tracks which output panels are open
- Keys: `"build"`, `"run"`, `"custom:keyName"`
- Multiple panels can be open simultaneously
- Each has independent loading/result state

## Architecture

```
UnifiedCommandPanel
├── FilterTabs (all | build | run | custom)
├── BuildCard (if filter matches)
│   ├── CommandPreview (reused)
│   ├── Build button
│   └── Collapsible: BuildLog (SSE) + result summary
├── RunCard (if filter matches)
│   ├── CommandPreview (reused)
│   ├── Start/Stop/Restart buttons
│   └── Collapsible: Process logs
├── CustomCards × N (if filter matches)
│   ├── Name + command + edit/delete
│   ├── Run button
│   └── Collapsible: exec result
└── AddCommandForm (custom only)
```

## Related Code Files

| File                                                      | Role                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/components/atoms/CommandPreview.tsx`    | Reuse for build/run command display                                                                                                     |
| `packages/web/src/components/atoms/Badge.tsx`             | Type badges                                                                                                                             |
| `packages/web/src/components/atoms/Button.tsx`            | Action buttons + inputClass                                                                                                             |
| `packages/web/src/components/organisms/BuildLog.tsx`      | Reuse for build SSE output                                                                                                              |
| `packages/web/src/lib/presets.ts`                         | `getEffectiveCommand()` for build/run resolution                                                                                        |
| `packages/web/src/api/queries.ts`                         | All hooks: `useBuild`, `useStartProcess`, `useStopProcess`, `useRestartProcess`, `useProcessLogs`, `useExecCommand`, `useUpdateProject` |
| `packages/web/src/api/client.ts`                          | Types: `ProjectWithStatus`, `BuildResult`, `ProcessInfo`                                                                                |
| `packages/web/src/components/organisms/CommandRunner.tsx` | Source of custom command logic to absorb                                                                                                |

## Implementation Steps

1. Create `UnifiedCommandPanel.tsx` with props `{ project: ProjectWithStatus }`

2. Add state:
   - `filter`: `"all" | "build" | "run" | "custom"` (default "all")
   - `expanded`: `Set<string>` for open output panels
   - Custom command editing state (from CommandRunner): `editingKey`, `editKey`, `editValue`, `editKeyError`, `addMode`, `newKey`, `newValue`, `newKeyError`
   - `results`: `Record<string, BuildResult>` for custom command results
   - `runningKey`: `string | null` for custom command loading

3. Wire hooks:
   - `useBuild()`, `useStartProcess()`, `useStopProcess()`, `useRestartProcess()`
   - `useProcessLogs(project.name, 200)` — only fetch when run panel expanded
   - `useExecCommand()`, `useUpdateProject()`

4. Implement filter tabs with badge counts

5. Build card: adapt ProjectDetailPage lines 382-418
   - `CommandPreview` with `getEffectiveCommand(project, "build")`
   - Build button with loading state
   - Collapsible section: result badge + `<BuildLog project={name} />`

6. Run card: adapt ProjectDetailPage lines 420-470
   - `CommandPreview` with `getEffectiveCommand(project, "run")`
   - Start/Stop/Restart buttons
   - Collapsible section: process log viewer

7. Custom cards: absorb CommandRunner.tsx logic
   - Command list with inline edit/delete
   - Run button per command with result display
   - Add command form

8. Toggle expand: `toggleExpand(key)` updates `Set<string>`

## Todo

- [ ] Create `UnifiedCommandPanel.tsx` skeleton with filter state
- [ ] Implement filter tabs UI
- [ ] Build command card with CommandPreview + Build button + BuildLog
- [ ] Run command card with CommandPreview + process controls + logs
- [ ] Custom command cards with run/edit/delete (absorb CommandRunner)
- [ ] Add command form
- [ ] Multi-expand state management
- [ ] Wire all hooks

## Success Criteria

- Component renders all three command types
- Filter tabs correctly show/hide command types
- Build button triggers build with SSE log streaming
- Start/Stop/Restart work for run command
- Custom command run/edit/delete/add all functional
- Multiple output panels can be expanded simultaneously
- No TypeScript errors

## Risk Assessment

- **Medium**: Largest component — absorbing three separate UIs
- BuildLog SSE listener must handle project filtering correctly
- Process logs polling should only activate when run panel is expanded
- Custom command editing state is complex but proven (from CommandRunner)

## Security Considerations

- No new API calls — reuses existing authenticated endpoints
- Command execution goes through server-side resolution (no client-side shell injection)
- Inline editing validates through server Zod schema
