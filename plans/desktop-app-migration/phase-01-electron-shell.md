---
parent: plan.md
phase: "01"
status: done
priority: P1
effort: 3h
depends_on: []
---

# Phase 01: Electron Shell + IPC Foundation

## Context

- Parent: [plan.md](./plan.md)
- Depends on: none
- Docs: [codebase-summary](../../docs/codebase-summary.md)

## Overview

Create `packages/electron` — the Electron main process package. Set up window management, preload script with contextBridge, and basic IPC scaffolding. The renderer loads the existing `@dev-hub/web` Vite app.

## Key Insights

- Electron main process can import `@dev-hub/core` directly (same Node.js runtime)
- Preload script must use `contextBridge.exposeInMainWorld()` — never enable `nodeIntegration`
- Use `electron-vite` for Vite-native build tooling (main + preload + renderer in one config)
- Dev mode: `electron-vite dev` starts Vite dev server + Electron concurrently
- Prod mode: `electron-vite build` bundles everything, renderer loads built files
- `electron-store` for persisting last-used workspace path
- `electron-rebuild` needed for native modules (node-pty in Phase 03)

## Requirements

### 1. New Package: `packages/electron`

```
packages/electron/
├── package.json
├── electron.vite.config.ts   # electron-vite config (main + preload + renderer)
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron app entry point
│   │   └── ipc/
│   │       └── index.ts      # IPC handler registration
│   └── preload/
│       └── index.ts          # Context bridge for renderer
├── resources/                # App icons, assets
```

Note: Renderer is `@dev-hub/web` — electron-vite points to it, no duplication.

### 2. Main Process (`main/index.ts`)

- Create BrowserWindow with `contextIsolation: true`, `nodeIntegration: false`
- Preload script path resolution (electron-vite handles this via `__dirname`)
- Dev mode: electron-vite auto-loads Vite dev server URL
- Prod mode: electron-vite auto-resolves built renderer files
- Initialize `@dev-hub/core` services (same as current `ServerContext`)
- **Workspace resolution**: read last-used path from `electron-store`. If none, show native folder picker dialog via `dialog.showOpenDialog()`
- Persist selected workspace path in `electron-store` on every successful load
- Register IPC handlers
- Graceful shutdown: stop all processes on `before-quit`

### 3. Preload Script (`preload.ts`)

Expose typed API via `contextBridge`:

```typescript
contextBridge.exposeInMainWorld("devhub", {
  // Phase 02 will add all API methods
  // Phase 03 will add terminal methods
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
});
```

### 4. Core Service Context

Reuse `ServerContext` pattern from `@dev-hub/server`:

- `config`, `workspaceRoot`, `buildService`, `runService`, `commandService`, `gitService`, `bulkGitService`
- Initialize on app startup with workspace from `electron-store` or folder picker

### 5. Dev Workflow

Root `package.json` scripts:

- `dev:electron` — `electron-vite dev` (starts Vite + Electron concurrently, with HMR)
- `build:electron` — `electron-vite build` (builds main + preload + renderer)

### 6. Web Package Adjustments

- `packages/web/vite.config.ts`: add `base: './'` for file:// protocol in production
- No other web changes in this phase

### 7. Dependencies

- `electron` — desktop shell
- `electron-vite` — Vite-native build toolchain for Electron
- `electron-store` — persist last-used workspace path
- `electron-rebuild` — rebuild native modules (used in Phase 03 for node-pty)

## Architecture

```
packages/electron/src/main/index.ts
├── createWindow() → BrowserWindow
├── resolveWorkspace() → electron-store last path or dialog picker
├── initContext(workspacePath) → services from @dev-hub/core
├── registerIpcHandlers(context) → Phase 02
├── app.on('ready') → resolveWorkspace + initContext + createWindow
└── app.on('before-quit') → runService.stopAll()

packages/electron/src/preload/index.ts
└── contextBridge.exposeInMainWorld('devhub', {...})

packages/electron/electron.vite.config.ts
└── configures main + preload + renderer (points to @dev-hub/web)

packages/web/ (renderer)
└── loads in BrowserWindow, base: './' for prod
```

## Related Code Files

| File                                      | Role                                         |
| ----------------------------------------- | -------------------------------------------- |
| `packages/server/src/services/context.ts` | Reference for service initialization pattern |
| `packages/server/src/app.ts`              | Reference for web dist path resolution       |
| `packages/web/vite.config.ts`             | Needs `base: './'` addition                  |
| `packages/web/src/api/client.ts`          | Will be replaced in Phase 02                 |

## Implementation Steps

1. Create `packages/electron/package.json` with electron, electron-vite, electron-store, electron-rebuild deps
2. Add to `pnpm-workspace.yaml` if needed (packages/\* glob should cover it)
3. Create `electron.vite.config.ts` configuring main + preload + renderer (pointing to @dev-hub/web)
4. Implement `src/main/index.ts` — window creation, workspace resolution (electron-store + dialog), context init
5. Implement `src/preload/index.ts` — minimal contextBridge scaffold
6. Create `src/main/ipc/index.ts` — empty handler registration (populated in Phase 02)
7. Update `packages/web/vite.config.ts` — add `base: './'`
8. Add root scripts: `dev:electron` → `electron-vite dev`, `build:electron` → `electron-vite build`
9. Verify: `pnpm dev:electron` opens window with web dashboard

## Todo

- [ ] Create packages/electron package structure
- [ ] Configure electron.vite.config.ts
- [ ] Implement main/index.ts with window + workspace resolution + context
- [ ] Implement preload/index.ts with contextBridge
- [ ] Create IPC handler scaffold
- [ ] Add electron-store for workspace persistence
- [ ] Update web vite.config.ts
- [ ] Add root dev/build scripts
- [ ] Verify window loads web dashboard

## Success Criteria

- `pnpm dev:electron` launches Electron window showing the React dashboard
- Context isolation enabled, no nodeIntegration
- @dev-hub/core services initialized in main process
- Last-used workspace persisted and restored on relaunch
- First launch shows folder picker dialog
- No TypeScript errors across all packages

## Risk Assessment

- **Low**: Standard Electron boilerplate, well-documented patterns
- Web assets must load correctly from both dev server and file:// protocol
- Monorepo resolution: Electron must find `@dev-hub/core` and `@dev-hub/web` packages

## Security Considerations

- `contextIsolation: true` + `nodeIntegration: false` — mandatory
- Preload uses `contextBridge` — no direct Node.js access from renderer
- `webSecurity` left at default (true) — CSP headers for production
