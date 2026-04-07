# Configuration Guide

## Workspace Configuration (dev-hub.toml)

Create `dev-hub.toml` in your workspace root.

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
path = "./packages/web"
type = "pnpm"
build_command = "pnpm build"
run_command = "pnpm dev"
tags = ["frontend"]

[[projects]]
name = "scripts"
path = "./scripts"
type = "custom"
build_command = "bash scripts/build.sh"
run_command = "bash scripts/run.sh"
```

### Project Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| name | string | ✓ | Unique within workspace |
| path | string | ✓ | Relative to workspace root |
| type | enum | ✓ | npm \| pnpm \| cargo \| maven \| gradle \| custom |
| build_command | string | | Overrides preset for type |
| run_command | string | | Overrides preset for type |
| env_file | string | | Path to .env (relative to project) |
| tags | array | | Arbitrary tags for filtering |

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

### Agent Store Configuration

Optional: configure where the agent store directory is located.

```toml
[agent_store]
path = ".dev-hub/agent-store"
```

If omitted, defaults to `.dev-hub/agent-store/` in workspace root.

### Feature Flags

Enable/disable features:

```toml
[features]
ide_explorer = true
```

**Available Flags:**

| Flag | Default | Env Override | Purpose |
|------|---------|---|---------|
| ide_explorer | false | `DEV_HUB_IDE=1` | File explorer + list/read/stat endpoints |

Features set in config can be overridden at runtime via environment variables.

## Global Configuration (~/.config/dev-hub/config.toml)

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

**defaults.workspace** — Path to default workspace (fallback if no --workspace or DEV_HUB_WORKSPACE).

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var | Type | Purpose |
|-----|------|---------|
| `DEV_HUB_WORKSPACE` | path | Override workspace path (takes priority over global config default) |
| `DEV_HUB_IDE` | 1/0 | Force enable/disable ide_explorer feature |
| `RUST_LOG` | string | Logging level (e.g., `dev_hub=debug,axum=info`) |

## Authentication Token

**Location:** `~/.config/dev-hub/server-token`

**Permissions:** 0600 (read-only to user)

**Format:** Hex-encoded UUID (64 characters)

### Generate New Token

```bash
cd server && cargo run -- --new-token --workspace /path/to/workspace
```

Saves to `~/.config/dev-hub/server-token`.

### Use Token

Include in all API requests:

```bash
curl -H "Authorization: Bearer $(cat ~/.config/dev-hub/server-token)" \
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
RUST_LOG=dev_hub=debug cargo run -- --workspace /path/to/workspace
```

### Release Build

```bash
cargo build --release
./target/release/dev-hub-server --workspace /path/to/workspace --port 4800
```

### Systemd Service

Install service file:

```bash
sudo cp deploy/dev-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable dev-hub
sudo systemctl start dev-hub
```

Edit `/etc/systemd/system/dev-hub.service` to set:
- `--workspace` path
- `--port`
- `--cors-origins` (if needed)

## Cross-Origin Resource Sharing (CORS)

By default, CORS allows localhost:5173 (dev) and localhost:3000 (prod).

Override with `--cors-origins`:

```bash
cargo run -- \
  --workspace /path/to/workspace \
  --cors-origins "https://example.com" \
  --cors-origins "http://localhost:3000"
```

## SSH Key Management

SSH credentials are loaded on-demand via `/api/ssh/keys/load`:

```bash
curl -X POST \
  -H "Authorization: Bearer $(cat ~/.config/dev-hub/server-token)" \
  -H "Content-Type: application/json" \
  -d '{"privateKeyPath": "/home/user/.ssh/id_rsa"}' \
  http://localhost:4800/api/ssh/keys/load
```

Keys are stored in-memory per session (not persisted to disk).

## Troubleshooting Configuration

### Workspace not found

Error: `Workspace directory does not exist`

Check:
1. Path in dev-hub.toml exists: `ls /path/to/workspace`
2. Path is absolute or relative to CWD
3. User has read permissions

### Feature disabled

Feature endpoints return 404 — check:

```bash
grep -A5 "\[features\]" dev-hub.toml
```

Or set env var:

```bash
DEV_HUB_IDE=1 cargo run -- --workspace /path/to/workspace
```

### Project not discovered

Error: `Project not found: {name}`

Verify in dev-hub.toml:
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
cat ~/.config/dev-hub/server-token
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

[features]
ide_explorer = true

[agent_store]
path = ".dev-hub/agent-store"
```

Start server:

```bash
dev-hub-server --workspace /path/to/web-app-monorepo --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.
