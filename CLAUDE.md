# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all packages in watch mode (parallel)
pnpm dev

# Lint (packages/ directory only)
pnpm lint

# Format with Prettier
pnpm format

# Run tests (from a specific package directory)
cd packages/core && pnpm test
cd packages/cli && pnpm test

# Watch mode tests
cd packages/core && pnpm test:watch

# Build a single package
cd packages/core && pnpm build
```

## Architecture

Dev-Hub is a monorepo managed with pnpm workspaces. Four packages:

- **`@dev-hub/core`** — All business logic: config parsing, project discovery, git ops, build/process management. No UI concerns. Other packages depend on this.
- **`@dev-hub/cli`** — Commander.js CLI with Ink-based terminal UI. Reads workspace config via `loadWorkspace()`, then calls core APIs.
- **`@dev-hub/server`** — Hono HTTP API on port 4800. Wraps core services as REST + SSE endpoints. Serves the pre-built web dashboard as static files.
- **`@dev-hub/web`** — React 19 dashboard (Vite + Tailwind v4). Communicates with the server via Hono RPC (type-safe client). Receives real-time events via SSE.

Data flow:
```
CLI: user → Commander → @dev-hub/core → git/execa
Web: browser → React → Hono RPC client → @dev-hub/server → @dev-hub/core → git/execa
                                              ↑
                                         SSE stream (real-time progress)
```

`dev-hub ui` starts the server and opens the browser — no separate process needed.

## Key Design Decisions

**Config format**: `dev-hub.toml` uses snake_case on disk (`build_command`, `run_command`, `env_file`) but core types use camelCase. The parser converts on read/write.

**Config discovery**: `findConfigFile()` walks up from CWD, stopping at the home directory. Never scans system directories.

**Progress events**: Git and build operations emit `GitProgressEvent` via EventEmitter3. The CLI renders these with Ink components; the server streams them as SSE. Both use the same emitter interface.

**Error handling**: Core uses custom error classes (`GitError`, `ConfigParseError`, `ConfigNotFoundError`) with cause chains for debugging. CLI commands call `process.exit(1)` on errors.

**Build presets**: Each project type has default build/run commands in `packages/core/src/config/presets.ts`. `getEffectiveCommand()` returns user-defined commands first, falling back to presets.

**Concurrency**: `BulkGitService` uses `p-limit` (default: 4 concurrent) for bulk operations across projects.

**Hono RPC**: The server exports a typed `AppType` so the web package can generate a type-safe client — no manual API typing needed.

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

All packages: `strict: true`, `target: ES2022`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`. Packages extend `tsconfig.base.json`. Built with tsup (ESM output only). The web package uses Vite directly.

## Testing

Tests use Vitest. Only `@dev-hub/core` and `@dev-hub/cli` have tests currently. Core tests cover config schema validation, TOML parsing, git operations (via integration tests against real git repos), and build presets. CLI tests cover command wiring, workspace loading, and formatting utilities.
