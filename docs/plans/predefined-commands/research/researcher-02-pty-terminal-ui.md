# Research: PTY Session Management & Terminal UI

## PtySessionManager (`packages/electron/src/main/pty/session-manager.ts`)

- `create(opts)`: Takes `id`, `command`, `cwd`, `env`, `cols`, `rows`, optional `project`
- Empty command → interactive shell mode; non-empty → `/bin/sh -c <command>`
- Session type derived from ID prefix: `build:`, `run:`, `custom:`, `shell:`, `terminal:`, `free:`
- Env passed directly from caller (pre-resolved by core)
- 256KB scrollback buffer per session

## Terminal IPC (`packages/electron/src/main/ipc/terminal.ts`)

- `TERMINAL_CREATE`: Looks up project, resolves env via `resolveEnv()`, resolves cwd, delegates to ptyManager
- Free terminals get safe env subset (PATH, HOME, SHELL, etc.)
- Project terminals get full resolved env from core

## TerminalTreeView (`packages/web/src/components/organisms/TerminalTreeView.tsx`)

- Hierarchical: Projects → Commands (build/run/custom) + Profiles + Free Terminals
- Play/stop buttons per command; "+" for new shells/free terminals
- `onLaunchTerminal(projectName, TreeCommand)` callback for command execution

## useTerminalTree Hook (`packages/web/src/hooks/useTerminalTree.ts`)

- `TreeCommand` type: `key`, `type`, `command`, `cwd?`, `sessionId`, `session?`, `sessions?`, `profileName?`
- Session ID patterns: `build:{project}`, `run:{project}`, `custom:{project}:{key}`, `terminal:{project}:{name}:*`
- Free terminals: `free:{unique}` prefix, separate section

## Command Execution Flow

1. User clicks play → `onLaunchTerminal(projectName, TreeCommand)`
2. Parent sends `TERMINAL_CREATE` IPC with session ID
3. Electron resolves project env → `ptyManager.create()`
4. PTY spawned, data streamed via IPC events
5. Web UI reflects session status

## Key Insight

Predefined commands need a new `type` in TreeCommand (e.g., `"predefined"`) and a new session ID prefix. Env loading already works via `resolveEnv()` — per-command env_file just needs an override mechanism.
