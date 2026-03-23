---
parent: plan.md
phase: "03"
status: done
priority: P1
effort: 3h
depends_on: ["01", "02"]
---

# Phase 03: PTY Terminal Integration

## Context

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-electron-shell.md), [Phase 02](./phase-02-ipc-api-layer.md)

## Overview

Replace the current execa-based command execution with node-pty PTY sessions. Add xterm.js terminal panels in the web UI. All command types (build, run, custom) execute in full interactive terminals with colors, cursor movement, and stdin support.

## Key Insights

- node-pty spawns real PTY processes — full terminal emulation (ANSI colors, cursor, signals)
- xterm.js renders the terminal in the browser/renderer with `@xterm/addon-fit` for auto-resize
- Session registry pattern: `Map<string, IPty>` in main process, keyed by unique ID
- Each command card in UnifiedCommandPanel gets its own terminal panel
- **Strip execa execution from core**: `BuildService`, `RunService`, `CommandService` lose their execa-based execute/spawn methods. Core becomes pure config+state+git. PTY session manager in Electron owns all process execution.
- Process logs no longer need polling — PTY streams output directly via IPC

## Requirements

### 1. PTY Session Manager (Main Process)

```typescript
// packages/electron/src/pty/session-manager.ts
class PtySessionManager {
  private sessions: Map<string, IPty>;

  create(
    id: string,
    opts: {
      command: string;
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
    },
  ): void;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string, signal?: string): void;
  isAlive(id: string): boolean;
  getAll(): string[];
  dispose(): void; // kill all on shutdown
}
```

### 2. PTY IPC Handlers

```
terminal:create   → spawn PTY, register session, start data forwarding
terminal:write    → write stdin to PTY
terminal:resize   → resize PTY dimensions
terminal:kill     → kill PTY process (SIGTERM → SIGKILL fallback)
terminal:list     → list active session IDs
```

PTY output forwarded as: `terminal:data:${id}` events to renderer.
PTY exit forwarded as: `terminal:exit:${id}` events.

### 3. Preload Terminal API

```typescript
window.devhub.terminal = {
  create: (opts) => ipcRenderer.invoke("terminal:create", opts),
  write: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
  resize: (id, cols, rows) =>
    ipcRenderer.send("terminal:resize", { id, cols, rows }),
  kill: (id) => ipcRenderer.send("terminal:kill", { id }),
  onData: (id, cb) => {
    /* ipcRenderer.on listener, returns unsubscribe */
  },
  onExit: (id, cb) => {
    /* ipcRenderer.once listener */
  },
};
```

### 4. xterm.js Terminal Component

New: `packages/web/src/components/organisms/TerminalPanel.tsx`

```tsx
interface TerminalPanelProps {
  sessionId: string;
  cwd: string;
  command?: string; // auto-execute on mount
  onExit?: (code: number) => void;
  className?: string;
}
```

Features:

- Mount: create xterm.js Terminal + FitAddon, open in container div
- Auto-create PTY session via `window.devhub.terminal.create()`
- Stream data: `onData` → `term.write()`
- User input: `term.onData()` → `terminal.write()`
- Resize: `ResizeObserver` → `fitAddon.fit()` → `terminal.resize()`
- Cleanup: kill PTY + dispose terminal on unmount
- Theme: match dark theme from existing Tailwind config

### 5. Update UnifiedCommandPanel

Replace current output panels with `TerminalPanel`:

**Build card:**

- Before: `<BuildLog>` (SSE streaming) + result badge
- After: `<TerminalPanel command={buildCommand} />` + result badge on exit

**Run card:**

- Before: process logs polling + start/stop/restart
- After: `<TerminalPanel>` for active process + start/stop/restart
- Stop/restart kills PTY session and optionally creates new one

**Custom command cards:**

- Before: `useExecCommand()` → POST /exec → BuildResult display
- After: `<TerminalPanel command={customCommand} />` with result on exit

### 6. Session Lifecycle for Each Command Type

| Type   | On Action       | PTY Behavior                                                                    |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| Build  | Click "Build"   | Spawn PTY with build command. Auto-close session on exit. Show exit code badge. |
| Run    | Click "Start"   | Spawn PTY with run command. Keep alive until "Stop".                            |
| Run    | Click "Stop"    | Send SIGTERM to PTY. 5s timeout → SIGKILL.                                      |
| Run    | Click "Restart" | Stop → recreate PTY with same command.                                          |
| Custom | Click "Run"     | Spawn PTY with custom command. Auto-close on exit. Show result.                 |

### 7. Concurrent Terminals

- Multiple terminals can run simultaneously (Map registry handles this)
- Each expanded command card creates its own PTY session
- Collapsing a panel does NOT kill the PTY — output buffers
- Re-expanding reconnects to the same session's output stream

## Architecture

```
UnifiedCommandPanel
├── BuildCard
│   └── TerminalPanel(sessionId="build:projectName", command=buildCmd)
├── RunCard
│   └── TerminalPanel(sessionId="run:projectName", command=runCmd)
├── CustomCard × N
│   └── TerminalPanel(sessionId="custom:projectName:cmdKey", command=cmdValue)

Main Process:
PtySessionManager
├── "build:api-server" → IPty (cols=80, rows=24)
├── "run:api-server" → IPty (long-lived)
└── "custom:api-server:lint" → IPty (short-lived)
```

### 8. Strip Execution from Core

Remove execa-based execution from core services:

- **`BuildService`**: Remove `_buildOneService()` execa spawn. Keep `getProjectServices()`, command resolution, `resolveEnv()`. Core provides config/command data; Electron PTY does execution.
- **`RunService`**: Remove `_startService()` execa spawn, process tracking Map, log buffering. PTY session manager tracks running processes instead.
- **`CommandService`**: Remove `execute()` execa spawn. Core resolves command name → shell string; Electron PTY executes it.
- Keep: `resolveEnv()`, `getEffectiveCommand()`, config types, EventEmitter interfaces (PTY manager can reuse event types).
- Remove: `execa` dependency from core (if no other usage), `pipeLines`, `LogBuffer` (PTY streams replace these).

## Related Code Files

| File                                                            | Role                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/web/src/components/organisms/UnifiedCommandPanel.tsx` | Add TerminalPanel integration                           |
| `packages/web/src/components/organisms/BuildLog.tsx`            | Will be replaced by TerminalPanel                       |
| `packages/core/src/build/build-service.ts`                      | Strip execa execution, keep command resolution          |
| `packages/core/src/build/run-service.ts`                        | Strip execa spawn, keep types/interfaces                |
| `packages/core/src/build/command-service.ts`                    | Strip execa execution, keep command lookup              |
| `packages/core/src/build/stream-utils.ts`                       | Remove (pipeLines no longer needed)                     |
| `packages/core/src/build/log-buffer.ts`                         | Remove (PTY handles output buffering)                   |
| `packages/web/src/api/queries.ts`                               | Hooks to simplify (useBuild, useProcessLogs → terminal) |

## Implementation Steps

1. Install `node-pty` in `packages/electron`, run `electron-rebuild`
2. Install `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` in `packages/web`
3. Create `PtySessionManager` class in `packages/electron/src/main/pty/`
4. Create PTY IPC handlers (`terminal:create/write/resize/kill`)
5. Add terminal methods to preload contextBridge
6. Create `TerminalPanel.tsx` component in web package
7. Update `UnifiedCommandPanel.tsx` — replace BuildLog/logs with TerminalPanel
8. Update command card actions to create/kill PTY sessions
9. Handle session reconnection on panel collapse/expand
10. Add xterm.js CSS import and dark theme configuration
11. **Strip execa execution from core**: refactor BuildService, RunService, CommandService
12. **Remove core dead code**: stream-utils.ts, log-buffer.ts, execa dependency (if unused)
13. Test: build command in terminal with ANSI colors
14. Test: run command with start/stop/restart lifecycle
15. Test: custom command execution in terminal
16. Test: multiple concurrent terminals

## Todo

- [ ] Install node-pty + electron-rebuild
- [ ] Install xterm.js packages in web
- [ ] Create PtySessionManager
- [ ] Create PTY IPC handlers
- [ ] Add terminal API to preload
- [ ] Create TerminalPanel component
- [ ] Integrate into UnifiedCommandPanel (build card)
- [ ] Integrate into UnifiedCommandPanel (run card)
- [ ] Integrate into UnifiedCommandPanel (custom cards)
- [ ] Handle session lifecycle (collapse/expand/reconnect)
- [ ] Dark theme for xterm.js
- [ ] Strip execa execution from BuildService/RunService/CommandService
- [ ] Remove dead code from core (stream-utils, log-buffer)
- [ ] Test concurrent terminals

## Success Criteria

- Build command runs in xterm.js with full ANSI color support
- Run command shows live output, supports start/stop/restart
- Custom commands execute in terminal with stdin support
- Multiple terminals run concurrently
- Terminal auto-resizes with panel
- Interactive programs (if any) accept keyboard input
- No TypeScript errors

## Risk Assessment

- **Medium**: node-pty native compilation can be tricky across platforms
- `electron-rebuild` must match exact Electron version
- xterm.js performance with high-throughput output (e.g., npm install) — use `@xterm/addon-webgl` if needed
- Session reconnection on collapse/expand needs careful buffer management

## Security Considerations

- PTY spawns commands from user's `dev-hub.toml` — trusted input (same as current)
- PTY inherits CWD from project config, not arbitrary paths
- Environment variables resolved through `resolveEnv()` (same as current)
- No shell injection risk — commands are single strings passed to PTY shell
