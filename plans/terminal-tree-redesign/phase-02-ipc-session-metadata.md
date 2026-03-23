---
parent: plan.md
phase: "02"
status: done
completed: 2026-03-24
priority: P1
effort: 1h
depends_on: []
---

# Phase 02: IPC Session Metadata

## Context

- Parent: [plan.md](./plan.md)
- Depends on: none
- Required by: Phase 04 (Unified Terminals Page)

## Overview

Extend `PtySessionManager` to store metadata (project, command, type, alive status) alongside each PTY session. Add `TERMINAL_LIST_DETAILED` IPC channel returning structured `SessionInfo[]`. Create `useTerminalSessions()` TanStack Query hook. Verify existing `config.updateProject` IPC can handle ad-hoc command saving.

**Status:** done | **Priority:** P1

## Key Insights

- PtySessionManager stores only `Map<string, IPty>` + scrollback — no metadata
- `terminal.create()` handler receives project/command but doesn't persist them
- Session IDs encode type implicitly: `build:*`, `run:*`, `custom:*:*`, `shell:*:*`
- `onExit` callback deletes session — need to keep metadata briefly for UI
- Existing `config.updateProject` IPC already supports updating project commands — ad-hoc shells can use this to auto-save

## Requirements

### SessionMeta Type

```typescript
interface SessionMeta {
  id: string;
  project: string;
  command: string;
  type: "build" | "run" | "custom" | "shell" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}
```

### PtySessionManager Changes

- Add `meta: Map<string, SessionMeta>`
- Accept `project` in `PtyCreateOpts`
- Derive `type` from session ID prefix (including new `shell:*` prefix)
- Store metadata on `create()`, update alive=false on exit
- Add `getDetailed(): SessionMeta[]`
- Clean up dead metadata after 60s

### New IPC

- `TERMINAL_LIST_DETAILED` channel + handler
- Expose via preload bridge
- Add `SessionInfo` type to `electron.d.ts`
- Add `useTerminalSessions()` hook with 3s polling

### Ad-hoc Shell Support (IPC verification)

- Verify `config.updateProject` can add entries to `project.commands` (for auto-saving ad-hoc shells)
- Session ID format for ad-hoc: `shell:${projectName}:${index}`

## Architecture

```
PtySessionManager
├── sessions: Map<string, IPty>         (existing)
├── scrollback: Map<string, string>     (existing)
├── meta: Map<string, SessionMeta>      (NEW)
├── create(opts) → stores meta          (MODIFIED)
├── onExit callback → marks alive=false (MODIFIED)
├── getAll(): string[]                  (unchanged)
├── getDetailed(): SessionMeta[]        (NEW)
└── cleanup timer for dead metadata     (NEW)
```

## Related Code Files

| File | Role |
| ---- | ---- |
| `packages/electron/src/main/pty/session-manager.ts` | Add meta Map, modify create/onExit, add getDetailed |
| `packages/electron/src/ipc-channels.ts` | Add TERMINAL_LIST_DETAILED |
| `packages/electron/src/main/ipc/terminal.ts` | Add handler, pass project to create |
| `packages/electron/src/preload/index.ts` | Add listDetailed to bridge |
| `packages/web/src/types/electron.d.ts` | Add SessionInfo type |
| `packages/web/src/api/queries.ts` | Add useTerminalSessions hook |

## Implementation Steps

1. Define `SessionMeta` interface, add `project` to `PtyCreateOpts`
2. Add `meta` Map, populate in `create()`, derive type from ID prefix
3. Update `onExit`: set alive=false, exitCode, schedule 60s cleanup
4. Update `kill()` to set alive=false in meta
5. Add `getDetailed()` method
6. Add `TERMINAL_LIST_DETAILED` to ipc-channels.ts
7. Add IPC handler in terminal.ts, pass project through in create
8. Extend preload bridge with `listDetailed`
9. Update electron.d.ts types
10. Add `useTerminalSessions()` hook in queries.ts
11. Verify `config.updateProject` supports adding custom commands

## Todo List

- [ ] Define SessionMeta interface (include "shell" type)
- [ ] Add project to PtyCreateOpts
- [ ] Add meta Map to PtySessionManager
- [ ] Populate meta in create()
- [ ] Update onExit (alive=false, exitCode, 60s cleanup)
- [ ] Update kill() (alive=false)
- [ ] Add getDetailed() method
- [ ] Update dispose() to clear meta
- [ ] Add TERMINAL_LIST_DETAILED channel
- [ ] Add IPC handler
- [ ] Extend preload bridge
- [ ] Update TypeScript types
- [ ] Add useTerminalSessions() hook
- [ ] Verify config.updateProject supports command additions
- [ ] Run pnpm build

## Success Criteria

1. `terminal.listDetailed()` returns `SessionInfo[]` with project, command, type, alive, exitCode
2. Existing `terminal.list()` still works
3. Dead sessions appear for ~60s then clean up
4. `config.updateProject` can add custom commands (for ad-hoc shell auto-save)
5. `pnpm build` succeeds

## Risk Assessment

- **Medium**: Changing PtyCreateOpts — but only one caller (terminal.ts)
- **Low**: Additive IPC channel, no breaking changes

## Security Considerations

- `listDetailed()` exposes command strings — same data already in config, no new exposure
- Handler is read-only

## Next Steps

Phase 04 consumes `useTerminalSessions()` to populate the tree.
