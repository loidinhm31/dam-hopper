---
name: Core Config & Build System Research
description: Analysis of current config schema, build service, run service, and presets for services/commands support
type: research
---

## Current State

### Schema (schema.ts)

- `ProjectConfigSchema`: single `build_command`/`run_command` optional strings, transformed to camelCase
- `DevHubConfigSchema`: workspace + projects array with unique name constraint

### Build Service (build-service.ts)

- `BuildService.build(project, workspaceRoot)`: calls `getEffectiveCommand(project, "build")` — single command
- `BuildService.buildMultiple(projects, workspaceRoot, concurrency)`: parallel builds across projects
- Emits `BuildProgressEvent` with phases: started, output, completed, failed

### Run Service (run-service.ts)

- Processes keyed by `projectName` only: `Map<string, ManagedProcess>()`
- `RunService.start(project, workspaceRoot)`: calls `getEffectiveCommand(project, "run")` — single command
- Errors if project already running (one process per project name)
- Emits `RunProgressEvent` with phases: started, output, stopped, crashed, restarted

### Presets (presets.ts)

- `getEffectiveCommand(project, "build"|"run"|"dev")`: returns user-defined or preset command string
- Each `BuildPreset` has buildCommand, runCommand, optional devCommand

### CLI Commands

- `build.ts`: uses `service.build(p, workspaceRoot)` or `service.buildMultiple()`
- `run.tsx`: uses `service.start(p, workspaceRoot)`, keyed by project name

## Required Changes

| Component    | Change                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| Schema       | Add `services?: ServiceConfig[]` and `commands?: Record<string, string>` to project |
| Presets      | `getEffectiveCommand` must handle services; new `getEffectiveServices()`            |
| BuildService | Support building per-service; add serviceName to events                             |
| RunService   | Change key from projectName to `projectName:serviceName`; run multiple services     |
| CLI build    | Add `--service` flag; show service list if project has services                     |
| CLI run      | Support running specific or all services within a project                           |
