---
parent: plan.md
phase: 02
status: done
priority: P1
effort: 2h
depends_on: [phase-01]
---

# Phase 02: Build & Run Services — Multi-Process Support

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: Phase 01 (schema changes)
- Docs: [codebase-summary.md](../../docs/codebase-summary.md)

## Overview

Update BuildService and RunService to support multiple services per project. Each service runs as a separate process, enabling parallel frontend+backend dev servers.

## Key Insights

- BuildService currently calls `getEffectiveCommand(project, "build")` — single command
- RunService keys processes by `projectName` only — needs `projectName:serviceName`
- Progress events need `serviceName` field for UI disambiguation
- Custom commands (test, lint, etc.) need a new execution path

## Requirements

1. BuildService builds all services within a project (parallel or sequential)
2. RunService manages multiple concurrent processes per project
3. Progress events include service name
4. New `CommandService` for executing custom commands
5. Process keys changed to `projectName:serviceName` format

## Related Code Files

- `packages/core/src/build/build-service.ts` — BuildService class
- `packages/core/src/build/run-service.ts` — RunService class
- `packages/core/src/build/index.ts` — barrel exports
- `packages/core/src/config/presets.ts` — getProjectServices (from Phase 01)

## Implementation Steps

1. **Update BuildProgressEvent & RunProgressEvent types**
   - Add `serviceName?: string` field to both event types
   - Update event emission in build-service.ts and run-service.ts

2. **Update BuildService**
   - `build(project, workspaceRoot, serviceName?)`: build specific service or all
   - If no serviceName: build all services via `getProjectServices(project)`
   - Add `buildService(project, service, workspaceRoot)`: build single service
   - Emit events with serviceName included

3. **Update RunService**
   - Change process map key from `projectName` to `${projectName}:${serviceName}`
   - `start(project, workspaceRoot, serviceName?)`: start specific service
   - `startAll(project, workspaceRoot)`: start all services concurrently
   - `stop(projectName, serviceName?)`: stop specific or all services for project
   - `getProcesses(projectName?)`: filter by project
   - Update `RunningProcess` to include `serviceName` field

4. **Add custom command execution**
   - `executeCommand(project, commandName, workspaceRoot)`: lookup in project.commands, execute
   - Emit progress events with command name context

5. **Update tests**
   - build-service.test.ts: test multi-service build
   - run-service.test.ts: test multi-service run, stop specific service

## Todo

- [ ] Add serviceName to BuildProgressEvent and RunProgressEvent
- [ ] Update BuildService for multi-service builds
- [ ] Update RunService process map key and API
- [ ] Add RunningProcess.serviceName field
- [ ] Add custom command execution
- [ ] Update build-service.test.ts
- [ ] Update run-service.test.ts

## Success Criteria

- Can build individual services or all services within a project
- Can run multiple services concurrently (frontend + backend)
- Can stop individual services or all services for a project
- Can execute custom commands by name
- Progress events include service name for UI rendering
- All tests pass

## Risk Assessment

- **Concurrency**: Multiple services running in same directory — should be fine (separate processes)
- **Process cleanup**: Must ensure all services stop on project stop
