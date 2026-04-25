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
cd server && ./target/release/dam-hopper-server --workspace /path/to/workspace

# Get auth token after server started at least once:
cat ~/.config/dam-hopper/server-token

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
# On Windows (page file limit): use single job to avoid rlib mmap exhaustion
cd server && cargo test -j 1

# Run specific Rust test
cd server && cargo test test_name

# Full check
pnpm check
```

## Development Mode (No Auth)

**Phase 01: Server-Side Auth Bypass** enables local development without MongoDB. Start the server with `--no-auth` to bypass authentication entirely:

```bash
# Via npm script (recommended for dev:server)
npm run dev:server -- --no-auth --workspace /path/to/workspace

# Or directly via cargo
cd server && cargo run -- --no-auth --workspace /path/to/workspace

# Or via environment variable
DAM_HOPPER_NO_AUTH=1 cargo run -- --workspace /path/to/workspace
```

### Behavior

When `--no-auth` is enabled:
- ⚠️ Startup warning banner printed to stderr
- `/api/auth/login` returns a dev token immediately (no credentials required)
- `/api/auth/status` returns `{ authenticated: true, dev_mode: true, user: "dev-user" }`
- All protected routes accessible without authentication tokens
- Dev token: 30-day expiry, subject = `"dev-user"`

### Safety Features

Auth bypass **cannot be used in production** due to multiple failsafe mechanisms:

1. **MongoDB Configuration Check**: Fails if `MONGODB_URI` is set (prevents accidental database access)
2. **Environment Detection**: Fails if `RUST_ENV=production` or `ENVIRONMENT=production`
3. **Startup Warning**: Multi-line banner emphasizing dev-only usage
4. **ERROR-Level Logging**: `⚠️ NO-AUTH mode enabled — authentication bypassed`

The server exits immediately if both `--no-auth` and a production environment are detected, ensuring safe local-only usage.

**See** [Phase 01 Documentation](./docs/phase-01-server-auth-bypass/) for technical details, security considerations, and comprehensive test coverage.


## Architecture

DamHopper is a monorepo with two components:

- **`server/`** — Rust binary (Axum + Tokio). All business logic: config parsing, project discovery, git ops, PTY session management, tunnel session management, agent store distribution, memory templates, repo import. REST + WebSocket API. Serves the web SPA via `tower-http` static file serving.
- **`packages/web/`** (`@dam-hopper/web`) — React 19 SPA (Vite + Tailwind v4). Connects to the Rust server via `WsTransport`: `fetch(/api/*)` for REST, `WebSocket(/ws)` for terminal I/O + push events.
  - **Multi-server profiles** (Phase 2): Client-side profile management via localStorage. Switch between multiple server endpoints without page reload. Profiles stored as `{ id, name, url, authType, username, createdAt }`. Migration auto-converts legacy single-server config on first app load via `migrateToProfiles()` in `App.tsx`.

Data flow:

```
dam-hopper-server (Rust, Axum, port 4800)
├── config/ — TOML parsing, workspace discovery, global config
├── pty/ — portable-pty session manager (Map<uuid, PtySession>)
├── tunnel/ — TunnelSessionManager + CloudflaredDriver (Map<uuid, TunnelSession>)
├── port_forward/ — PortForwardManager: PTY stdout scan + /proc/net/tcp poll (Linux)
├── git/ — git2 + CLI fallback for operations
├── agent_store/ — symlink-based distribution of .claude/ items
├── api/ — Axum REST routes (/api/*) + WebSocket (/ws)
│   ├── tunnel.rs — POST/GET /api/tunnels, DELETE /api/tunnels/:id
│   └── port_forward.rs — GET /api/ports
└── tower-http::ServeDir serves packages/web/dist/

Browser
├── React 19 (packages/web/dist/, same build)
├── WsTransport → fetch(/api/*) + WebSocket(/ws)
│  └── WS envelope: {kind: "...", ...payload} (Phase 02+, no legacy {type:} support)
├── xterm.js terminal panels (per PTY session)
├── PortsPanel (combined) — detected ports + per-port tunnel actions + custom port form
└── TanStack Query (queries via WsTransport.invoke)
```


## Key Design Decisions

**Auth**: Bearer token in `Authorization` header. Token stored in `~/.config/dam-hopper/server-token`. Constant-time comparison via `subtle` crate. CORS configurable via `--cors-origins`.

**PTY execution**: All process execution happens in `portable-pty` sessions managed by `PtySessionManager`. Sessions identified by UUID. PTY output broadcast via `tokio::sync::broadcast` channel. Buffer retained for live sessions only.

**Config format**: `dam-hopper.toml` uses snake_case on disk (`build_command`, `run_command`, `env_file`). Serde handles field mapping. No migration needed from prior Node server.

**Workspace resolution**: Priority order:
1. `--workspace` CLI flag
2. `DAM_HOPPER_WORKSPACE` env var
3. Global config default path (`~/.config/dam-hopper/config.toml`)

**Agent store**: Distributes `.claude/` items (skills, commands, hooks, MCP servers, subagents) across projects via symlinks. Store at `.dam-hopper/agent-store/`. `ship()` creates symlinks, `unship()` removes them, `absorb()` copies project file into store. Health check detects broken symlinks. Distribution matrix tracks which projects have which items.

**Memory templates**: Handlebars templates in `.dam-hopper/agent-store/memory-templates/`. `renderTemplate` applies context; `applyTemplate` writes rendered output to project `.claude/CLAUDE.md`.

**Import from repo**: Shallow git clone into temp dir; scans `.claude/` items; user selects what to import into local store. URL validated by regex before clone.

**Error handling**: `thiserror` error types per module. API layer maps errors to HTTP status codes. Structured JSON error responses.

**Concurrency**: Tokio async throughout. PTY sessions use `Arc<RwLock<...>>`. Broadcast channels for fan-out to multiple WebSocket consumers.

**Tunnel sessions**: `TunnelSessionManager` in `AppState` manages in-memory `TunnelSession` entries (no disk persistence). Each session spawns a `cloudflared tunnel --url http://127.0.0.1:{port}` child process via `tokio::process::Command`. URL is parsed from child stdout via regex. WS push events (`tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`) are broadcast to all connected clients. On server shutdown, `dispose_all()` reaps all child processes — no orphaned `cloudflared` processes.



## Workspace Config (`dam-hopper.toml`)

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
restart = "on-failure"   # optional: never (default) | on-failure | always
restart_max_retries = 5  # optional: default 5; only written to TOML when non-default
health_check_url = "http://localhost:8080/health"  # optional: must be http:// or https://
```


## TypeScript (packages/web)

`strict: true`, `target: ES2022`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`. Built with Vite. Types in `src/api/client.ts` mirror Rust API shapes — duplication is intentional to keep web package independent.


## Testing

Rust tests: `cd server && cargo test` (121 tests). Integration tests use real temp filesystems and git repos via `tempfile` crate. No mocking of filesystem or git.

Web: no automated tests currently. Manual verification against running Rust server.
