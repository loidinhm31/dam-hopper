---
parent: plan.md
phase: "02"
status: done
priority: P1
effort: 2h
depends_on: ["01"]
---

# Phase 02: Commands Tab in ProjectDetailPage

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-api-client-hooks.md) (api hooks)
- Research: [web-ui](./research/researcher-02-web-ui.md)

## Parallelization Info

- **Group**: B (runs after Phase 01)
- **Can run with**: Phase 03 (no file overlap)
- **Blocked by**: Phase 01

## Overview

Add a "Commands" tab to ProjectDetailPage that lists all custom commands from
`project.commands`, lets users execute them via the exec API, view output, and
add/edit/delete commands inline.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- `project.commands` is `Record<string, string>` — key=name, value=shell command
- ConfigEditor has `CommandsForm` but it's tightly coupled to the editor form
- Better to build a `CommandRunner` component: combines command list + execution + output
- BuildLog.tsx pattern for SSE output display can be adapted for `command:progress`
- `useUpdateProject` hook already supports `PATCH /config/projects/:name` for inline edits
- `useConfig` + `useUpdateConfig` can also update commands through full config update

## Requirements

### 1. New CommandRunner Component

A standalone component that:

- Shows all commands from `project.commands` in a list
- Each command row: name, shell command, "Run" button, "Edit" / "Delete" actions
- "Run" button calls `useExecCommand` → shows result (success/fail + output)
- Command output displayed inline (collapsible per command)
- "Add command" form at bottom

### 2. Add "Commands" Tab to ProjectDetailPage

- New tab after "Run": `{ key: "commands", label: "Commands" }`
- Tab content renders `<CommandRunner project={project} />`
- Show command count badge on tab if commands exist

### 3. Inline Command Editing

- Edit mode: click command name/value to edit inline
- Save via `useUpdateProject({ name, data: { commands: updatedCommands } })`
- Delete: remove key from commands map, save
- Add: append new key-value, save

### 4. Command Execution Output

- On "Run" click: call `useExecCommand({ project: name, command: cmdKey })`
- Show loading spinner during execution
- Display result: success/fail badge, exit code, duration
- Show stdout/stderr in collapsible log area (similar to BuildLog)
- Optionally listen to SSE `command:progress` for real-time streaming

## Architecture

```
ProjectDetailPage
  └── tab === "commands"
      └── CommandRunner (new component)
          ├── CommandList (inline)
          │   ├── CommandRow × N (name, value, Run, Edit, Delete)
          │   └── AddCommandForm
          └── CommandOutput (inline, shown after Run)
```

## File Ownership

| File                                                      | Action                                       |
| --------------------------------------------------------- | -------------------------------------------- |
| `packages/web/src/pages/ProjectDetailPage.tsx`            | Add "Commands" tab + render CommandRunner    |
| `packages/web/src/components/organisms/CommandRunner.tsx` | New component (command list + exec + output) |

## Implementation Steps

1. Create `CommandRunner.tsx` component:
   - Props: `{ project: ProjectWithStatus }`
   - State: `editingKey`, `newCmdKey`, `newCmdValue`, `executingCmd`, `execResult`
   - Command list with inline edit/delete
   - "Add command" row
   - "Run" button per command using `useExecCommand`
   - Result display area

2. Update `ProjectDetailPage.tsx`:
   - Import CommandRunner
   - Add "Commands" to Tab type union
   - Add tab entry with optional count badge
   - Render CommandRunner in tab content

## Todo

- [ ] Create `CommandRunner.tsx` component
- [ ] Add "Commands" tab to ProjectDetailPage
- [ ] Wire up inline command editing via `useUpdateProject`
- [ ] Wire up command execution via `useExecCommand`
- [ ] Show execution results inline
- [ ] Add command count badge on tab

## Success Criteria

- Commands tab visible in ProjectDetailPage
- All custom commands from config displayed with name + shell command
- "Run" button executes command and shows result (success/fail, output)
- Can add new commands inline
- Can edit existing command name/value
- Can delete commands
- Changes persist to `dev-hub.toml` via API

## Conflict Prevention

- Only modifies `ProjectDetailPage.tsx` (not touched by Phase 03 which handles BuildPage.tsx)
- Creates new file `CommandRunner.tsx` (exclusive)

## Risk Assessment

- **Medium**: Largest phase, most new code
- Inline editing UX needs careful state management
- SSE streaming for command output is optional enhancement (can show final result only)

## Security Considerations

- Command names sent to server (not shell strings) — server resolves from config
- Inline editing validates through server's Zod schema on PATCH
