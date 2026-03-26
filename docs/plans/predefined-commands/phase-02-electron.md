---
parent: plan.md
phase: "02"
status: pending
effort: 1.5h
dependencies: [phase-01-core.md]
---

# Phase 02: Electron — IPC & PTY Integration

## Context

- Parent: [plan.md](plan.md)
- Depends on: [Phase 01](phase-01-core.md) (schema, presets, env resolution)
- Docs: [codebase-summary.md](../../codebase-summary.md)

## Overview

Update Electron IPC handlers to support launching predefined commands with per-command env file resolution. Add `predefined:` session ID prefix to PtySessionManager type derivation.

## Key Insights

- `TERMINAL_CREATE` already resolves project env via `resolveEnv()` — needs to pass env_file override
- Session type derived from ID prefix in `deriveType()` — add `"predefined"` type
- No new IPC channels needed — `TERMINAL_CREATE` handles all terminal types
- Need new IPC for fetching predefined commands list per project

## Requirements

1. Add `"predefined"` to session type union in PtySessionManager
2. Handle `predefined:` prefix in `deriveType()`
3. Update `TERMINAL_CREATE` to resolve per-command env_file when launching predefined commands
4. Add IPC handler to return predefined commands for a project (resolved from core)
5. Update preload bridge to expose predefined commands query

## Related Code Files

| File | Change |
|------|--------|
| `packages/electron/src/main/pty/session-manager.ts` | Add "predefined" type, handle prefix |
| `packages/electron/src/main/ipc/terminal.ts` | Env override in TERMINAL_CREATE, new handler |
| `packages/electron/src/main/ipc/ipc-channels.ts` | Add PREDEFINED_COMMANDS channel |
| `packages/electron/src/preload/index.ts` | Expose predefined commands query |

## Implementation Steps

### 1. Session Manager (`session-manager.ts`)

Add to SessionType union:
```typescript
type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "predefined" | "unknown"
```

Update `deriveType()`:
```typescript
if (id.startsWith("predefined:")) return "predefined";
```

### 2. IPC Channels (`ipc-channels.ts`)

```typescript
export const PREDEFINED_COMMANDS = "predefined:commands";
```

### 3. Terminal IPC (`terminal.ts`)

Update `TERMINAL_CREATE` handler:
- When session ID starts with `predefined:`, extract command name from ID
- Look up predefined command config to get per-command `envFile`
- Pass `envFileOverride` to `resolveEnv(project, workspaceRoot, envFileOverride)`

Add new handler:
```typescript
ipcMain.handle(PREDEFINED_COMMANDS, async (_event, { projectName }) => {
  const project = projects.find(p => p.name === projectName);
  if (!project) return [];
  return getPredefinedCommands(project);
});
```

### 4. Preload (`preload/index.ts`)

Expose in `window.devhub`:
```typescript
predefinedCommands: (projectName: string) =>
  ipcRenderer.invoke(PREDEFINED_COMMANDS, { projectName }),
```

## Todo

- [ ] Add "predefined" to session type union
- [ ] Update deriveType() for "predefined:" prefix
- [ ] Update TERMINAL_CREATE for per-command env_file resolution
- [ ] Add PREDEFINED_COMMANDS IPC channel
- [ ] Add handler returning getPredefinedCommands(project)
- [ ] Update preload bridge
- [ ] Manual test: launch predefined command, verify env loaded

## Success Criteria

- Predefined commands spawn PTY sessions with correct env
- Per-command env_file overrides project-level env_file
- `predefined:` sessions classified correctly in metadata
- Preload exposes command list query

## Risk Assessment

- **Low**: Additive changes to existing IPC handlers
- **Low**: Session type extension is backward compatible
- **Medium**: Env resolution ordering must be tested (per-command > project > process)

## Security Considerations

- Env file path resolution uses same `resolve()` as existing code (relative to project dir)
- No new IPC channels bypass workspace gating
