---
parent: plan.md
phase: 03
status: done
priority: P2
effort: 1.5h
depends_on: [phase-02]
---

# Phase 03: CLI Updates — Service-Aware Commands

## Context

- Parent: [plan.md](./plan.md)
- Dependencies: Phase 02 (build/run service changes)

## Overview

Update CLI build and run commands to support services and custom commands. Add `--service` flag, service selection, and `dev-hub exec` for custom commands.

## Related Code Files

- `packages/cli/src/commands/build.ts` — build command
- `packages/cli/src/commands/run.tsx` — run command (Ink component)
- `packages/cli/src/index.ts` — Commander program setup
- `packages/cli/src/commands/init.ts` — workspace init (update for services)

## Implementation Steps

1. **Update build command**
   - Add `--service <name>` option to build specific service
   - If project has services and no --service flag: build all services
   - Show service name in progress output

2. **Update run command**
   - Add `--service <name>` option
   - If project has services and no --service flag: start all services
   - Update Runner component to show service names in output
   - Handle stop: stop all services or specific one

3. **Add `exec` command**
   - `dev-hub exec <project> <command-name>` — run custom command
   - `dev-hub exec --list <project>` — list available custom commands
   - Streams output like build command

4. **Update init command**
   - During project setup, ask about services
   - Allow configuring custom commands

5. **Update tests**
   - CLI command tests for new flags and exec command

## Todo

- [x] Add --service flag to build command
- [x] Add --service flag to run command
- [x] Update Runner Ink component for multi-service display
- [x] Add exec command for custom commands
- [x] Update init command for services
- [x] Update CLI tests

## Success Criteria

- `dev-hub build my-app` builds all services
- `dev-hub build my-app --service frontend` builds specific service
- `dev-hub run my-app` starts all services concurrently
- `dev-hub exec my-app test` runs custom "test" command
- Service names visible in CLI output
