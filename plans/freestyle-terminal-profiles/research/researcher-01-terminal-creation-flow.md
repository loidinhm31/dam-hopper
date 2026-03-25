# Research: Terminal Session Creation Flow

## Key Findings

### PTY Session Manager (`session-manager.ts`)
- `create(opts: PtyCreateOpts)` accepts `cwd` directly — no resolution logic
- `SessionMeta` does NOT store cwd (only id, project, command, type, alive, exitCode, startedAt)
- Session type derived from ID prefix: `build:`, `run:`, `custom:`, `shell:`

### IPC TERMINAL_CREATE Handler (`terminal.ts`)
- Accepts: `{ id, project, command, cols, rows }` — NO cwd parameter
- **cwd is HARDCODED to `project.path`** from workspace config
- No way to override cwd from renderer

### Shell Creation (TerminalsPage.tsx)
- ShellPromptState: `{ projectName, command }` — no cwd field
- Auto-saves to config via `config.updateProject(projectName, { commands: { "shell-${Date.now()}": command } })`
- No profile naming, no cwd persistence

### Terminal Tree (TerminalTreeView.tsx)
- TreeCommand: `{ key, type, command, sessionId, session? }` — no cwd metadata
- Commands populated from: build/run presets, project.commands, live shell sessions

## Changes Needed
1. IPC handler: accept optional `cwd` param, use it instead of project.path
2. SessionMeta: add `cwd` field for reconnection
3. Shell form: add cwd input field
4. Config: store profiles with cwd metadata (not just command string)
5. Tree view: display profile names and cwd info
