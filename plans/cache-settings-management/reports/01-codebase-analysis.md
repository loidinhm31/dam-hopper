# Codebase Analysis: Cache & Settings Management

## Current State

### Caching Layers
1. **TanStack Query (renderer)** — all data queries cached client-side with configurable `staleTime`/`refetchInterval`. Nuclear invalidation already exists via `workspace:changed` event (`qc.invalidateQueries()` with no filter).
2. **electron-store** — persists `lastWorkspacePath` (single key). Created in `packages/electron/src/main/index.ts` as `new Store<StoreSchema>()`. Module-scoped, not exposed to IPC handlers via `CtxHolder`.

### Settings Storage
- **Workspace config**: `dev-hub.toml` at workspace root. Parsed by `@dev-hub/core` (`readConfig`/`writeConfig`). Paths resolved to absolute on read, back to relative on write.
- **Global config**: `~/.config/dev-hub/config.toml`. Contains `defaults.workspace` and `workspaces[]` (known workspace list).

### PTY Management
- `PtySessionManager` in electron main — has `dispose()` to kill all sessions.
- Accessible via `holder.ptyManager` in all IPC handlers.

### Existing Settings Page
- `/settings` route already exists with `ConfigEditor` (workspace TOML editor) and `GlobalConfigEditor`.
- New maintenance/import-export sections can be added here directly.

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/electron/src/ipc-channels.ts` | Add 4 new CH entries |
| `packages/electron/src/main/ipc/settings.ts` | **NEW** — handlers for cache/reset/import/export |
| `packages/electron/src/main/ipc/index.ts` | Register new settings handlers |
| `packages/electron/src/main/index.ts` | Expose `store` ref to holder (or pass to settings handlers) |
| `packages/electron/src/preload/index.ts` | Add `settings` namespace |
| `packages/web/src/api/client.ts` | Add `settings` API section |
| `packages/web/src/api/queries.ts` | Add 4 mutations |
| `packages/web/src/pages/SettingsPage.tsx` | Add Maintenance + Import/Export sections |
| `packages/web/src/types/electron.ts` | Extend `window.devhub` type with settings |

## Design Decisions

1. **electron-store access**: Pass `store` instance to settings handler registration (same pattern as `ptyManager` in holder, but cleaner as a direct arg since only settings handlers need it).
2. **Nuclear reset flow**: Clear store → dispose PTY → set `holder.current = null` → send `workspace:changed` with `null` data → renderer sees `status.ready = false` → shows WelcomePage.
3. **Import validation**: Use existing `readConfig()` which validates via Zod schema. If validation fails, reject import with error message.
4. **Export**: Read raw TOML from disk (preserves comments/formatting), don't re-serialize from in-memory config.

## Unresolved Questions
None — requirements are clear from user answers.
