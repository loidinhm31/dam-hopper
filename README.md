# dev-hub

A workspace management tool for multi-project development environments. Manage git operations, builds, and running services across all your projects from a single CLI or web dashboard.

## Features

- **Workspace config** — Define projects once in `dev-hub.toml`, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Process management** — Start long-running dev servers, stream logs, stop gracefully
- **Web dashboard** — `dev-hub ui` opens a local React dashboard for visual project management
- **Git worktrees** — Create, list, and remove worktrees interactively

## Requirements

- Node.js 20+
- pnpm 9+

## Installation

```bash
# From repo root
pnpm install
pnpm build

# Link CLI globally (optional)
cd packages/cli && npm link
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

Each type has built-in default build/run commands. Override them with `build_command` / `run_command` / `dev_command`.

## CLI Usage

```bash
# Initialize a new workspace config interactively
dev-hub init

# Show git status for all projects
dev-hub status

# Git operations (bulk by default)
dev-hub git fetch
dev-hub git pull
dev-hub git push <project>

# Branch and worktree management
dev-hub git branch list
dev-hub git branch update
dev-hub git worktree list
dev-hub git worktree add
dev-hub git worktree remove

# Build
dev-hub build               # build all projects
dev-hub build <project>     # build single project

# Run processes
dev-hub run start <project>
dev-hub run stop <project>
dev-hub run logs <project>

# Open web dashboard
dev-hub ui
```

Config file is discovered by walking up from the current directory, stopping at the home directory.

## Web Dashboard

`dev-hub ui` starts the local API server on port **4800** and opens the dashboard in your browser. The dashboard communicates with the server over HTTP + SSE for real-time progress streaming.

## Development

```bash
pnpm install        # install all dependencies
pnpm dev            # watch mode for all packages
pnpm build          # build all packages
pnpm lint           # lint packages/
pnpm format         # format with Prettier

# Run tests
cd packages/core && pnpm test
cd packages/cli && pnpm test
```

## Monorepo Structure

```
packages/
  core/     # @dev-hub/core — shared logic (config, git, build)
  cli/      # @dev-hub/cli  — CLI entry point
  server/   # @dev-hub/server — HTTP API (Hono, port 4800)
  web/      # @dev-hub/web  — React dashboard (Vite + Tailwind)
```
