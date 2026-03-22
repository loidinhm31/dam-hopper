---
parent: plan.md
phase: 04
status: done
priority: P1
effort: 1.5h
depends_on: [phase-01]
---

# Phase 04: Server Config API — CRUD Routes

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: Phase 01 (schema changes)
- Can run in parallel with Phase 02 and 03

## Overview

Add server routes for reading and updating the workspace config via HTTP. Expose `writeConfig()` (already in core) through REST endpoints.

## Key Insights

- `writeConfig()` in parser.ts already does atomic writes (temp + rename)
- Server has `ctx.config` (read at startup) and `ctx.configPath` for the file path
- Need to reload config in-memory after writes
- Must validate before writing (reuse Zod schemas)

## Related Code Files

- `packages/server/src/routes/config.ts` — NEW file
- `packages/server/src/app.ts` — mount new routes
- `packages/server/src/services/context.ts` — ServerContext (needs configPath)
- `packages/server/src/index.ts` — startServer (passes config path)
- `packages/core/src/config/parser.ts` — readConfig, writeConfig, validateConfig

## Implementation Steps

1. **Update ServerContext**
   - Add `configPath: string` field to context
   - Add `reloadConfig()` method that re-reads and validates config
   - Pass configPath from startServer()

2. **Create routes/config.ts**
   - `GET /api/config` — return full config (workspace + projects with services/commands)
   - `PUT /api/config` — receive full config, validate, write, reload
     - Validate with `DevHubConfigSchema`
     - Use `writeConfig()` for atomic save
     - Call `ctx.reloadConfig()` to update in-memory state
     - Broadcast `config:changed` SSE event
   - `PATCH /api/config/projects/:name` — update single project
     - Merge changes into existing project config
     - Validate full config after merge
     - Write and reload

3. **Mount in app.ts**
   - Import `createConfigRoutes`
   - Add `.route("/", configRoutes)` in route setup

4. **Add config:changed SSE event**
   - New event type in events system
   - Clients can listen to refresh UI on config change

5. **Update tests**
   - New `config.test.ts` for GET/PUT/PATCH endpoints
   - Test validation errors return 400
   - Test successful write + reload

## Todo

- [x] Add configPath to ServerContext
- [x] Create routes/config.ts with GET/PUT/PATCH
- [x] Mount config routes in app.ts
- [x] Add config:changed SSE event
- [x] Write config.test.ts tests

## Success Criteria

- GET /api/config returns full workspace config
- PUT /api/config validates, writes, and reloads
- PATCH /api/config/projects/:name updates single project
- Invalid config returns 400 with validation errors
- Config changes broadcast SSE event
- All tests pass

## Security Considerations

- Config writes modify filesystem — validate all input via Zod before writing
- Path traversal: project paths should be validated as relative paths within workspace
