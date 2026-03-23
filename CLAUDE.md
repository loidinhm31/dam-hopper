# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode (core watch + Electron dev)
pnpm dev

# Electron only (dev mode)
pnpm dev:electron

# Lint (packages/ directory only)
pnpm lint

# Format with Prettier
pnpm format

# Run tests
cd packages/core && pnpm test

# Watch mode tests
cd packages/core && pnpm test:watch

# Build a single package
cd packages/core && pnpm build
cd packages/electron && pnpm build

# Package the app (produces installers in packages/electron/release/)
pnpm package           # current platform
pnpm package:linux     # Linux: AppImage + deb
pnpm package:win       # Windows: nsis + portable
```

## Architecture

Dev-Hub is a monorepo managed with pnpm workspaces. Three packages:

- **`@dev-hub/core`** — All business logic: config parsing, project discovery, git ops, build context resolution. No UI concerns. Imported directly in the Electron main process.
- **`@dev-hub/electron`** — Electron main process + preload + PTY session manager. Imports `@dev-hub/core` directly. Exposes all functionality to the renderer via IPC (`contextBridge`). Built with `electron-vite`.
- **`@dev-hub/web`** — React 19 renderer (Vite + Tailwind v4). Bundled as Electron renderer. Communicates exclusively via `window.devhub` IPC bridge (no HTTP, no SSE). Uses xterm.js for interactive terminal panels.

Data flow:

```
Electron Main Process (Node.js)
├── @dev-hub/core (direct import — config, git, build context)
├── node-pty session manager (Map<id, IPty> — all process execution)
├── IPC handlers (terminal, config, git, workspace)
└── Window management (electron-store persists last workspace)

Electron Renderer (Chromium)
├── React 19 + Vite + Tailwind v4 (@dev-hub/web)
├── xterm.js terminal panels (per PTY session)
├── TanStack Query (queries via IPC invoke)
└── IPC bridge: window.devhub (contextBridge in preload)
```

## Key Design Decisions

**IPC-only**: No HTTP server, no SSE, no fetch. All renderer→main communication is via `window.devhub.*` (contextBridge). Events pushed from main via `webContents.send()`, received via `window.devhub.on()`.

**PTY execution**: All process execution (build, run, custom commands) happens in `node-pty` sessions managed by `PtySessionManager` in the Electron main process. Core services (`BuildService`, `RunService`, `CommandService`) resolve context (command, cwd, env) but do not execute — execution is delegated to the PTY layer.

**Config format**: `dev-hub.toml` uses snake_case on disk (`build_command`, `run_command`, `env_file`) but core types use camelCase. The parser converts on read/write.

**Workspace resolution**: Electron resolves workspace with the following priority:

1. Last-used path persisted in `electron-store` (userData)
2. `DEV_HUB_WORKSPACE` environment variable
3. First launch: shows folder picker dialog

Once determined, `findConfigFile()` walks up from that directory, stopping at the home directory. Falls back to `~/.config/dev-hub/config.toml` (XDG_CONFIG_HOME) for a default workspace path.

**Known workspaces**: Global config (`~/.config/dev-hub/config.toml`) maintains a list of known workspace names and paths. IPC handlers expose: `workspace.known`, `workspace.addKnown`, `workspace.removeKnown`, `workspace.switch`.

**Workspace switching**: IPC `workspace.switch` stops all running PTY sessions, loads a new workspace, persists path in electron-store, and broadcasts `workspace:changed` event to renderer.

**Progress events**: Git operations emit `GitProgressEvent` via EventEmitter3. The main process forwards these to the renderer via `webContents.send("git:progress", ...)`.

**Error handling**: Core uses custom error classes (`GitError`, `ConfigParseError`, `ConfigNotFoundError`) with cause chains. IPC handlers catch and serialize errors for the renderer.

**Build presets**: Each project type has default build/run commands in `packages/core/src/config/presets.ts`. `getEffectiveCommand()` returns user-defined commands first, falling back to presets.

**Concurrency**: `BulkGitService` uses `p-limit` (default: 4 concurrent) for bulk operations across projects.

**Global config**: Stored at `~/.config/dev-hub/config.toml` (respects XDG_CONFIG_HOME). Contains known workspaces list and default workspace path. Core module provides `readGlobalConfig()`, `writeGlobalConfig()`, and workspace helpers.

## Workspace Config (`dev-hub.toml`)

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "api-server"
path = "./api-server"
type = "maven"           # maven | gradle | npm | pnpm | cargo | custom
build_command = "..."    # overrides preset
run_command = "..."      # overrides preset
env_file = ".env"        # optional
tags = ["backend"]       # optional
```

## TypeScript

All packages: `strict: true`, `target: ES2022`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`. Packages extend `tsconfig.base.json`. Core and electron built with tsup/electron-vite (ESM output). Web package bundled by electron-vite as renderer.

## Testing

Tests use Vitest. Only `@dev-hub/core` has tests currently. Core tests cover config schema validation, TOML parsing, git operations (via integration tests against real git repos), build presets, and env loading.
