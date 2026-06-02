# Configuration Guide

## Workspace Configuration (dam-hopper.toml)

Create `dam-hopper.toml` in your workspace root.

### Basic Setup

```toml
[workspace]
name = "my-workspace"
```

### Project Discovery

Define projects with type-specific defaults:

```toml
[[projects]]
name = "api"
path = "./services/api"
type = "cargo"
build_command = "cargo build --release"
run_command = "./target/release/server"
env_file = ".env"
tags = ["backend", "critical"]

[[projects]]
name = "web"
path = "./apps/web"
type = "pnpm"
build_command = "pnpm build"
run_command = "pnpm dev"
tags = ["frontend"]

[[projects]]
name = "native"
path = "./apps/native"
type = "pnpm"
build_command = "pnpm tauri:build"
run_command = "pnpm tauri:dev"
tags = ["frontend", "native", "tauri"]

[[projects]]
name = "scripts"
path = "./scripts"
type = "custom"
build_command = "bash scripts/build.sh"
run_command = "bash scripts/run.sh"
```

### Project Fields

| Field         | Type   | Required | Notes                                             |
| ------------- | ------ | -------- | ------------------------------------------------- |
| name          | string | ✓        | Unique within workspace                           |
| path          | string | ✓        | Relative to workspace root                        |
| type          | enum   | ✓        | npm \| pnpm \| cargo \| maven \| gradle \| custom |
| build_command | string |          | Overrides preset for type                         |
| run_command   | string |          | Overrides preset for type                         |
| env_file      | string |          | Path to .env (relative to project)                |
| tags          | array  |          | Arbitrary tags for filtering                      |

### Project Type Presets

#### npm

- Build: `npm run build`
- Run: `npm start`
- Dev: `npm run dev`

#### pnpm

- Build: `pnpm build`
- Run: `pnpm start`
- Dev: `pnpm dev`

#### cargo

- Build: `cargo build --release`
- Run: `cargo run --release`
- Dev: `cargo run`

#### maven

- Build: `mvn clean package`
- Run: `java -jar target/*.jar`
- Dev: `mvn spring-boot:run` (if Spring Boot)

#### gradle

- Build: `gradle build`
- Run: `gradle run`
- Dev: `gradle bootRun` (if Spring Boot)

#### custom

- Requires explicit build_command and run_command

### Terminal Environment Resolution

Project environment-file values are applied only when DamHopper creates a terminal session for that project. DamHopper does not pass its full server process environment through to PTY children.

Terminal env precedence is:

1. Safe baseline inherited from the host for basic shell execution, such as `PATH` and `HOME`
2. DamHopper default `TERM`
3. Project environment-file values
4. Explicit terminal request `env` overrides

If a project-level environment file sets `MONGODB_DATABASE=gleanOak` and the terminal create request includes `env.MONGODB_DATABASE=overrideDb`, the terminal child process sees `overrideDb`.

### Agent Store Configuration

Optional: configure where the agent store directory is located.

```toml
[agent_store]
path = ".dam-hopper/agent-store"
```

If omitted, defaults to `.dam-hopper/agent-store/` in workspace root.

### Feature Flags

All features are enabled by default.

### UI Configuration

The global UI config includes the terminal workspace shortcut used by `WorkspacePage` and terminal input guards.

| Field                     | Type   | Default                    | Notes |
| ------------------------- | ------ | -------------------------- | ----- |
| terminalWorkspaceShortcut  | string | `Mod+Shift+Backquote`      | Global IDE/Terminal mode toggle shortcut |
| terminalScrollButtonsEnabled | bool   | `false`                    | Show floating Page Up/Down buttons in terminal |

Example:

```toml
[ui]
terminalWorkspaceShortcut = "Mod+Shift+Backquote"
terminalScrollButtonsEnabled = false
```

The shortcut is normalized by the client config layer, and terminal panels treat it as a non-text global shortcut.

### Server Configuration

Optional: configure SQLite path and retention for terminal restart recovery. Session persistence is always enabled when the database can be opened.

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"  # Database file location
session_buffer_ttl_hours = 24  # TTL for dead session buffers in hours (default: 24)
```

**Fields:**

| Field                    | Type   | Default                          | Notes                                                                                  |
| ------------------------ | ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| session_db_path          | string | ~/.config/dam-hopper/sessions.db | SQLite database path (supports ~ expansion); must be on local filesystem               |
| session_buffer_ttl_hours | u64    | 24                               | Hours before dead session buffers are auto-deleted; prevents unbounded database growth |

**Security Note:** On Unix systems, database files are created with 0o600 permissions (user-only access). Ensure the directory containing `session_db_path` is not world-readable.

**Example:**

```toml
[server]
session_db_path = "~/.local/share/dam-hopper/sessions.db"
session_buffer_ttl_hours = 48
```

When the database opens successfully:

- Session metadata (id, project, command, cwd, restart_policy, etc.) is saved to SQLite
- Up to 1 MB of terminal scrollback is retained per session
- Any browser connected to the same server can resume live sessions
- On DamHopper server restart, sessions that were alive are relaunched and restored scrollback is replayed
- Exact shell/process memory continuity is not guaranteed across server or host restart
- Dead sessions are kept for 60 seconds to allow reconnection; buffers are cleaned up per TTL

## Global Configuration (~/.config/dam-hopper/config.toml)

Store global defaults:

```toml
[defaults]
workspace = "/home/user/projects/main-workspace"

[[workspaces]]
name = "prod"
path = "/home/user/prod-workspace"

[[workspaces]]
name = "sandbox"
path = "/tmp/test-workspace"
```

### Fields

**defaults.workspace** — Path to default workspace (fallback if no --workspace or DAM_HOPPER_WORKSPACE).

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var                    | Type   | Purpose                                                             |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `DAM_HOPPER_WORKSPACE` | path   | Override workspace path (takes priority over global config default) |
| `RUST_LOG`             | string | Logging level (e.g., `dam_hopper=debug,axum=info`)                  |

## Authentication Token

**Location:** `~/.config/dam-hopper/server-token`

**Permissions:** 0600 (read-only to user)

**Format:** Hex-encoded UUID (64 characters)

### Generate New Token

```bash
cd server && cargo run -- --new-token --workspace /path/to/workspace
```

Saves to `~/.config/dam-hopper/server-token`.

### Use Token

Include in all API requests:

```bash
curl -H "Authorization: Bearer $(cat ~/.config/dam-hopper/server-token)" \
  http://localhost:4800/api/projects
```

## Running the Server

### Development Mode

```bash
cd server
cargo run -- --workspace /path/to/workspace --port 4800
```

### With Logging

```bash
RUST_LOG=dam_hopper=debug cargo run -- --workspace /path/to/workspace
```

### Release Build

```bash
cargo build --release
./target/release/dam-hopper-server --workspace /path/to/workspace --port 4800
```

### Nohup Background Server

Build, install under `~/.config/dam-hopper/`, and restart:

```bash
pnpm build:server
pnpm server:restart
```

Edit `~/.config/dam-hopper/server.conf` to set:

- `DAM_HOPPER_WORKSPACE`
- `DAM_HOPPER_HOST`
- `DAM_HOPPER_PORT`
- `DAM_HOPPER_CORS_ORIGINS` (if needed)

Runtime files:

- Binary: `~/.config/dam-hopper/bin/dam-hopper-server`
- Log: `~/.config/dam-hopper/output.log`
- PID: `~/.config/dam-hopper/server.pid`

## Cross-Origin Resource Sharing (CORS)

If `--cors-origins` is omitted, the server mirrors the request `Origin` and
allows credentials. That keeps local browser and native development flexible,
but production deployments should usually pass an explicit allowlist.

Override with `--cors-origins`:

```bash
cargo run -- \
  --workspace /path/to/workspace \
  --cors-origins "https://example.com" \
  --cors-origins "http://localhost:3000"
```

For native Tauri clients, also allow the native dev and packaged webview origins
used by your target platform. Typical entries are:

```bash
cargo run -- \
  --workspace /path/to/workspace \
  --cors-origins "http://localhost:1420" \
  --cors-origins "tauri://localhost" \
  --cors-origins "http://tauri.localhost" \
  --cors-origins "https://tauri.localhost"
```

Use only the origins you actually ship. Native remains a remote client; it still
connects through saved server profiles and does not embed the DamHopper backend.

## SSH Key Management

SSH credentials are loaded on-demand via `/api/ssh/keys/load`:

```bash
curl -X POST \
  -H "Authorization: Bearer $(cat ~/.config/dam-hopper/server-token)" \
  -H "Content-Type: application/json" \
  -d '{"privateKeyPath": "/home/user/.ssh/id_rsa"}' \
  http://localhost:4800/api/ssh/keys/load
```

Keys are stored in-memory per session (not persisted to disk).

## Troubleshooting Configuration

### Workspace not found

Error: `Workspace directory does not exist`

Check:

1. Path in dam-hopper.toml exists: `ls /path/to/workspace`
2. Path is absolute or relative to CWD
3. User has read permissions

### Project not discovered

Error: `Project not found: {name}`

Verify in dam-hopper.toml:

1. Project name is correct
2. Project path exists relative to workspace root
3. Project type matches actual structure

```bash
ls -la /path/to/workspace/path/to/project
```

### Token issues

Regenerate token:

```bash
cargo run -- --new-token --workspace /path/to/workspace
cat ~/.config/dam-hopper/server-token
```

Include in Authorization header for all requests.

## Example: Multi-Project Workspace

```toml
[workspace]
name = "web-app-monorepo"

[[projects]]
name = "backend"
path = "./services/backend"
type = "cargo"
env_file = ".env.backend"
tags = ["api", "critical"]

[[projects]]
name = "frontend"
path = "./packages/frontend"
type = "pnpm"
tags = ["ui"]

[[projects]]
name = "mobile"
path = "./apps/mobile"
type = "custom"
build_command = "flutter build apk"
run_command = "flutter run"
tags = ["ios", "android"]

[[projects]]
name = "docs"
path = "./docs"
type = "custom"
build_command = "yarn build"
run_command = "yarn start"

[agent_store]
path = ".dam-hopper/agent-store"
```

Start server:

```bash
dam-hopper-server --workspace /path/to/web-app-monorepo --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.
