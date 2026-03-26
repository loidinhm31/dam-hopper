# Phase 01: Backend — Types + IPC + PTY

> Parent: [plan.md](./plan.md)
> Dependencies: None
> Priority: P1 | Status: done | Review: approved

## Overview

Add "free" terminal type support to the Electron main process. Make `project` optional in IPC/types, add "free" prefix derivation in PTY session manager.

## Key Insights

- Backend already handles projectless terminals gracefully (env/cwd fallbacks exist)
- Minimal changes — mostly type widening and one new prefix case
- No new IPC channels needed

## Requirements

1. `project` field optional in `TerminalCreateOpts` and `SessionInfo`
2. `"free"` added to session type union
3. `deriveType()` handles `free:` prefix
4. IPC handler skips project lookup when project is undefined
5. Default cwd = workspace root when no project specified

## Related Code Files

| File | Purpose |
|------|---------|
| `packages/electron/src/main/pty/session-manager.ts` | Type derivation, SessionMeta |
| `packages/electron/src/main/ipc/terminal.ts` | IPC handler for terminal:create |
| `packages/electron/src/preload/index.ts` | Bridge types |
| `packages/web/src/types/electron.d.ts` | Shared type definitions |

## Implementation Steps

### 1. Update type definitions (`electron.d.ts`)
- Make `SessionInfo.project` optional: `project?: string`
- Make `TerminalCreateOpts.project` optional: `project?: string`
- Add `"free"` to SessionInfo.type union

### 2. Update PtySessionManager (`session-manager.ts`)
- Add `"free"` to SessionMeta type union
- Add `case` in `deriveType()`: if ID starts with `"free:"` → return `"free"`

### 3. Update IPC handler (`terminal.ts`)
- When `opts.project` is undefined/empty:
  - Skip project config lookup
  - Skip env resolution (no project env)
  - Use workspace root as cwd (from `holder.workspaceRoot`)
  - Set `project` to empty string in meta (or leave undefined)
- Pass through to `ptyManager.create()` as normal

### 4. Update preload bridge (`preload/index.ts`)
- Ensure `project` is optional in the create call signature

## Todo

- [x] Update SessionInfo and TerminalCreateOpts types
- [x] Add "free" to type union and deriveType()
- [x] Update IPC handler for projectless creation
- [x] Update preload bridge types
- [x] Manual test: create free terminal via IPC

## Success Criteria

- Can create a PTY session with ID `free:123456` and no project field
- Session type correctly derived as `"free"`
- Session cwd defaults to workspace root
- Existing project terminals unaffected

## Risk Assessment

- **Low risk**: Changes are additive (optional field, new enum value)
- Type narrowing in existing code may need `project ?? ""` guards

## Security Considerations

- Free terminals inherit workspace environment only (no project env file loaded)
- cwd validated to be within workspace root (existing security)
