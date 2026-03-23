# Phase 06 — Server API

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phases**: [phase-02-core-config.md](./phase-02-core-config.md), [phase-03-core-git.md](./phase-03-core-git.md), [phase-04-core-build-run.md](./phase-04-core-build-run.md)
- **Next phase**: [phase-07-web-dashboard.md](./phase-07-web-dashboard.md)
- **Depends on**: Phases 2, 3, 4 (all core services)
- **Parallel with**: [phase-05-cli.md](./phase-05-cli.md)

## Overview

- **Date**: 2026-03-21
- **Priority**: High
- **Status**: `done`
- **Completion Date**: 2026-03-21

Build the `@dev-hub/server` package — a Hono-based HTTP API that exposes all core services to the web dashboard. REST endpoints for CRUD operations, SSE for real-time streaming (git progress, build output, process logs). Static file serving for the pre-built web dashboard. Hono RPC enables type-safe client generation consumed by the web package.

## Key Insights

- Hono is lightweight (~14KB), has first-class TypeScript support, and Hono RPC generates a client type from route definitions — no manual API client typing needed.
- SSE (Server-Sent Events) is simpler than WebSocket for this use case: server-to-client streaming only. The web dashboard receives progress events, build logs, and status changes via a single SSE connection.
- The server holds a singleton `RunService` for process management, so process state persists across API calls.
- Static file serving embeds the web dashboard — `dev-hub ui` just starts the server and opens the browser.
- CORS is not needed since the dashboard is served from the same origin.

## Requirements

- REST endpoints for workspace config, project listing, and project status.
- REST endpoints to trigger git operations (fetch, pull, push, worktree, branch).
- REST endpoints to trigger builds and manage running processes.
- SSE endpoint that streams all real-time events (git progress, build output, process logs, status changes).
- Static file serving for the web dashboard.
- Hono RPC type export for the web package to consume.
- Clean shutdown: stop all running processes when server exits.

## Architecture

### Route Map

```
GET    /api/workspace                     # WorkspaceConfig
GET    /api/projects                      # ProjectConfig[] with runtime status
GET    /api/projects/:name                # Single project detail
GET    /api/projects/:name/status         # GitStatus for project

POST   /api/git/fetch                     # { projects?: string[] } — bulk fetch
POST   /api/git/pull                      # { projects?: string[] } — bulk pull
POST   /api/git/push/:project             # Push single project
GET    /api/git/worktrees/:project        # List worktrees
POST   /api/git/worktrees/:project        # Add worktree { branch, create?, base? }
DELETE /api/git/worktrees/:project        # Remove worktree { path }
GET    /api/git/branches/:project         # List branches
POST   /api/git/branches/:project/update  # Update branches { branch?: string }

POST   /api/build/:project               # Trigger build
GET    /api/processes                     # List running processes
POST   /api/run/:project                  # Start process
DELETE /api/run/:project                  # Stop process
POST   /api/run/:project/restart          # Restart process
GET    /api/run/:project/logs             # Get log buffer { lines?: number }

GET    /api/events                        # SSE stream (all events)

GET    /*                                 # Static files (web dashboard)
```

### Module Structure

```
packages/server/src/
  index.ts                                # Entry: create app, start server
  app.ts                                  # Hono app definition with all routes
  routes/
    workspace.ts                          # GET /api/workspace, GET /api/projects
    git.ts                                # All /api/git/* routes
    build.ts                              # POST /api/build/:project
    processes.ts                          # All /api/run/* routes
    events.ts                             # GET /api/events (SSE)
  services/
    context.ts                            # Server context: holds core service instances
  middleware/
    error-handler.ts                      # Global error handler
  types.ts                                # Request/response types
```

### SSE Event Types

```typescript
// All events sent over the SSE connection
type SSEEvent =
  | { type: "git:progress"; data: GitProgressEvent }
  | { type: "build:progress"; data: BuildProgressEvent }
  | { type: "process:event"; data: RunProgressEvent }
  | { type: "status:changed"; data: { projectName: string } }
  | { type: "heartbeat"; data: { timestamp: number } };
```

### Server Context

```typescript
interface ServerContext {
  config: DevHubConfig;
  configPath: string;
  bulkGitService: BulkGitService;
  buildService: BuildService;
  runService: RunService;
  sseClients: Set<SSEClient>; // active SSE connections
}
```

## Related Code Files

- `packages/server/src/**/*.ts` — all new (except stub index.ts from Phase 01)
- `packages/core/src/` — consumed services
- `packages/web/` — consumes the Hono RPC type (Phase 07)

## Implementation Steps

1. **Implement `services/context.ts`**
   - `createServerContext(configPath?: string): Promise<ServerContext>`
     - Load workspace config using `loadWorkspaceConfig()`.
     - Instantiate `BulkGitService`, `BuildService`, `RunService`.
     - Create SSE client set.
     - Wire up all event emitters to broadcast to SSE clients (see step 7).

2. **Implement `middleware/error-handler.ts`**
   - Hono middleware that catches errors and returns structured JSON:
     ```json
     { "error": "message", "code": "GIT_CONFLICT", "details": {} }
     ```
   - Map `GitError` categories to HTTP status codes:
     - `network` -> 502, `auth` -> 401, `conflict` -> 409, `lock` -> 423, `not_repo` -> 404, `unknown` -> 500.

3. **Implement `routes/workspace.ts`**
   - `GET /api/workspace` — return the workspace config (name, root, project count).
   - `GET /api/projects` — return all projects with their current git status (calls `statusAll` in the background, caches for 10 seconds to avoid hammering git).
   - `GET /api/projects/:name` — return single project config + status.
   - `GET /api/projects/:name/status` — return fresh git status (no cache).
   - Use Hono's `c.json()` for responses.

4. **Implement `routes/git.ts`**
   - `POST /api/git/fetch` — body: `{ projects?: string[] }`. If projects not specified, fetch all. Call `bulkGitService.fetchAll()`. Return results array. Progress streams via SSE.
   - `POST /api/git/pull` — same pattern as fetch but calls `pullAll()`.
   - `POST /api/git/push/:project` — call `gitPush()` for the named project. Return result.
   - `GET /api/git/worktrees/:project` — call `listWorktrees()`, return array.
   - `POST /api/git/worktrees/:project` — body: `WorktreeAddOptions`. Call `addWorktree()`. Return new worktree.
   - `DELETE /api/git/worktrees/:project` — body: `{ path: string }`. Call `removeWorktree()`.
   - `GET /api/git/branches/:project` — call `listBranches()`, return array.
   - `POST /api/git/branches/:project/update` — body: `{ branch?: string }`. If branch specified, update that branch. If not, update all branches. Return results.

5. **Implement `routes/build.ts`**
   - `POST /api/build/:project` — resolve project from config, call `buildService.build()`. Build output streams via SSE. Return `BuildResult` when complete.
   - Validate that the project exists in config. Return 404 if not found.

6. **Implement `routes/processes.ts`**
   - `GET /api/processes` — return `runService.getAllProcesses()`.
   - `POST /api/run/:project` — call `runService.start()`. Return `RunningProcess`.
   - `DELETE /api/run/:project` — call `runService.stop()`. Return 204.
   - `POST /api/run/:project/restart` — call `runService.restart()`. Return updated `RunningProcess`.
   - `GET /api/run/:project/logs` — query param `lines` (default 100). Call `runService.getLogs()`. Return `ProcessLogEntry[]`.

7. **Implement `routes/events.ts`**
   - `GET /api/events` — SSE endpoint.
   - Use Hono's `streamSSE()` helper:
     ```typescript
     app.get("/api/events", async (c) => {
       return streamSSE(c, async (stream) => {
         const client = {
           send: (event: SSEEvent) =>
             stream.writeSSE({
               data: JSON.stringify(event),
               event: event.type,
             }),
         };
         ctx.sseClients.add(client);
         // Heartbeat every 30 seconds to keep connection alive
         const heartbeat = setInterval(() => {
           client.send({ type: "heartbeat", data: { timestamp: Date.now() } });
         }, 30000);
         // Clean up on disconnect
         stream.onAbort(() => {
           clearInterval(heartbeat);
           ctx.sseClients.delete(client);
         });
         // Keep stream open
         await new Promise(() => {});
       });
     });
     ```
   - In `createServerContext()`, wire emitters to broadcast:
     ```typescript
     bulkGitService.emitter.on("progress", (event) => {
       broadcast({ type: "git:progress", data: event });
     });
     buildService.emitter.on("*", (event) => {
       broadcast({ type: "build:progress", data: event });
     });
     runService.emitter.on("*", (event) => {
       broadcast({ type: "process:event", data: event });
     });
     ```

8. **Implement `app.ts`**
   - Create Hono app instance.
   - Apply error handler middleware.
   - Mount all route groups under `/api`.
   - Add static file serving for `/*` — serve from `@dev-hub/web/dist` directory.
     - Use `@hono/node-server/serve-static` or `hono/serve-static`.
     - Resolve the path to the web package's dist directory relative to `node_modules/@dev-hub/web/dist` or via a build-time embed.
     - SPA fallback: return `index.html` for any non-API, non-file route.
   - Export the app and its type for Hono RPC: `export type AppType = typeof app;`

9. **Implement `index.ts`**
   - Parse CLI args for port (default 4800) and config path.
   - Call `createServerContext()`.
   - Create Hono app with context.
   - Start with `@hono/node-server`: `serve({ fetch: app.fetch, port })`.
   - Register `process.on("SIGINT")` and `process.on("SIGTERM")` to call `runService.stopAll()` before exit.
   - Log: "Dev-Hub server running on http://localhost:{port}".
   - Export `startServer(options: { port?: number; configPath?: string })` function for programmatic use by CLI.

10. **Export Hono RPC client type**
    - In `app.ts`, chain all routes on a single Hono instance so the type is complete.
    - Export `type AppType = typeof routes;` where `routes` is the chained result.
    - The web package will import this type and use `hc<AppType>(baseURL)` for a fully typed client.

11. **Write tests**
    - Test each route group with Hono's `app.request()` test helper (no real HTTP server needed).
    - Test workspace routes return correct config.
    - Test git routes validate project names.
    - Test process routes handle start/stop lifecycle.
    - Test SSE endpoint connects and receives heartbeat.
    - Test error handler maps GitError to correct HTTP status.

## Todo List

- [ ] Implement server context factory with all core service instances
- [ ] Implement error handler middleware with error-to-status mapping
- [ ] Implement workspace routes (GET config, projects, project status)
- [ ] Implement git routes (fetch, pull, push, worktrees, branches)
- [ ] Implement build route with SSE streaming
- [ ] Implement process management routes (start, stop, restart, logs)
- [ ] Implement SSE endpoint with heartbeat and event broadcasting
- [ ] Implement static file serving with SPA fallback
- [ ] Wire up app.ts with all route groups and middleware
- [ ] Implement server entry point with graceful shutdown
- [ ] Export Hono RPC AppType for web package consumption
- [ ] Write route tests using Hono test helper
- [ ] Write SSE connection test
- [ ] Verify `pnpm build` passes

## Success Criteria

1. `GET /api/projects` returns the project list with status information.
2. `POST /api/git/fetch` triggers a bulk fetch and returns results; progress events appear on the SSE stream.
3. `POST /api/build/api-server` triggers a build; output lines stream via SSE; the response contains the final BuildResult.
4. `POST /api/run/web-app` starts the process; `GET /api/processes` shows it running; `DELETE /api/run/web-app` stops it.
5. `GET /api/events` establishes an SSE connection that receives heartbeats and operation events.
6. `GET /` serves the web dashboard's `index.html`.
7. The exported `AppType` enables fully typed Hono RPC client in the web package.
8. Server shuts down gracefully: stops all running processes on SIGINT/SIGTERM.

## Risk Assessment

| Risk                                                           | Likelihood | Impact | Mitigation                                                                                                                                                      |
| -------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-running git/build operations block the response           | High       | High   | Return immediately with an operation ID; stream results via SSE. Alternatively, use a simple approach: the response waits but SSE streams progress in parallel. |
| SSE connection drops silently                                  | Medium     | Medium | Client-side EventSource auto-reconnects. Server heartbeat detects stale connections.                                                                            |
| Static file path resolution differs between dev and production | Medium     | Medium | Use `import.meta.resolve` or `require.resolve` to find @dev-hub/web/dist at runtime                                                                             |
| Multiple concurrent builds on same project cause conflicts     | Low        | Medium | Reject build if one is already in progress for that project (409 Conflict)                                                                                      |

## Next Steps

The server API is consumed by:

- [Phase 07 — Web Dashboard](./phase-07-web-dashboard.md) — React app using Hono RPC client
