# Configuration Guide

## Project Registry (dam-hopper.toml)

DamHopper loads project registry data from `dam-hopper.toml`. You can point the server at a specific registry file with `--config <path>` or `DAM_HOPPER_CONFIG`, or let it use the canonical global registry at `~/.config/dam-hopper/dam-hopper.toml`.

Legacy workspace-root discovery still works when you pass `--workspace <dir>` or `DAM_HOPPER_WORKSPACE`, but it is no longer the primary model.

### Basic Setup

For end-to-end validation steps after setup, jump to the [Manual Smoke Checklist](#manual-smoke-checklist).

```toml
[workspace]
name = "my-workspace"
```

### Project Discovery

Define projects with type-specific defaults. Project paths can be absolute or relative; relative paths resolve against the config file directory. Other path fields like `env_file` and terminal profile `cwd` remain project-relative and reject absolute or traversal-containing values.

**Path Serialization:** When DamHopper writes the registry TOML, absolute project paths are preserved when projects live outside the config file directory. Projects inside the config directory are written as relative paths for portability. Relative paths are normalized to forward slashes in TOML output regardless of platform.

**Windows paths:** Drive-letter absolute paths are supported. Mixed separators and `\\?\` verbatim prefixes are covered by automated tests. Verbatim paths preserve the exact Windows path string and are mainly useful when you need explicit device-style paths. UNC paths can be used only with manual validation in your target environment because they are not covered by automated CI in this repo.

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
| name          | string | ✓        | Unique within registry                            |
| path          | string | ✓        | Absolute path or relative to config file dir      |
| type          | enum   | ✓        | npm \| pnpm \| cargo \| maven \| gradle \| custom |
| build_command | string |          | Overrides preset for type                         |
| run_command   | string |          | Overrides preset for type                         |
| env_file      | string |          | Relative path to .env (project-local only)        |
| tags          | array  |          | Arbitrary tags for filtering                      |

## File Access Boundaries

Runtime file access via `/api/fs/*` and WebSocket file operations is **sandboxed per project root**. The server maintains a set of allowed roots derived from the currently loaded `projects[].path` entries. All file paths are validated against these configured roots. This prevents traversal attempts from escaping a project's directory tree and blocks access to other projects' files.

**Phase 04 note:** `workspace_dir` is now a display/legacy field only; the security boundary is enforced by per-project roots derived from the config. This allows projects to be located anywhere on the filesystem while maintaining strict access control.

- Symlink targets are canonicalized and re-validated against the project boundary
- Tree subscriptions (watchers) are rooted at each project root
- Relative path sequences containing `..` are rejected before filesystem access
- After config reload or workspace switch, the sandbox roots are automatically reinitialized

## Startup Config Resolution

Server startup resolves configuration in this order:

1. `--config <path>` or `DAM_HOPPER_CONFIG` — load exact registry file
2. `--workspace <dir>` or `DAM_HOPPER_WORKSPACE` — load from directory or search upward
3. `~/.config/dam-hopper/dam-hopper.toml` — global registry
4. `defaults.workspace` from `~/.config/dam-hopper/config.toml`
5. Current working directory via legacy upward `dam-hopper.toml` discovery
6. Empty config fallback

**Phase 04 note:** Workspace APIs now report `configPath` (the authoritative registry file path) separately from `path`/`root` (legacy display fields).

## Workspace Switching and Config Reload

**POST /api/workspace/switch**

The workspace switch endpoint accepts either a directory path or a direct path to a `dam-hopper.toml` file:

```json
{ "path": "/home/user/projects/my-workspace" }
```

or

```json
{ "path": "/home/user/.config/dam-hopper/dam-hopper.toml" }
```

When switching:
- The server reloads configuration from the specified path (or discovers `dam-hopper.toml` in the directory)
- File API sandbox is reinitialized from the newly loaded project roots
- All PTY sessions are disposed
- All connected clients receive a `workspace:changed` broadcast event

**Config updates and settings changes** (`PUT /api/config`, `PATCH /api/config/projects/:name`, `POST /api/settings`) also trigger sandbox reinitialization after writing the new configuration. The reload always reads from the current `configPath` without re-discovery.

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

If omitted, defaults to `.dam-hopper/agent-store/` relative to the loaded registry file directory.

### Feature Flags

All features are enabled by default.

### UI Configuration

The global UI config includes terminal workspace/panel shortcuts, inline terminal suggestions, and Codex terminal notification settings.

| Field                               | Type     | Default                   | Notes |
| ----------------------------------- | -------- | ------------------------- | ----- |
| terminal_workspace_shortcut         | string   | `Mod+Shift+Backquote`     | Global IDE/terminal mode toggle shortcut |
| git_panel_shortcut                  | string   | `Mod+Shift+KeyG`          | Toggle the Git panel in IDE or Terminal mode |
| ports_panel_shortcut                | string   | `Mod+Shift+KeyP`          | Toggle the Ports panel in IDE or Terminal mode |
| fleet_terminal_shortcut             | string   | `Mod+Shift+KeyM`          | Toggle the Fleet Terminal panel in IDE or Terminal mode |
| terminal_suggestions_enabled         | bool     | `true`                    | Kill switch for automatic suggestions and lifecycle-driven history writes |
| terminal_scroll_buttons_enabled     | bool     | `false`                   | Show floating Page Up/Down buttons in terminal |
| terminal_codex_notifications_enabled | bool    | `false`                   | Master switch for Codex OSC 9 notifications and Codex TUI synchronization |
| terminal_codex_notification_toast_enabled | bool | `true`                    | Persisted preference for transient in-app toasts; notification history remains independent |
| terminal_codex_browser_notifications_enabled | bool | `true`                 | Persisted preference for native browser popups; browser permission remains runtime-only |
| terminal_codex_notification_sound_enabled | bool | `true`                    | Persisted preference for the in-app chime |
| terminal_codex_notification_sound_volume | u8   | `100`                     | In-app chime volume, from `0` to `100` |
| terminal_codex_notification_sound_pattern | string | `"default"`             | One of `"default"`, `"soft"`, `"two-tone"`, or `"urgent"` |

Example:

```toml
[ui]
terminal_workspace_shortcut = "Mod+Shift+Backquote"
git_panel_shortcut = "Mod+Shift+KeyG"
ports_panel_shortcut = "Mod+Shift+KeyP"
fleet_terminal_shortcut = "Mod+Shift+KeyM"
terminal_suggestions_enabled = true
terminal_scroll_buttons_enabled = false
terminal_codex_notifications_enabled = false
terminal_codex_notification_toast_enabled = true
terminal_codex_browser_notifications_enabled = true
terminal_codex_notification_sound_enabled = true
terminal_codex_notification_sound_volume = 100
terminal_codex_notification_sound_pattern = "default"
```

The API exposes these UI fields in `camelCase` (for example, `terminalCodexNotificationToastEnabled`) and persists them as the snake_case TOML keys shown above. Older `terminal_agent_notifications_enabled` and `terminalAgentNotificationsEnabled` values remain read-compatible aliases for the master switch. Missing child preferences default to enabled, volume `100`, and pattern `"default"`.

Only updates to `terminalCodexNotificationsEnabled` synchronize `~/.codex/config.toml`. Toast, browser-popup, sound, volume, and pattern updates persist only to DamHopper's global UI config. Browser notification permission is not persisted; it is requested per browser from Settings > Appearance > Terminal agent notifications.

Shortcuts are normalized by the client config layer and can be captured/reset from Settings > Appearance > Keyboard Shortcuts. Git, Ports, and Fleet Terminal shortcuts toggle their target in both IDE and Terminal modes; opening one closes the other two target panels.

#### Inline terminal suggestions

The **Inline Terminal Suggestions** switch is an immediate fail-closed kill switch:
turning it off hides automatic ghosts, stops controller searches, and prevents future
lifecycle-driven writes to browser-local command history. It does not delete commands
already retained in the browser. Use **Clear local command history** in Settings to
remove those commands, or disable **Local command history** to stop future browser-local
writes independently.

Automatic suggestions are supported only for a launch-only local interactive `zsh`,
`fish`, or Bash shell whose lifecycle markers validate for the current PTY incarnation.
Bash preserves scalar and array `PROMPT_COMMAND` hooks and records normalized simple
commands, but fails closed when an existing `DEBUG` trap or compound, multiline,
substitution, or redirection syntax prevents reliable capture. PowerShell,
SSH/subshell sessions, replayed or respawned terminals, alternate buffers,
and mobile/coarse-pointer input remain fail closed. In those cases no ghost is shown;
the explicit desktop history dialog remains the deliberate reuse path when enabled.

The desktop shortcuts are `Alt+Right` for the full suffix, `Alt+Shift+Right` for the
next token, and `Ctrl+Alt+H` for command history. Acceptance writes only the verified
suffix and never executes the command. All other terminal keys and paste data pass to
the PTY unchanged.

Only DamHopper-managed xterm sessions participate in this feature. External terminals remain out of scope even if they launch Codex.

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

### Diagnostics Storage

Diagnostics export does not currently add user-configurable knobs to `dam-hopper.toml`.

The export API is local-only, uses camelCase on the wire, and accepts `frontend` plus the legacy `frontendSnapshot` alias.

- Backend diagnostics are stored locally at `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- The backend log keeps a 60-minute retention window and uses restricted `0o600` file permissions on Unix
- Frontend diagnostics stay in browser `localStorage` under `damhopper_diagnostics_frontend_v1`
- Exported JSON bundles are created only when the user triggers Settings > Maintenance > Export Diagnostics
- Terminal tails are included by default and may still contain sensitive local/dev output even after best-effort redaction

## Global Configuration (~/.config/dam-hopper/config.toml)

Store global defaults and known workspace metadata. This file is separate from the project registry.

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

**defaults.workspace** — Legacy fallback workspace directory, used only after explicit config, explicit workspace, and the global registry path are checked.

**workspaces** — Known workspace shortcuts (referenced by server later, not currently used by CLI).

## Environment Variables

| Var                    | Type   | Purpose                                                             |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `DAM_HOPPER_CONFIG`    | path   | Load an exact `dam-hopper.toml` registry file                       |
| `DAM_HOPPER_WORKSPACE` | path   | Override workspace path (takes priority over global config default) |
| `RUST_LOG`             | string | Logging level (e.g., `dam_hopper=debug,axum=info`)                  |

## Authentication Token

**Location:** `~/.config/dam-hopper/server-token`

**Permissions:** 0600 (read-only to user)

**Format:** Hex-encoded UUID (64 characters)

### Generate New Token

```bash
cd server && cargo run -- --config /path/to/dam-hopper.toml --new-token
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
cargo run -- --config /path/to/dam-hopper.toml --port 4800
# Or omit --config to use ~/.config/dam-hopper/dam-hopper.toml
```

### With Logging

```bash
RUST_LOG=dam_hopper=debug cargo run -- --config /path/to/dam-hopper.toml
```

### Release Build

```bash
cargo build --release
./target/release/dam-hopper-server --config /path/to/dam-hopper.toml --port 4800
```

### Nohup Background Server

Build, install under `~/.config/dam-hopper/`, and restart:

```bash
pnpm build:server
pnpm server:restart
```

Edit `~/.config/dam-hopper/server.conf` to set:

- `DAM_HOPPER_CONFIG`
- `DAM_HOPPER_HOST`
- `DAM_HOPPER_PORT`
- `DAM_HOPPER_CORS_ORIGINS` (if needed)
- `DAM_HOPPER_WORKSPACE` (legacy directory-discovery override, optional)

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
  --config /path/to/dam-hopper.toml \
  --cors-origins "https://example.com" \
  --cors-origins "http://localhost:3000"
```

For native Tauri clients, also allow the native dev and packaged webview origins
used by your target platform. Typical entries are:

```bash
cargo run -- \
  --config /path/to/dam-hopper.toml \
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

## Manual Smoke Checklist

1. Create `~/.config/dam-hopper/dam-hopper.toml` with at least two projects whose `projects[].path` values point at separate roots. On Windows, use different drives if available.
Expected: `GET /api/workspace/status` reports the registry `configPath` and the expected `projectCount`.

2. Start the server with `cargo run -- --config ~/.config/dam-hopper/dam-hopper.toml --port 4800`.
Expected: startup succeeds without requiring a repo-local `dam-hopper.toml`.

3. Browse and read files in each project, then create or edit a file inside each root.
Expected: list/read/write operations work inside the selected project and do not bleed across roots.

4. Create a terminal session for each project without passing `cwd`.
Expected: each terminal starts in the selected project root.

5. Attempt a traversal or sibling-project read such as `/api/fs/read?project=alpha&path=../beta/owned.txt`.
Expected: the server returns `403 FORBIDDEN`. Also verify rejection for a raw absolute path outside the configured root and for any symlink that resolves outside the selected project.

6. On Windows, change one project path to a mixed-separator absolute path and, if supported in your environment, a `\\?\` verbatim path.
Expected: the registry still loads, the project remains accessible, and TOML writes preserve absolute paths instead of forcing them relative.

7. On Windows or in any environment with a reachable network share, add a temporary UNC-style project entry such as `path = "\\\\server\\share\\project"`.
Expected: the registry either works for that project in your environment or fails in a clear, local way that you can document before rollout. Do not assume UNC behavior from Linux CI alone.

## Troubleshooting Configuration

### Registry or project path not found

Error: `Workspace directory does not exist` or missing project path errors

Check:

1. Registry path exists: `ls ~/.config/dam-hopper/dam-hopper.toml`
2. Each `projects[].path` exists
3. Relative project paths are resolved from the registry file directory
4. User has read permissions

### Project not discovered

Error: `Project not found: {name}`

Verify in dam-hopper.toml:

1. Project name is correct
2. Project path exists relative to the registry file directory or is an absolute path
3. Project type matches actual structure

```bash
ls -la /configured/project/path
```

### Token issues

Regenerate token:

```bash
cargo run -- --config /path/to/dam-hopper.toml --new-token
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
dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.
