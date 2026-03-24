# dev-hub

A desktop app for managing multi-project development environments. Manage git operations, builds, and running services across all your projects from a single Electron application with interactive PTY terminals.

## Features

- **Workspace config** — Define projects once in `dev-hub.toml`, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Interactive terminals** — Full PTY terminals (xterm.js + node-pty) per command — color, interactivity, scrollback
- **Git worktrees** — Create, list, and remove worktrees interactively
- **Workspace switching** — Switch between multiple workspace configs without restarting

## Requirements

- Node.js 20+
- pnpm 9+

## Installation

Download the latest release for your platform from the releases page:

- **Linux**: `Dev-Hub-*.AppImage` or `dev-hub_*_amd64.deb`
- **Windows**: `Dev-Hub-Setup-*.exe` (installer) or `Dev-Hub-*.exe` (portable)

### Build from source

```bash
git clone <repo>
cd dev-hub
pnpm install
pnpm build
pnpm package          # produces installers in packages/electron/release/
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

Each type has built-in default build/run commands. Override them with `build_command` / `run_command`.

On first launch, Dev Hub will prompt you to select your workspace directory. The last-used workspace is remembered across sessions.

## Development

```bash
pnpm install        # install all dependencies
pnpm dev            # core watch + Electron dev mode
pnpm build          # build all packages
pnpm lint           # lint packages/
pnpm format         # format with Prettier

# Run tests
cd packages/core && pnpm test

# Package for distribution
pnpm package:linux  # Linux: AppImage + deb
pnpm package:win    # Windows: nsis + portable
```

### First-time setup (Linux)

After `pnpm install`, two extra steps are required before running `pnpm dev:electron`:

**1. Download the Electron binary**

pnpm may skip the Electron post-install script. If you see `Error: Electron uninstall` when starting:

```bash
# Find your Electron version
ls node_modules/.pnpm | grep "^electron@"
# e.g. electron@34.5.8 — use that version below:
node node_modules/.pnpm/electron@34.5.8/node_modules/electron/install.js
```

**2. Rebuild native modules for Electron**

`node-pty` ships without Linux prebuilds and must be compiled against Electron's Node.js runtime. If you see `Failed to load native module: pty.node`:

```bash
# Use the same version found in step 1
npx @electron/rebuild -f -v 34.5.8 -m packages/electron
```

Requires standard build tools: `python3`, `make`, `g++` (install via your distro's `base-devel` / `build-essential` package).

> These steps only need to be repeated after `pnpm install` upgrades the Electron version.

## Monorepo Structure

```
packages/
  core/      # @dev-hub/core — shared logic (config, git, build context)
  electron/  # @dev-hub/electron — Electron main process + PTY + IPC
  web/       # @dev-hub/web — React renderer + xterm.js terminals
```
