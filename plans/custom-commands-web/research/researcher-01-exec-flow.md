# Research: Command Execution Flow

## CommandService.execute() (`packages/core/src/build/command-service.ts`)

- Resolves env via `resolveEnv()` from project config + workspace root
- Spawns subprocess: `execa(command, { shell: true, cwd, env, stdout/stderr: "pipe" })`
- Emits `BuildProgressEvent` phases: started → output (per line) → completed/failed
- Captures last 100 lines stdout/stderr in BuildResult
- Never throws; errors captured in result
- Looks up command from `project.commands[commandName]`

## BuildService (`packages/core/src/build/build-service.ts`)

- Uses `getProjectServices(project)` → resolves services with preset fallback
- `_buildOneService()`: identical execa pattern (shell:true, cwd, env, pipes)
- `buildAll()`: runs all services concurrently (Promise.all)
- `buildMultiple()`: p-limit (default 4) for cross-project
- Same BuildProgressEvent emission pattern

## RunService (`packages/core/src/build/run-service.ts`)

- Validates serviceName against project services
- Same execa pattern + process lifecycle management
- Internal `processes` Map keyed as `projectName:serviceName`
- Emits RunProgressEvent: started → output → stopped/crashed/restarted
- SIGTERM (5s) → SIGKILL fallback

## Types (`packages/core/src/build/types.ts`)

```typescript
BuildResult { projectName, serviceName?, command, success, exitCode, durationMs, stdout, stderr, error? }
BuildProgressEvent { projectName, serviceName?, phase, stream?, line?, result? }
RunningProcess { projectName, serviceName?, command, pid, startedAt, status, exitCode?, restartCount }
RunProgressEvent { projectName, serviceName?, phase, stream?, line?, process? }
```

## Server Routes

- `POST /exec/:project` (processes.ts): Takes `{ command: string }`, calls `commandService.execute()`, returns BuildResult
- `POST /build/:project` (build.ts): Takes `{ service?: string }`, tracks in-progress builds, returns BuildResult[]
- SSE events: `command:progress` streamed via server context emitter wiring

## Key Insight

- `/exec/:project` expects `command` = the **command name** (key in commands map), NOT the shell command string
- CommandService resolves key → shell command internally
- All three services (build/run/command) share same execa+env+event pattern
