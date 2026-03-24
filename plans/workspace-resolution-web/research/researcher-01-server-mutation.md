# Research: Server Context Mutation for Workspace Switching

## Context Capture Pattern

Routes capture `ctx` by **object reference** in closures (via `createApp(ctx)` → `createWorkspaceRoutes(ctx)` etc). Property reads like `ctx.config`, `ctx.workspaceRoot` happen on each request — not cached at route creation time. **Mutating ctx properties is immediately visible to all routes.**

## Service Emitter Wiring

Emitters are wired once during `createServerContext()` (lines 93-107). Each service's `.emitter.on("progress", ...)` callback calls `broadcast()`. The `broadcast` function is defined in the outer scope and iterates `sseClients` Set — it doesn't reference individual services. So:

- **Old emitters**: If services are replaced without removing listeners, old service emitters persist in memory with dangling listeners
- **New emitters**: New service instances have fresh emitters with no listeners
- **Fix**: Call `emitter.removeAllListeners()` on old services before replacing, then wire new services

## Per-Route State

| Route file     | State                      | Cleanup needed?                                                                |
| -------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `workspace.ts` | `statusCache` (10s TTL)    | Natural expiry; also cleared by `status:changed` broadcast wrapper             |
| `build.ts`     | `inProgressBuilds` Set     | Stale entries from old workspace; harmless (project names unlikely to collide) |
| `config.ts`    | `withLock` (promise chain) | Stateless — safe to keep                                                       |

## RunService Critical Constraint

`RunService.stopAll()` **MUST** be called before switch — it sends SIGTERM (5s timeout → SIGKILL) to all managed processes. Without this, orphaned OS processes leak.

Other services (BuildService, BulkGitService, CommandService) are stateless between operations — safe to replace without cleanup beyond removing emitter listeners.

## broadcast() Function Resilience

`broadcast()` is a closure over `sseClients` Set. It doesn't reference any service or config property. Since `sseClients` is never replaced (same Set instance throughout), broadcast continues to work after service/config swap.

## Recommended Approach

**Mutable context + service recreation** — add `switchWorkspace()` as a method on ServerContext:

1. `await ctx.runService.stopAll()`
2. Remove all listeners from old service emitters
3. Resolve new workspace path → findConfigFile → readConfig
4. Create new service instances
5. Wire new emitters to existing `broadcast`
6. Mutate `ctx.config`, `ctx.configPath`, `ctx.workspaceRoot`, and service properties
7. Broadcast `workspace:changed` SSE event

This avoids recreating the Hono app or HTTP server. All routes see new state on next request.

## SSE Event Type Extension

Current `SSEEvent` union in `context.ts` needs a new member:

```typescript
| { type: "workspace:changed"; data: { name: string; root: string } }
```
