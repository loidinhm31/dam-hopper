# Phase 04 — Core: Build & Run

## Context

- **Parent plan**: [plan.md](./plan.md)
- **Previous phase**: [phase-02-core-config.md](./phase-02-core-config.md)
- **Next phases**: [phase-05-cli.md](./phase-05-cli.md), [phase-06-server-api.md](./phase-06-server-api.md)
- **Depends on**: Phase 02 (ProjectConfig, presets, effective commands)
- **Parallel with**: [phase-03-core-git.md](./phase-03-core-git.md)

## Overview

- **Date**: 2026-03-21
- **Priority**: High
- **Status**: `pending`

Implement build execution and process management in `@dev-hub/core`. Build service runs one-shot build commands. Run service manages long-running processes (dev servers, API servers) with lifecycle control: start, stop, restart, log viewing. Output is streamed via EventEmitter for live consumption.

## Key Insights

- `execa` v9 is ESM-native, supports streaming stdout/stderr, and provides structured results (exit code, signal, duration).
- Long-running processes need to be tracked by PID and project name. A simple in-memory `Map<string, RunningProcess>` suffices since the server/CLI is the single manager.
- Env file loading uses `dotenv` parsing (just read the file and parse key=value lines) — the env vars are passed to `execa`'s `env` option, not loaded into the parent process.
- Build commands are one-shot (run to completion). Run commands are long-lived (stay running until stopped).
- The process manager must handle graceful shutdown: SIGTERM first, SIGKILL after timeout.

## Requirements

- Execute build commands for any project (using preset or override).
- Stream build stdout/stderr line-by-line via events.
- Return structured build result (success, exit code, duration, output summary).
- Start long-running processes with env file loading.
- Track running processes: list all, get status, get recent log lines.
- Stop processes gracefully (SIGTERM, wait, SIGKILL).
- Restart processes (stop + start).
- Capture rolling log buffer per process (last N lines in memory).
- All operations emit typed events for CLI and SSE consumption.

## Architecture

### Module Structure

```
packages/core/src/
  build/
    index.ts                      # re-exports
    types.ts                      # build/run types
    build-service.ts              # one-shot build execution
    run-service.ts                # long-running process management
    env-loader.ts                 # .env file parser
    log-buffer.ts                 # circular buffer for process logs
```

### Type Definitions

```typescript
// --- Build ---
interface BuildResult {
  projectName: string;
  command: string;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;                 // last 100 lines
  stderr: string;                 // last 100 lines
  error?: string;
}

interface BuildProgressEvent {
  projectName: string;
  phase: "started" | "output" | "completed" | "failed";
  stream?: "stdout" | "stderr";
  line?: string;                  // single line of output
  result?: BuildResult;
}

// --- Run ---
interface RunningProcess {
  projectName: string;
  command: string;
  pid: number;
  startedAt: Date;
  status: "running" | "stopped" | "crashed";
  exitCode?: number;
  restartCount: number;
}

interface ProcessLogEntry {
  timestamp: Date;
  stream: "stdout" | "stderr";
  line: string;
}

interface RunProgressEvent {
  projectName: string;
  phase: "started" | "output" | "stopped" | "crashed" | "restarted";
  stream?: "stdout" | "stderr";
  line?: string;
  process?: RunningProcess;
}
```

## Related Code Files

- `packages/core/src/build/*.ts` — all new
- `packages/core/src/config/presets.ts` — consumed for default commands (from Phase 02)
- `packages/core/src/index.ts` — update to re-export build module

## Implementation Steps

1. **Define types in `build/types.ts`**
   - All interfaces listed above.
   - Export `BuildResult`, `BuildProgressEvent`, `RunningProcess`, `ProcessLogEntry`, `RunProgressEvent`.

2. **Implement `build/env-loader.ts`**
   - `loadEnvFile(envFilePath: string): Promise<Record<string, string>>`
     - Read file, skip empty lines and comments (`#`).
     - Parse `KEY=VALUE` pairs, handle quoted values (single and double quotes).
     - Do NOT expand variable references (`$VAR`) — keep it simple.
     - Return plain object of key-value pairs.
   - `resolveEnv(project: ProjectConfig, workspaceRoot: string): Promise<Record<string, string>>`
     - If `project.envFile` is set, resolve path relative to project directory, load it.
     - Merge with `process.env` (env file values override).
     - Return merged env object.

3. **Implement `build/log-buffer.ts`**
   - `LogBuffer` class — circular buffer with configurable max size (default 1000 lines).
   - Methods:
     - `push(entry: ProcessLogEntry): void` — add line, evict oldest if at capacity.
     - `getAll(): ProcessLogEntry[]` — return all buffered lines in order.
     - `getLast(n: number): ProcessLogEntry[]` — return last N lines.
     - `clear(): void` — empty the buffer.
   - Implementation: array with head/tail pointers, or simply use an array and `slice(-maxSize)` for simplicity given 1000 is small.

4. **Implement `build/build-service.ts`**
   - `BuildService` class:
     ```typescript
     class BuildService {
       readonly emitter: EventEmitter3;

       async build(project: ProjectConfig, workspaceRoot: string): Promise<BuildResult>;
       async buildMultiple(projects: ProjectConfig[], workspaceRoot: string, concurrency?: number): Promise<BuildResult[]>;
     }
     ```
   - `build()` implementation:
     - Resolve the effective build command from `getEffectiveCommand(project, "build")`.
     - If command is empty, return error result immediately.
     - Resolve env using `resolveEnv()`.
     - Emit `"started"` event.
     - Execute with `execa` using `{ shell: true, cwd: project.path, env, stdout: "pipe", stderr: "pipe" }`.
     - Pipe stdout/stderr line by line: use `subprocess.stdout.on("data")`, split by newlines, emit `"output"` event for each line.
     - On completion: emit `"completed"` or `"failed"` event with `BuildResult`.
     - Capture last 100 lines of stdout/stderr in the result.
     - Measure duration with `performance.now()`.
   - `buildMultiple()`: use `p-limit` for concurrency control, delegate to `build()` for each.

5. **Implement `build/run-service.ts`**
   - `RunService` class — singleton process manager:
     ```typescript
     class RunService {
       private processes: Map<string, ManagedProcess>;
       readonly emitter: EventEmitter3;

       async start(project: ProjectConfig, workspaceRoot: string): Promise<RunningProcess>;
       async stop(projectName: string): Promise<void>;
       async restart(projectName: string): Promise<RunningProcess>;
       getProcess(projectName: string): RunningProcess | undefined;
       getAllProcesses(): RunningProcess[];
       getLogs(projectName: string, lines?: number): ProcessLogEntry[];
       async stopAll(): Promise<void>;
     }
     ```
   - Internal `ManagedProcess` type:
     ```typescript
     interface ManagedProcess {
       info: RunningProcess;
       subprocess: ExecaChildProcess;
       logs: LogBuffer;
       project: ProjectConfig;
       workspaceRoot: string;
     }
     ```
   - `start()` implementation:
     - Check if project already has a running process — if so, throw error (must stop first).
     - Resolve effective run command from `getEffectiveCommand(project, "run")`.
     - Resolve env using `resolveEnv()`.
     - Spawn with `execa` using `{ shell: true, cwd: project.path, env, stdout: "pipe", stderr: "pipe", detached: false }`.
     - Wire up stdout/stderr line streaming -> `LogBuffer` + event emission.
     - Handle process exit: update status to `"stopped"` or `"crashed"` (non-zero exit), emit event.
     - Store in `this.processes` map keyed by `projectName`.
   - `stop()` implementation:
     - Send `SIGTERM` to the subprocess.
     - Wait up to 5 seconds for exit.
     - If still running, send `SIGKILL`.
     - Remove from map.
     - Emit `"stopped"` event.
   - `restart()`: call `stop()`, then `start()` with same project config. Increment `restartCount`.
   - `stopAll()`: stop all managed processes (used on server shutdown / CLI exit).

6. **Implement `build/index.ts`**
   - Re-export all types, `BuildService`, `RunService`, `loadEnvFile`.

7. **Update `packages/core/src/index.ts`**
   - Add `export * from "./build/index.js";`

8. **Write unit tests**
   - Test `loadEnvFile`: basic key=value, quoted values, comments, empty lines.
   - Test `LogBuffer`: push, getAll, getLast, overflow behavior.
   - Test `BuildService.build()`: create a temp project with a simple build script (`echo "hello"`), verify result.
   - Test `RunService.start()/stop()`: start a long-running process (`sleep 60` or `node -e "setInterval(()=>{},1000)"`), verify PID is tracked, stop it, verify cleanup.
   - Test event emission: register listener, verify events fire in correct order.

## Todo List

- [ ] Define build/run types in `build/types.ts`
- [ ] Implement env file loader with quote handling
- [ ] Implement circular LogBuffer class
- [ ] Implement BuildService with line-by-line output streaming
- [ ] Implement RunService with full process lifecycle (start/stop/restart)
- [ ] Implement graceful shutdown (SIGTERM -> wait -> SIGKILL)
- [ ] Wire up EventEmitter for all operations
- [ ] Re-export from index files
- [ ] Write unit tests for env loader
- [ ] Write unit tests for LogBuffer
- [ ] Write integration tests for BuildService with real subprocess
- [ ] Write integration tests for RunService lifecycle
- [ ] Verify `pnpm build` passes

## Success Criteria

1. `BuildService.build()` executes a Maven/npm/cargo build command and streams output line by line.
2. Build result contains exit code, duration, and captured stdout/stderr.
3. `RunService.start()` launches a long-running process and tracks it by project name.
4. `RunService.getLogs()` returns the last N lines from the rolling buffer.
5. `RunService.stop()` gracefully terminates the process (SIGTERM, then SIGKILL after timeout).
6. `RunService.restart()` stops and restarts, incrementing restart count.
7. Process crash (non-zero exit) is detected and emitted as a `"crashed"` event.
8. Env file values are correctly loaded and passed to subprocesses.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Orphaned child processes on CLI crash | Medium | Medium | Use `detached: false` (default). Register process.on("exit") handler to kill children. |
| Shell command parsing issues (quotes, pipes) | Medium | Low | Use `shell: true` in execa, which delegates to the system shell |
| Large build output causes memory pressure | Low | Medium | LogBuffer caps at 1000 lines. BuildResult captures only last 100 lines. |
| Env file with export prefix (`export KEY=VAL`) | Medium | Low | Strip `export ` prefix in parser |

## Next Steps

Combined with Phase 03 (git), this completes the core library. Next:
- [Phase 05 — CLI](./phase-05-cli.md) — wraps BuildService/RunService with terminal UI
- [Phase 06 — Server API](./phase-06-server-api.md) — exposes build/run via REST + SSE
