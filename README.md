# dam-hopper

A web-based app for managing multi-project development environments. Manage git operations, builds, and running services across all your projects from a single React UI backed by a Rust server with interactive PTY terminals.

## Features

- **Global project registry** — Define projects once in `~/.config/dam-hopper/dam-hopper.toml` or another registry file, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Interactive terminals** — Full PTY terminals (xterm.js + portable-pty) per command — color, interactivity, scrollback
- **Git worktrees** — Create, list, and remove worktrees interactively
- **Workspace switching** — Switch between multiple workspace configs without restarting
- **Multi-server profiles** — Profile-scoped URLs, credentials, and local metadata with native/web transport boundaries
- **Browser Debug** — Web iframe fallback and optional native child WebView (Windows v1; Linux runtime-unverified)
- **Agent store** — Distribute Claude/Gemini agent configs (skills, commands, hooks) across projects via symlinks

## Requirements

- Rust 1.97.1+ (server and native build toolchain; verify the pinned toolchain used by deployment)
- Node.js 20+ + pnpm 9+
- Android Studio + Android SDK/NDK + `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` (for Android builds only)

## Installation

### Quickstart: Linux Release Installer (Fedora 44 x86_64)

DamHopper releases are published as immutable, attested GitHub release bundles for Fedora 44 x86_64 systemd hosts. Target hosts do not require a compiler, Node.js, or Rust toolchain.

**Prerequisites:**
- Fedora 44 x86_64 (glibc >= 2.43, systemd >= 259)
- `curl`, `tar`, `sha256sum`, `sudo`
- Optional: `gh` CLI (for GitHub artifact attestation verification)

1. **Download the bootstrap installer:**
   ```bash
   curl -fsSLO https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.sh
   chmod +x dam-hopper-install.sh
   ```

2. **Stage a candidate release (unprivileged fetch + staged candidate):**
   ```bash
   # API server role (0.0.0.0:4801)
   ./dam-hopper-install.sh --latest --role server

   # Dedicated static web host role (0.0.0.0:4802)
   ./dam-hopper-install.sh --latest --role web

   # Both roles in lockstep
   ./dam-hopper-install.sh --latest --role both --allow-web-origin http://localhost:4802
   ```
   *Note:* The bootstrap installer stages candidate files, installs the CLI to `/usr/local/bin/dam-hopper`, and stops at `PENDING`. It never starts or activates services automatically.

3. **Inspect status:**
   ```bash
   dam-hopper status
   # Or JSON format:
   dam-hopper status --json
   ```

4. **Explicitly activate the release:**
   ```bash
   sudo dam-hopper start
   ```
   `start` installs concrete systemd units, reloads the daemon, starts configured units, and enforces a strict health gate (20s startup deadline + 20 consecutive 500ms probes / 10s stability window).

5. **Rollback & Recovery:**
   ```bash
   # Roll back to the recorded previous release
   sudo dam-hopper rollback

   # Reconcile crash or interrupted transaction
   sudo dam-hopper recover
   ```

For complete operator instructions, systemd unit definitions, security boundaries, and format-2 migration, see [Linux systemd guide](./docs/linux-systemd.md).

### Build from source (Contributors)

```bash
git clone https://github.com/loidinhm31/dam-hopper.git
cd dam-hopper

# Install dependencies and build web assets
pnpm install
pnpm build

# Build Rust release server
pnpm build:server

# Run the backend directly (default 0.0.0.0:4800)
./server/target/release/dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml
```
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

```text
server/        # Rust binary (Axum + Tokio) — all backend logic
apps/
  web/          # Thin Vite browser host
  native/       # Tauri desktop/Android host
packages/
  ui/           # Shared React UI and host adapter contract
  browser-bridge/ # v1 iframe/native DOM bridge
```
