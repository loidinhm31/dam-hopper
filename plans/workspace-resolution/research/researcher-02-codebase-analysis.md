# Codebase Analysis: Workspace Resolution Gaps

**Date:** 2026-03-22 | **Scope:** CLI + Server workspace loading code

---

## Current Architecture

```
CLI:    loadWorkspace(startDir?)  →  findConfigFile(cwd)  →  loadWorkspaceConfig(cwd)
Server: createServerContext(configPath?) → findConfigFile(process.cwd()) or direct file path
```

---

## Gap Inventory (Numbered by Severity)

### 1. No Env Var Support

Neither CLI nor server checks `DEV_HUB_WORKSPACE`. Users must pass `--workspace` every time or stay in the workspace dir.

### 2. `init` Command Ignores `--workspace`

`packages/cli/src/commands/init.ts` hardcodes `process.cwd()` — cannot init a workspace in a different directory. Misses the `optsWithGlobals()` call.

### 3. Global Flag Must Precede Subcommand

Commander.js constraint: `dev-hub --workspace /p status` ✓ but `dev-hub status --workspace /p` ✗.
No documentation warns users of this. No tests cover option ordering.

### 4. Server Has No Directory-Based Resolution

`createServerContext(configPath?)` only accepts a file path or walks from `process.cwd()`.
Cannot say "start server for workspace at `/path/to/dir`" — must know the exact `.toml` file path.

### 5. No Global Config File Support

No `~/.config/dev-hub/config.toml` fallback. Users with multiple workspaces have no way to set a default.

### 6. Redundant `findConfigFile()` Call in CLI

`loadWorkspace()` calls `findConfigFile()` (line ~22), then calls `loadWorkspaceConfig()` which internally calls `findConfigFile()` again. Minor perf issue; also means errors from the second call lack context.

### 7. No Central `GlobalOptions` Type

Every command manually types `cmd.optsWithGlobals<{ workspace?: string }>()`. Type drift risk if new global options added.

### 8. Error Messages Don't Reference `--workspace`

When `dev-hub.toml` not found, error says "Run `dev-hub init`" but doesn't mention `--workspace /path` as an alternative — confusing if user ran from wrong directory.

---

## File Inventory

| File                                      | Change Needed                                   |
| ----------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/utils/workspace.ts`     | Add env var check, improve error messages       |
| `packages/cli/src/index.ts`               | Global `--workspace` already added ✓            |
| `packages/cli/src/commands/init.ts`       | Add `optsWithGlobals()` + use workspace path    |
| `packages/cli/src/commands/status.ts`     | Already updated ✓                               |
| `packages/cli/src/commands/build.ts`      | Already updated ✓                               |
| `packages/cli/src/commands/run.tsx`       | Already updated ✓                               |
| `packages/cli/src/commands/exec.ts`       | Already updated ✓                               |
| `packages/cli/src/commands/git/*.ts`      | Already updated ✓                               |
| `packages/cli/src/utils/types.ts` (new)   | `GlobalOptions` type export                     |
| `packages/server/src/services/context.ts` | Add dir-based resolution + env var              |
| `packages/server/src/main.ts`             | Accept `--workspace` arg for dev:run            |
| `packages/core/src/config/discovery.ts`   | Potentially add `loadWorkspaceFromDir()` helper |

---

## Server-Side Concern (Critical)

When user runs `dev-hub ui` (starts the server), the server must serve the SAME workspace the CLI references. Currently:

- CLI finds workspace via walk-up or `--workspace`
- Server independently finds workspace via its own walk-up from CWD
- If started from different directory → **serves different workspace silently**

**Fix:** `dev-hub ui` command should pass workspace path to server via env var or `--workspace` arg.

---

## Commander.js `optsWithGlobals()` Mechanics

- Works correctly when `--workspace` precedes subcommand
- The `cmd` argument is the last parameter in any action callback:
  - No args: `action((opts, cmd) => ...)`
  - With args: `action((arg1, opts, cmd) => ...)`
- Current implementations are correct ✓

---

## Unresolved Questions

1. Should `DEV_HUB_WORKSPACE` accept both file paths AND directory paths?
2. Should global config (`~/.config/dev-hub/config.toml`) be in scope for this plan or a separate feature?
3. Should `dev-hub ui` auto-forward `--workspace` to the server process?
4. Should walk-up stop at `$HOME` or at filesystem root?
5. Windows compatibility: `%APPDATA%\dev-hub\config.toml` vs XDG path?
