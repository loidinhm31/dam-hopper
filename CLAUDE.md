# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install web dependencies
pnpm install

# Build web app (packages/web)
pnpm build

# Web dev mode (Vite HMR)
pnpm dev

# Rust server: dev mode
pnpm dev:server
# Or directly:
cd server && cargo run -- --workspace /path/to/workspace --port 4800

# Rust server: watch mode (requires cargo-watch)
pnpm dev:server:watch
# Or directly:
cd server && cargo watch -x run

# Rust server: release build
pnpm build:server
# Or directly:
cd server && cargo build --release

# Run release server
cd server && ./target/release/dev-hub-server --workspace /path/to/workspace

# Get auth token after server started at least once:
cat ~/.config/dev-hub/server-token

# Regenerate auth token:
cd server && cargo run -- --new-token --workspace /path/to/workspace

# Lint (packages/web only)
pnpm lint

# Format with Prettier
pnpm format

# Run Rust tests
pnpm test
# Or directly:
cd server && cargo test

# Run specific Rust test
cd server && cargo test test_name

# Full check
pnpm check
```


## Architecture

Dev-Hub is a monorepo with two components:

- **`server/`** — Rust binary (Axum + Tokio). All business logic: config parsing, project discovery, git ops, PTY session management, agent store distribution, memory templates, repo import. REST + WebSocket API. Serves the web SPA via `tower-http` static file serving.
- **`packages/web/`** (`@dev-hub/web`) — React 19 SPA (Vite + Tailwind v4). Connects to the Rust server via `WsTransport`: `fetch(/api/*)` for REST, `WebSocket(/ws)` for terminal I/O + push events.

Data flow:

```
dev-hub-server (Rust, Axum, port 4800)
├── config/ — TOML parsing, workspace discovery, global config
├── pty/ — portable-pty session manager (Map<uuid, PtySession>)
├── git/ — git2 + CLI fallback for operations
├── agent_store/ — symlink-based distribution of .claude/ items
├── api/ — Axum REST routes (/api/*) + WebSocket (/ws)
└── tower-http::ServeDir serves packages/web/dist/

Browser
├── React 19 (packages/web/dist/, same build)
├── WsTransport → fetch(/api/*) + WebSocket(/ws)
├── xterm.js terminal panels (per PTY session)
└── TanStack Query (queries via WsTransport.invoke)
```


## Key Design Decisions

**Auth**: Bearer token in `Authorization` header. Token stored in `~/.config/dev-hub/server-token`. Constant-time comparison via `subtle` crate. CORS configurable via `--cors-origins`.

**PTY execution**: All process execution happens in `portable-pty` sessions managed by `PtySessionManager`. Sessions identified by UUID. PTY output broadcast via `tokio::sync::broadcast` channel. Buffer retained for live sessions only.

**Config format**: `dev-hub.toml` uses snake_case on disk (`build_command`, `run_command`, `env_file`). Serde handles field mapping. No migration needed from prior Node server.

**Workspace resolution**: Priority order:
1. `--workspace` CLI flag
2. `DEV_HUB_WORKSPACE` env var
3. Global config default path (`~/.config/dev-hub/config.toml`)

**Agent store**: Distributes `.claude/` items (skills, commands, hooks, MCP servers, subagents) across projects via symlinks. Store at `.dev-hub/agent-store/`. `ship()` creates symlinks, `unship()` removes them, `absorb()` copies project file into store. Health check detects broken symlinks. Distribution matrix tracks which projects have which items.

**Memory templates**: Handlebars templates in `.dev-hub/agent-store/memory-templates/`. `renderTemplate` applies context; `applyTemplate` writes rendered output to project `.claude/CLAUDE.md`.

**Import from repo**: Shallow git clone into temp dir; scans `.claude/` items; user selects what to import into local store. URL validated by regex before clone.

**Error handling**: `thiserror` error types per module. API layer maps errors to HTTP status codes. Structured JSON error responses.

**Concurrency**: Tokio async throughout. PTY sessions use `Arc<RwLock<...>>`. Broadcast channels for fan-out to multiple WebSocket consumers.


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


## TypeScript (packages/web)

`strict: true`, `target: ES2022`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`. Built with Vite. Types in `src/api/client.ts` mirror Rust API shapes — duplication is intentional to keep web package independent.


## Testing

Rust tests: `cd server && cargo test` (121 tests). Integration tests use real temp filesystems and git repos via `tempfile` crate. No mocking of filesystem or git.

Web: no automated tests currently. Manual verification against running Rust server.
