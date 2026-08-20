# dam-hopper

A web-based app for managing multi-project development environments. Manage git operations, builds, and running services across all your projects from a single React UI backed by a Rust server with interactive PTY terminals.

## Features

- **Global project registry** — Define projects once in `~/.config/dam-hopper/dam-hopper.toml` or another registry file, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Interactive terminals** — Full PTY terminals (xterm.js + portable-pty) per command — color, interactivity, scrollback
- **Git worktrees** — Create, list, and remove worktrees interactively
- **Workspace switching** — Switch between multiple workspace configs without restarting
- **Multi-server profiles** — Manage multiple server connections (local dev, staging, production) with instant switching via UI profile selector
- **Agent store** — Distribute Claude/Gemini agent configs (skills, commands, hooks) across projects via symlinks

## Requirements

- Rust 1.80+ (for server and Tauri native builds)
- Node.js 20+ + pnpm 9+
- Android Studio + Android SDK/NDK + `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` (for Android builds only)

## Installation

### Build from source

```bash
git clone <repo>
cd dam-hopper

# Build Rust server
cd server && cargo build --release

# Build web app
cd .. && pnpm install && pnpm build

# Run (web dist is served by the Rust server)
./server/target/release/dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml
# Or omit --config to use the default global registry path
# Direct/legacy default: http://127.0.0.1:4800 — token printed to terminal
```

### Linux systemd production service

Linux production ownership is systemd on `127.0.0.1:4801`; the service runs as
`loidinh` and is the only supported production owner. The guarded reset is an
administrator-approved operation that must receive a user-owned dotenv source
outside the runtime purge target:

```bash
pnpm linux:reset -- --env-file /secure/path/production-settings
```

Build and stage without privilege, then install and start as separate explicit
operations. Capture the `staging_dir` printed by `build`:

```bash
pnpm linux:production -- build
pnpm linux:production -- install --staging /tmp/dam-hopper-production-stage.XXXXXX
pnpm linux:production -- status
pnpm linux:production -- start
```

`install` never starts or rebuilds. `start` validates the installed marker,
private runtime environment files, unit contract, ownership, ports, processes,
and database holders before starting. Use `rollback --dry-run` first; an actual
rollback requires the marker-backed confirmation and preserves user runtime
state. See [Linux systemd setup](./docs/linux-systemd.md).

## Configuration

Create `~/.config/dam-hopper/dam-hopper.toml`:

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

Project paths may be absolute or relative. Relative paths resolve against the registry file directory, so repo-local registries still work when you pass `--config /path/to/repo/dam-hopper.toml`.

For manual end-to-end validation of multi-root registries and escape rejection, see [docs/configuration-guide.md](docs/configuration-guide.md#manual-smoke-checklist).

## Development

```bash
# Install web dependencies
pnpm install

# Web dev mode (Vite HMR on http://localhost:5173)
pnpm dev

# Desktop Tauri shell (Vite on http://localhost:1420)
pnpm dev:native

# One-time Android scaffold refresh for the native app
pnpm android:init

# Android emulator / device dev
pnpm android:dev

# Android release artifacts (APK + AAB)
pnpm android:build

# Rust server for the Vite dev proxy (isolated loopback port 4801)
pnpm dev:server
# Or directly:
cd server && cargo run -- --config /path/to/dam-hopper.toml --host 127.0.0.1 --port 4801

# Build everything
pnpm build        # web app
pnpm build:native # desktop native host assets
pnpm build:server # Rust release binary

# Run Rust tests (121 tests)
pnpm test
# or: cd server && cargo test

# Lint web
pnpm lint

# Format
pnpm format
```

The generated Android Studio project lives in `apps/native/src-tauri/gen/android`. Tauri now runs the native package's local `npm run dev` / `npm run build` hooks, so Android Studio and Gradle do not depend on a globally installed `pnpm`.

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
  web/         # @dam-hopper/web — React 19 SPA (Vite + Tailwind v4)
```
