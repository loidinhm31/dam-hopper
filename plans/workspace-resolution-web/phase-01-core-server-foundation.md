---
parent: plan.md
phase: "01"
status: done
priority: P1
effort: 2.5h
depends_on: []
---

# Phase 01: Core & Server Foundation

## Context

- Parent: [plan.md](./plan.md)
- Depends on: None (builds on completed workspace-resolution plan)
- Research: [server-mutation](./research/researcher-01-server-mutation.md)

## Overview

Add XDG global config fallback to server, implement workspace switching via context
mutation, extend GlobalConfig with known workspaces registry, and expose new API
routes for workspace management.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- Routes capture `ctx` by object reference — mutating properties is immediately visible
- `broadcast()` is a closure over `sseClients` Set, independent of services — survives swap
- `RunService.stopAll()` MUST be called before switch to prevent orphaned OS processes
- Old service emitters need `removeAllListeners()` before replacement to avoid memory leaks
- Per-route state (`statusCache`, `inProgressBuilds`) is naturally transient (TTL/completion-based)
- `writeGlobalConfig()` already does atomic writes with mode 0o600

## Requirements

### 1. Extend GlobalConfig (core)

```typescript
// packages/core/src/config/global.ts
export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
}
```

Add helpers:

- `addKnownWorkspace(name: string, path: string): Promise<void>` — reads config, appends (dedupes by path), writes
- `removeKnownWorkspace(path: string): Promise<void>` — reads config, filters out, writes
- `listKnownWorkspaces(): Promise<KnownWorkspace[]>` — reads config, returns array (empty if absent)

### 2. Server XDG Fallback

In `createServerContext()`, after `findConfigFile(input)` returns null, add:

```typescript
if (!resolvedPath) {
  const globalCfg = await readGlobalConfig();
  if (globalCfg?.defaults?.workspace) {
    const fallbackDir = resolve(globalCfg.defaults.workspace);
    // Normalize file→dir, then retry
    resolvedPath = await findConfigFile(fallbackDir);
  }
}
if (!resolvedPath) throw new ConfigNotFoundError(input);
```

### 3. `switchWorkspace()` on ServerContext

Add to `ServerContext` interface:

```typescript
switchWorkspace: (workspacePath: string) => Promise<void>;
```

Implementation sequence:

1. `await ctx.runService.stopAll()`
2. Resolve + normalize `workspacePath` (same logic as createServerContext)
3. `findConfigFile()` → `readConfig()` → extract `workspaceRoot`
4. Remove all listeners from old service emitters (4 calls)
5. Create new service instances (BulkGitService, BuildService, RunService, CommandService)
6. Wire new emitters to existing `broadcast` function (4 listeners)
7. Mutate ctx: `config`, `configPath`, `workspaceRoot`, all 4 service properties
8. Auto-register in known workspaces: `addKnownWorkspace(config.workspace.name, workspaceRoot)`
9. Broadcast `{ type: "workspace:changed", data: { name, root } }`

### 4. SSE Event Type Extension

```typescript
// Add to SSEEvent union in context.ts (or types.ts)
| { type: "workspace:changed"; data: { name: string; root: string } }
```

### 5. New API Routes

Add to `packages/server/src/routes/workspace.ts` (or new file):

| Method   | Path                      | Body                     | Response                                            | Notes                                       |
| -------- | ------------------------- | ------------------------ | --------------------------------------------------- | ------------------------------------------- |
| `POST`   | `/workspace/switch`       | `{ path: string }`       | `{ name, root, projectCount }`                      | Calls `ctx.switchWorkspace()`               |
| `GET`    | `/workspace/known`        | —                        | `{ workspaces: KnownWorkspace[], current: string }` | Reads global config                         |
| `POST`   | `/workspace/known`        | `{ path: string }`       | `{ name, path }`                                    | Validates path, reads config for name, adds |
| `DELETE` | `/workspace/known`        | `{ path: string }`       | `{ removed: true }`                                 | Removes from known list                     |
| `GET`    | `/global-config`          | —                        | `GlobalConfig`                                      | Reads XDG config                            |
| `PUT`    | `/global-config/defaults` | `{ workspace?: string }` | `{ updated: true }`                                 | Updates defaults section                    |

### 6. Request-Level Mutex During Switch (Validated)

Add a `switching` boolean flag to `ServerContext`. During `switchWorkspace()`, set it
to `true` before any teardown and `false` after context is fully settled.

Add Hono middleware in `createApp()` that checks `ctx.switching`:

```typescript
api.use("*", async (c, next) => {
  if (ctx.switching) {
    return c.json(
      { error: "Workspace switch in progress", code: "SWITCHING" },
      503,
    );
  }
  return next();
});
```

Exempt the `/events` SSE endpoint from the mutex (SSE clients should stay connected).

### 7. Auto-Init for New Workspaces (Validated)

When `POST /workspace/known` receives a path without `dev-hub.toml`:

1. Call `discoverProjects(path)` from `@dev-hub/core`
2. Build a `DevHubConfig` with discovered projects and directory name as workspace name
3. Call `writeConfig(join(path, "dev-hub.toml"), config)` to create the config
4. Proceed with registration as normal

This uses existing `discoverProjects()` and `writeConfig()` from core — no new logic needed.

### 8. Auto-Register on Startup

After `createServerContext()` resolves successfully, auto-register the current workspace
in known workspaces list (call `addKnownWorkspace()`).

## Architecture

```
POST /api/workspace/switch
    ↓
ctx.switchWorkspace(path)
    ↓
┌─ runService.stopAll()
├─ Remove old emitter listeners
├─ findConfigFile(path) → readConfig()
├─ Create new services + wire emitters
├─ Mutate ctx properties
├─ addKnownWorkspace()
└─ broadcast("workspace:changed")
    ↓
SSE → all connected web clients
    ↓
Web: invalidateQueries() (nuclear)
```

## Related Code Files

- `packages/core/src/config/global.ts` — GlobalConfig type + helpers
- `packages/core/src/config/index.ts` — new exports
- `packages/core/src/index.ts` — re-exports
- `packages/server/src/services/context.ts` — switchWorkspace(), XDG fallback, SSEEvent
- `packages/server/src/routes/workspace.ts` — new routes + auto-init logic
- `packages/server/src/app.ts` — mutex middleware
- `packages/server/src/index.ts` — auto-register on startup

## Implementation Steps

1. Extend `GlobalConfig` interface with `KnownWorkspace` type and `workspaces` array
2. Add `addKnownWorkspace()`, `removeKnownWorkspace()`, `listKnownWorkspaces()` to `global.ts`
3. Export new types/functions from core index files
4. Add XDG fallback to `createServerContext()` (after `findConfigFile` returns null)
5. Add `workspace:changed` to `SSEEvent` union type
6. Implement `switchWorkspace()` method on ServerContext
7. Add request-level mutex middleware in `createApp()` (503 when `ctx.switching`)
8. Add auto-init logic in `POST /workspace/known` route (discoverProjects + writeConfig)
9. Add workspace management routes (switch, known CRUD, global-config)
10. Add auto-register on startup in `startServer()`
11. Write tests for:

- `addKnownWorkspace()` / `removeKnownWorkspace()` (dedup, atomic write)
- XDG fallback in server context
- `switchWorkspace()` — services recreated, emitters re-wired, old processes stopped
- API routes: switch, known list/add/remove

## Todo

- [ ] Extend GlobalConfig + add KnownWorkspace type
- [ ] Add known workspace helper functions (add/remove/list)
- [ ] Export from core index
- [ ] Add XDG fallback to createServerContext()
- [ ] Add workspace:changed SSE event type
- [ ] Implement switchWorkspace() method
- [ ] Add workspace management routes
- [ ] Auto-register workspace on startup
- [ ] Add request-level mutex middleware (503 during switch)
- [ ] Add auto-init logic for workspaces without dev-hub.toml
- [ ] Tests

## Success Criteria

- `POST /api/workspace/switch` with valid path → switches workspace, stops old processes, broadcasts event
- `GET /api/workspace/known` returns list including auto-registered current workspace
- Server started without config in CWD falls back to XDG global config (parity with CLI)
- Old service emitters have no listeners after switch (no memory leak)
- Invalid switch path returns 400/404 with helpful error message

## Risk Assessment

- **Low** — `switchWorkspace()` mutates shared state but request-level mutex (503 during switch) prevents concurrent access
- **Low** — `RunService.stopAll()` has 5s timeout per process; many running processes could delay switch. Acceptable for dev tool
- **Low** — Auto-register writes to global config on every startup; atomic writes prevent corruption

## Security Considerations

- `POST /workspace/switch` path must be validated: resolve to absolute, reject paths outside home directory
- Global config file permissions (mode 0o600) already enforced by `writeGlobalConfig()`
- Path traversal in `POST /workspace/known` — validate resolved path exists and contains `dev-hub.toml`
- All paths stored in global config should be absolute (resolve before saving)

## Next Steps

→ Phase 02: Web UI workspace switcher consuming these APIs
