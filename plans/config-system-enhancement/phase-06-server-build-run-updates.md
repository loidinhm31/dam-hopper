---
parent: plan.md
phase: 06
status: done
priority: P2
effort: 1h
depends_on: [phase-02, phase-04]
---

# Phase 06: Server Build/Run Route Updates

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: Phase 02 (core build/run changes), Phase 04 (server config API)

## Overview

Update server build and process routes to support service-level operations. Add custom command execution endpoint.

## Related Code Files

- `packages/server/src/routes/build.ts` — build endpoint
- `packages/server/src/routes/processes.ts` — process management endpoints

## Implementation Steps

1. **Update build routes**
   - `POST /api/build/:project` — add optional `service` body param
   - If service specified: build that service only
   - If no service: build all services
   - Track in-progress per `project:service` key

2. **Update process routes**
   - `POST /api/run/:project` — add optional `service` body param
   - `GET /api/processes` — return service name in response
   - `DELETE /api/run/:project` — add optional `service` query param
   - Support starting/stopping individual services

3. **Add custom command endpoint**
   - `POST /api/exec/:project` — body: `{ command: string }`
   - Looks up command in project.commands
   - Returns execution result

4. **Update tests**

## Todo

- [x] Update build routes for service support
- [x] Update process routes for service support
- [x] Add exec endpoint
- [x] Update server tests

## Success Criteria

- Can build specific service via API
- Can run/stop specific service via API
- Can execute custom commands via API
- All tests pass
