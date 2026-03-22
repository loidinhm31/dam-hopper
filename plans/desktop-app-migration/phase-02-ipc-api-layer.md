---
parent: plan.md
phase: "02"
status: done
priority: P1
effort: 3h
depends_on: ["01"]
---

# Phase 02: IPC API Layer (Replace HTTP)

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-electron-shell.md)

## Overview

Replace all HTTP fetch calls in `@dev-hub/web` with Electron IPC calls. The Hono server routes become `ipcMain.handle()` handlers in the main process. The web client calls `window.devhub.invoke()` instead of `fetch('/api/...')`.

## Key Insights

- Current web client (`client.ts`) has ~25 API methods across 7 domains (workspace, globalConfig, projects, git, config, build, exec, processes)
- All follow simple request/response pattern — perfect for `ipcMain.handle()`
- SSE events (build progress, workspace:changed) → `ipcMain` event channels
- Current server routes call core services directly — same calls move to IPC handlers
- Type safety preserved: preload exposes typed methods, renderer consumes them

## Requirements

### 1. IPC Handlers (Main Process)

Create handler modules mirroring server routes:

```
packages/electron/src/ipc/
├── index.ts          # Register all handlers
├── workspace.ts      # workspace:get, workspace:switch, workspace:known, etc.
├── projects.ts       # projects:list, projects:get, projects:status
├── git.ts            # git:fetch, git:pull, git:push, git:worktrees, git:branches
├── config.ts         # config:get, config:update, config:updateProject
├── build.ts          # build:start (delegates to core, emits progress events)
├── processes.ts      # run:start, run:stop, run:restart, run:logs
├── exec.ts           # exec:run (delegates to commandService)
└── events.ts         # Event forwarding: core emitters → renderer
```

### 2. Preload API (contextBridge)

Expose all methods under `window.devhub`:

```typescript
window.devhub = {
  // Request/response (ipcRenderer.invoke)
  workspace: { get, switch, known, addKnown, removeKnown },
  globalConfig: { get, updateDefaults },
  projects: { list, get, status },
  git: { fetch, pull, push, worktrees, addWorktree, removeWorktree, branches, updateBranch },
  config: { get, update, updateProject },
  build: { start },
  exec: { run },
  processes: { list, start, stop, restart, logs },

  // Event subscriptions (ipcRenderer.on/off)
  on: (channel: string, callback: Function) => unsubscribe,
  off: (channel: string) => void,

  // Terminal (Phase 03)
  terminal: { ... },
};
```

### 3. Web Client Replacement

Replace `packages/web/src/api/client.ts`:
- Remove all `fetch()` calls and HTTP helpers (`get`, `post`, `put`, `patch`, `del`)
- Replace with `window.devhub.*` IPC calls — Electron-only, no HTTP fallback
- Keep same TypeScript types (they're framework-agnostic)
- Add `window.devhub` type declaration file (`src/types/electron.d.ts`)

### 4. Event Bridge (Replace SSE)

Current SSE events to bridge:
- `build:progress` → `ipcMain` forwards from `buildService.emitter`
- `exec:progress` → `ipcMain` forwards from `commandService.emitter`
- `run:progress` → `ipcMain` forwards from `runService.emitter`
- `workspace:changed` → `ipcMain` sends when workspace switches
- `heartbeat` → not needed (IPC is always connected)

Replace SSE `EventSource` in web with `window.devhub.on(channel, callback)`.
Remove all SSE/EventSource code entirely.

## Architecture

```
Renderer                          Main Process
window.devhub.projects.list()
  → ipcRenderer.invoke('projects:list')
    → ipcMain.handle('projects:list')
      → ctx.config.projects (with git status)
    ← return ProjectWithStatus[]
  ← Promise<ProjectWithStatus[]>

Event flow:
  buildService.emitter.on('progress')
    → mainWindow.webContents.send('build:progress', event)
      → window.devhub.on('build:progress', cb)
        → React component updates
```

## Related Code Files

| File | Role |
|------|------|
| `packages/web/src/api/client.ts` | Replace fetch → IPC calls |
| `packages/web/src/api/queries.ts` | Update SSE hooks to use IPC events |
| `packages/server/src/routes/*.ts` | Reference for handler logic |
| `packages/server/src/services/context.ts` | Service context pattern |
| `packages/server/src/routes/events.ts` | SSE event logic to migrate |

## Implementation Steps

1. Create IPC handler modules in `packages/electron/src/main/ipc/`
2. Port each server route to corresponding `ipcMain.handle()` call
3. Wire event emitters from core services to `webContents.send()`
4. Update `preload/index.ts` — expose full `devhub` API via contextBridge
5. Add `window.devhub` TypeScript declaration file (`packages/web/src/types/electron.d.ts`)
6. Rewrite `client.ts` — remove all HTTP/fetch code, use `window.devhub.*` exclusively
7. Rewrite `queries.ts` — remove SSE `EventSource`, use IPC event listeners
8. Verify all existing pages work through IPC

## Todo

- [x] Create IPC handler modules (workspace, projects, git, config, build, exec, processes)
- [x] Port server route logic to IPC handlers
- [x] Wire core event emitters to renderer
- [x] Expand preload with full API
- [x] Add TypeScript declarations for window.devhub
- [x] Rewrite client.ts — IPC only, remove all HTTP code
- [x] Rewrite queries.ts — IPC events, remove all SSE code
- [x] Test all pages through Electron IPC

## Success Criteria

- All web pages functional through Electron IPC (no HTTP server running)
- Build progress events stream to renderer via IPC
- Process logs update via IPC events
- Workspace switching works via IPC
- TypeScript compiles cleanly
- No HTTP fetch or SSE code remaining in web package

## Risk Assessment

- **Medium**: Largest phase — 25+ API methods to port
- Event ordering must be preserved (build progress is sequential)
- Type safety across IPC boundary — preload types must match

## Security Considerations

- All IPC channels validated in handler (no arbitrary channel names)
- Preload exposes only defined methods — no raw `ipcRenderer` access
- Input validation: same Zod schemas from server routes apply
