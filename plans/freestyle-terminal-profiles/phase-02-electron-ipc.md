---
parent: ./plan.md
phase: 2
status: done
completed: 2026-03-25
depends_on: [phase-01]
---

# Phase 02: Electron IPC & PTY

## Overview
Extend Electron main process to support custom cwd in terminal creation and CRUD for project terminal profiles.

## Context
- PTY manager: `packages/electron/src/main/pty/session-manager.ts`
- Terminal IPC: `packages/electron/src/main/ipc/terminal.ts`
- Config IPC: `packages/electron/src/main/ipc/config.ts`
- IPC channels: `packages/electron/src/ipc-channels.ts`
- Preload: `packages/electron/src/preload/index.ts`

## Key Insights
- cwd is currently hardcoded to `project.path` in TERMINAL_CREATE handler
- SessionMeta doesn't store cwd — needed for multi-instance tracking
- Profile CRUD can piggyback on existing CONFIG_UPDATE_PROJECT (update project's `terminals` array)
- Session ID format: `terminal:{projectName}:{profileName}:{timestamp}` for multi-instance support

## Requirements
1. TERMINAL_CREATE accepts optional `cwd` override
2. SessionMeta stores `cwd` for display and reconnection
3. Profile CRUD via project config update (no new IPC channels needed for MVP)
4. Session ID encodes profile name for matching instances to profiles

## Architecture

### TERMINAL_CREATE Enhancement
```typescript
// Current: { id, project, command, cols, rows }
// New:     { id, project, command, cols, rows, cwd? }

ipcMain.handle(CH.TERMINAL_CREATE, async (_e, opts) => {
  const project = ctx.config.projects.find(p => p.name === opts.project);

  // cwd resolution: explicit > project path
  const effectiveCwd = opts.cwd || project?.path || ctx.workspaceRoot;

  // Env resolution: still from project if available, empty if no project
  const env = project
    ? await resolveEnv(project, ctx.workspaceRoot)
    : { ...process.env };

  holder.ptyManager.create({
    id: opts.id,
    command: opts.command,
    cwd: effectiveCwd,
    env,
    cols, rows,
    project: opts.project,
  });
});
```

### SessionMeta Enhancement
```typescript
interface SessionMeta {
  id: string;
  project: string;
  command: string;
  cwd: string;         // NEW: actual cwd used
  type: "build" | "run" | "custom" | "shell" | "terminal" | "unknown";  // NEW: "terminal" type
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}
```

### Session ID Convention
```
terminal:{projectName}:{profileName}:{timestamp}
```
Examples:
- `terminal:api-server:Claude Agent:1711234567890`
- `terminal:api-server:Claude Agent:1711234568123`  (second instance)

Session type derived from `terminal:` prefix. Profile name extracted from ID for matching.

### Profile CRUD
No new dedicated IPC channels. Use existing `CONFIG_UPDATE_PROJECT` to update the project's `terminals` array:

```typescript
// Add profile
window.devhub.config.updateProject("api-server", {
  terminals: [...existingTerminals, newProfile]
});

// Remove profile
window.devhub.config.updateProject("api-server", {
  terminals: existingTerminals.filter(t => t.name !== profileName)
});

// Update profile
window.devhub.config.updateProject("api-server", {
  terminals: existingTerminals.map(t => t.name === name ? updated : t)
});
```

This reuses the existing write-lock and validation pipeline.

### Preload: No Changes Needed
Profile CRUD uses existing `window.devhub.config.updateProject()`. Only change: `TerminalCreateOpts` gains optional `cwd`.

## Implementation Steps

1. Add `cwd` to `SessionMeta` in `session-manager.ts`
2. Update `create()` to store cwd in metadata
3. Update `getDetailed()` to return cwd in session info
4. Add `"terminal"` to session type derivation (from `terminal:` ID prefix)
5. Update TERMINAL_CREATE handler to accept and use optional `cwd`
6. Handle env resolution fallback when cwd doesn't match a project path
7. Update preload types for `cwd` in `TerminalCreateOpts`

## Related Code Files
- `packages/electron/src/main/ipc/terminal.ts:7-41` — TERMINAL_CREATE handler
- `packages/electron/src/main/pty/session-manager.ts:20-30` — SessionMeta type
- `packages/electron/src/main/pty/session-manager.ts:34-40` — type derivation from ID prefix
- `packages/electron/src/main/pty/session-manager.ts:50-85` — create() method
- `packages/electron/src/main/ipc/config.ts:70-108` — CONFIG_UPDATE_PROJECT (used for profile CRUD)

## Success Criteria
- [x] TERMINAL_CREATE accepts optional `cwd` and spawns PTY in that directory
- [x] SessionMeta includes `cwd` field, returned by `listDetailed()`
- [x] Session type `"terminal"` derived from `terminal:` ID prefix
- [x] Multiple sessions with same profile name coexist (different timestamps)
- [x] Env resolution works with custom cwd (falls back gracefully)
- [x] Existing build/run/custom/shell sessions unaffected

## Risk Assessment
- **Low**: Backward compatible — `cwd` is optional, defaults to project.path
- **Low**: No new IPC channels — profile CRUD via existing updateProject
- Ensure `getDetailed()` returns cwd without breaking existing consumers (additive field)
