# Phase 01: Electron Main Process Changes

## Context Links
- [Plan](./plan.md)
- [Codebase Analysis](./reports/01-codebase-analysis.md)
- Main entry: `packages/electron/src/main/index.ts`
- IPC channels: `packages/electron/src/ipc-channels.ts`
- Preload: `packages/electron/src/preload/index.ts`

## Overview

- **Date**: 2026-03-23
- **Completed**: 2026-03-23
- **Description**: Restructure Electron main process startup to create BrowserWindow before workspace resolution. Introduce "no-workspace" state and new IPC channels.
- **Priority**: P2
- **Implementation status**: done
- **Review status**: done

## Key Insights

- Currently `createWindow()` only runs after `resolveWorkspace()` + `initContext()` succeed
- `registerIpcHandlers(holder)` requires a valid `CtxHolder` with initialized context
- The `CtxHolder` pattern uses a mutable `.current` field -- can start as null/undefined
- `workspace.openDialog` IPC handler is registered outside `registerIpcHandlers` -- good, it's independent
- `workspace.known` is inside `registerWorkspaceHandlers` which needs holder -- needs to be available pre-workspace

## Requirements

1. Window appears immediately on app launch, even with no workspace
2. New IPC channel `workspace:status` returns `{ ready: boolean; name?: string; root?: string }`
3. Known workspaces list must be queryable before workspace init (reads global config only)
4. Folder picker trigger from renderer still works (already exists as `workspace:open-dialog`)
5. After workspace selected from renderer, main initializes context and notifies renderer
6. Existing workspace flows (persisted path, env var) still work -- skip welcome page

## Architecture

```
app.whenReady()
├── createWindow()                    <- moved to top, runs first
├── registerPreWorkspaceHandlers()    <- workspace:status, workspace:known, workspace:open-dialog
├── tryAutoResolve()                  <- check electron-store, env var
│   ├── success -> initContext() -> registerFullHandlers() -> send "workspace:ready"
│   └── fail -> do nothing (renderer shows welcome page)
└── on IPC "workspace:init" -> initContext() -> registerFullHandlers() -> send "workspace:ready"
```

**CtxHolder changes**: Make `current` nullable (`ElectronContext | null`). Guard all
IPC handlers that access `holder.current` with a null check. Pre-workspace handlers
(status, known, open-dialog) work without context.

## Related Code Files

- `packages/electron/src/main/index.ts` -- main restructure target
- `packages/electron/src/ipc-channels.ts` -- add new channel constants
- `packages/electron/src/preload/index.ts` -- expose new IPC methods
- `packages/electron/src/main/ipc/workspace.ts` -- split pre/post workspace handlers
- `packages/web/src/types/electron.d.ts` -- update DevHubBridge type

## Implementation Steps

### Step 1: Add new IPC channel constants
File: `packages/electron/src/ipc-channels.ts`
- Add `WORKSPACE_STATUS: "workspace:status"` to CH object
- Add `WORKSPACE_INIT: "workspace:init"` to CH object

### Step 2: Make CtxHolder.current nullable
File: `packages/electron/src/main/index.ts`
- Change `CtxHolder.current` type to `ElectronContext | null`
- Update `sendEvent` to guard on `current !== null`

### Step 3: Restructure app.whenReady()
File: `packages/electron/src/main/index.ts`
- Move `createWindow()` to run first, unconditionally
- Register pre-workspace IPC handlers (status, known, open-dialog, init)
- Attempt auto-resolve: check electron-store `lastWorkspacePath`
  - If found and valid: `initContext()` + `registerIpcHandlers()` + send `workspace:ready`
  - If not found: do nothing, renderer shows welcome page
- Add `workspace:init` handler: receives path, calls `initContext()`, registers full IPC, sends `workspace:ready`

### Step 4: Split workspace IPC registration
File: `packages/electron/src/main/ipc/workspace.ts`
- Extract `registerPreWorkspaceHandlers(holder)` -- registers status, known, open-dialog
- Keep `registerWorkspaceHandlers(holder)` for post-init handlers (get, switch, addKnown, removeKnown)
- `workspace:status` handler: returns `{ ready: holder.current !== null, name, root }`

### Step 5: Update preload
File: `packages/electron/src/preload/index.ts`
- Add `workspace.status: () => ipcRenderer.invoke(CH.WORKSPACE_STATUS)`
- Add `workspace.init: (path: string) => ipcRenderer.invoke(CH.WORKSPACE_INIT, path)`

### Step 6: Update TypeScript types
File: `packages/web/src/types/electron.d.ts`
- Add `status()` and `init(path)` to workspace section of DevHubBridge

## Todo List

- [ ] Add `WORKSPACE_STATUS` and `WORKSPACE_INIT` to CH
- [ ] Make `CtxHolder.current` nullable, add guards
- [ ] Restructure `app.whenReady()` to create window first
- [ ] Implement `tryAutoResolve()` -- non-blocking workspace check
- [ ] Split `registerWorkspaceHandlers` into pre/post workspace
- [ ] Add `workspace:status` IPC handler
- [ ] Add `workspace:init` IPC handler
- [ ] Update preload to expose new methods
- [ ] Update `DevHubBridge` type definition
- [ ] Guard against double-registration of full IPC handlers

## Success Criteria

- App window appears immediately on launch, even with no persisted workspace
- `workspace.status()` returns `{ ready: false }` when no workspace loaded
- `workspace.status()` returns `{ ready: true, name, root }` after init
- `workspace.known()` works before workspace init
- `workspace.init(path)` loads workspace and returns info
- Existing auto-resolve (persisted path) still works seamlessly

## Risk Assessment

- **Double-registration**: If auto-resolve succeeds and user triggers init again, handlers could register twice. Mitigate with boolean flag.
- **Race condition**: Window loads renderer before auto-resolve completes. Renderer queries status, gets false, shows welcome briefly. Mitigate by having auto-resolve send event.
- **Null context access**: Any IPC handler accessing `holder.current` before init will crash. Must audit all handlers.

## Security Considerations

- `workspace:init` must validate path is within home directory (same check as `workspace:switch`)
- No new `nodeIntegration` or `contextIsolation` changes needed
- Path from renderer is untrusted -- apply same validation

## Next Steps

Phase 02: Build the WelcomePage React component using these new IPC methods.
