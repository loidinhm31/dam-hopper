# dev-hub

A web-based app for managing multi-project development environments. Manage git operations, builds, and running services across all your projects from a single React UI backed by a Rust server with interactive PTY terminals.

## Features

- **Workspace config** — Define projects once in `dev-hub.toml`, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Interactive terminals** — Full PTY terminals (xterm.js + portable-pty) per command — color, interactivity, scrollback
- **Git worktrees** — Create, list, and remove worktrees interactively
- **Workspace switching** — Switch between multiple workspace configs without restarting
- **Agent store** — Distribute Claude/Gemini agent configs (skills, commands, hooks) across projects via symlinks

## Requirements

- Rust 1.80+ (for server)
- Node.js 20+ + pnpm 9+ (for web app development only)

## Installation

### Build from source

```bash
git clone <repo>
cd dev-hub

# Build Rust server
cd server && cargo build --release

# Build web app
cd .. && pnpm install && pnpm build

# Run (web dist is served by the Rust server)
DEV_HUB_WORKSPACE=/path/to/workspace ./server/target/release/dev-hub-server
# Open http://localhost:4800 — token printed to terminal on startup
```

## Configuration

Create a `dev-hub.toml` in your workspace root:

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "api-server"
path = "./api-server"
type = "maven"
build_command = "mvn clean package -DskipTests"
run_command = "java -jar target/app.jar"
env_file = ".env"

[[projects]]
name = "web-app"
path = "./web-app"
type = "pnpm"
```

Supported project types: `maven`, `gradle`, `npm`, `pnpm`, `cargo`, `custom`.

Each type has built-in default build/run commands. Override with `build_command` / `run_command`.

## Development

```bash
# Install web dependencies
pnpm install

# Web dev mode (Vite HMR on http://localhost:5173)
pnpm dev

# Rust server (requires running Rust server separately)
cd server && cargo run -- --workspace /path/to/workspace

# Build everything
pnpm build        # web app
pnpm build:server # Rust release binary

# Run Rust tests (121 tests)
pnpm test
# or: cd server && cargo test

# Lint web
pnpm lint

# Format
pnpm format
```

## Repository Structure

```
server/        # Rust binary (Axum + Tokio) — all backend logic
  src/
    config/    # TOML parsing, workspace/project discovery
    pty/       # portable-pty session manager
    git/       # git2-based git operations
    agent_store/ # symlink-based agent config distribution
    api/       # Axum REST routes + WebSocket handler
packages/
  web/         # @dev-hub/web — React 19 SPA (Vite + Tailwind v4)
```
