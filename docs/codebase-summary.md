# DamHopper Codebase Summary

This document provides a high-level overview of the current repository. Historical phase records are retained where useful; phase labels and test counts below are not release guarantees unless explicitly dated.

## Project Overview

**DamHopper** is a workspace management system for agent-based development. It combines a Rust backend server with split frontend hosts (`apps/web` for browser, `apps/native` for Tauri) that both reuse a shared React UI package (`packages/ui`) to provide an integrated environment for workspaces, agents, terminals, file operations, and optional Browser Debug.

**Repository Structure**:

- 274 total files
- ~564K tokens
- Predominantly Rust (server) and TypeScript/React (web)

## Current Frontend Shared Logic

- **Shared Runtime Logger**: `packages/shared/src/logger.ts` centralizes `configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`, with recursive sensitive metadata redaction before the sink.
- **Host-resource alerts**: the cached snapshot retains its legacy memory `alert` and adds bounded concurrent thermal/disk `currentAlerts`; resource and memory incidents share newest-first bounded history and the existing validated `host:alertChanged` channel. Explicit resource recovery removes only its incident, while an omitted additive field remains compatible with older servers.
- **Host-resource storage preference**: `UiConfig.hostResourcePinnedMount` persists as TOML `host_resource_pinned_mount`; `null` clears it and non-null values are limited to 1–4096 UTF-8 bytes. The browser treats an absent mount as missing without fallback rebinding. It is presentation-only and independent of telemetry/alert classification.
- **Web Bootstrap Logging**: `apps/web` resolves its bootstrap log level from Vite env, with dev defaulting to `debug` and production defaulting to `warn` when no override is set.
- **High-Value Call Sites**: transport, auth, terminal, dashboard, error boundary, and filesystem flows now use the shared logger instead of direct `console` calls.
- **File Decorations**: `packages/ui/src/lib/file-decoration.ts` is the shared registry for file icon, badge, display-language, and Monaco-language lookup.
- **Session-Bound Media**: `server/src/fs/media_ticket.rs` centrally tracks opaque video/image tickets and actor-bound media sessions; same-origin streams use the matching host-only `HttpOnly; SameSite=Lax; Path=/api/fs` media cookie without `Secure`, while allowlisted cross-origin native streams use the actor/session-bound ticket capability. Ticket/session expiry is bounded (30-minute idle, eight-hour absolute), and session revocation invalidates tickets. Auth cookies remain `HttpOnly; SameSite=Strict`. Clients require `session-cookie-v1`, perform credentialed `HEAD` before native source/download exposure, and never use a Bearer/Blob fallback. Profile switch/delete, credential transitions, and logout use a five-second revoke before token removal, including stale settings-dialog profiles. The backend is same-origin by default; separate browser frontends require exact `DAM_HOPPER_CORS_ORIGINS` entries. Cleartext HTTP exposes credentials, ticket URLs, actions, and media bytes to interception or modification; cross-origin media uses an authenticated actor/session-bound ticket because `SameSite=Lax` cookies are not sent cross-site. Qualification passed 1,018 UI tests, 116 full browser tests on Chromium 151 (11 media-specific), 691 Rust tests (one ignored performance test), build, and lint. State is process-local; multi-instance deployment requires sticky routing to the issuing process.
- **Compatibility Layer**: `packages/ui/src/lib/mime-to-language.ts` keeps MIME-only callers working while routing to the shared registry.
- **Persistent Explorer Tree Expansion**: `packages/ui/src/stores/explorer-tree.ts` (`useExplorerTreeStore`) tracks directory expansion states per target (`${project}::${targetKey}`) in `localStorage` under `dam-hopper:explorer-tree-state`. `FileTree.tsx` initializes open state, synchronizes toggles, automatically hydrates unloaded children on mount, and synchronizes paths during rename, drag-and-drop move, and deletion operations.
- **Persistent Editor ViewState**: `packages/ui/src/stores/editor.ts` (`useEditorStore`) preserves Monaco editor `viewState` (cursor position, column, scroll offsets, and code folds) in `localStorage` under `dam-hopper:editor-state` across tab switches, tool panel unmounts, and browser reloads with race-safe tabKey attribution.
- **Shared Surfaces**: explorer tree, editor tabs, search headers, and path labels all read from the same lookup so file identity stays aligned across the UI.
- **Terminal Find**: `TerminalPanel` and `PaneContainer` route Ctrl/Cmd+F only to the active pane's session-local xterm find controller, suppress the browser default, and keep the key out of PTY input. `PaneContainer` restores the TerminalPanel base key handler after temporary pane routing; inactive, detached, and reparented terminals close find state so queries and decorations do not leak across hosts.
- **Codex Usage Analytics**: `server/src/telemetry/` provides an opt-in private SQLite store, WAL/SHM permission hardening, idempotent Codex OTel event writes, bounded rollup-before-purge retention, derived HMAC session IDs, loopback receiver health, and aggregate-only query APIs. Model identifiers and time ranges are bounded; unavailable token components remain null. Codex CLI 0.146.1 token-bearing records without trace/span identity use a bounded HMAC fallback, remain unverified, and replay-dedupe with a documented same-millisecond collision tradeoff; Usage health adds only fixed-cardinality in-memory drop counters and no event or SQLite schema fields. Startup/shutdown and SQLite faults remain isolated from PTY operation. `packages/ui/src/components/pages/UsagePage.tsx` exposes Codex totals, model/time buckets, flat session summaries, pause, retention, receiver health, and explicit deletion controls.
- **Safe Inline Terminal Suggestions**: supported local interactive zsh/fish/Bash sessions expose only a server-validated lifecycle to a fail-closed, per-terminal controller. Bash preserves prompt hooks, records normalized simple-command text from `BASH_COMMAND`, and abandons compound, multiline, substitution, and redirection syntax. Ghost acceptance writes a suffix only; unsupported shells, replay, alternate buffers, and coarse-pointer / native-keyboard-suppressed surfaces show no automatic UI. Command history stays browser-local with clear and disable controls.
- **Shared Context Menus**: `packages/ui/src/components/ui/ContextMenu.tsx` wraps Radix Context Menu with body-only portal protection, one-open coordination, and capture-level scroll close. Phase 03 keeps the verification boundary in JSDOM wrapper and consumer tests, while Chromium browser coverage owns the real portal geometry and Arrow/Home/End focus behavior.
- **Workspace Terminal Layout**: `WorkspacePage` switches between IDE and terminal modes, `TerminalWorkspaceShell` renders the full-height terminal workspace with a persisted Fleet Terminal rail, and `MultiTerminalDisplay` reuses the existing terminal manager state across layout changes.
- **Floating Terminal Controls**: Each active terminal owns its host-local floating
  controls. The 48px plus safe-area-bottom baseline anchors the controls; the
  scroll rail reserves `6.25rem` plus an 8px gap and switches to a compact
  two-column action group in short viewports. Terminal Keys keeps the order
  Esc, Tab, Ctrl+C, Enter, PgUp, PgDn, and arrows. Custom Type uses a five-row
  US 60%-style layout with modifier-aware labels and ARIA, 44px minimum
  keycaps, responsive 24px–44px widths, and contained horizontal scrolling.
  Expanded panels reserve a `6.875rem` trailing lane plus safe-right, stay
  within a `dvh` max-height, and the terminal compact shell owns the bottom
  safe-area inset without double reservation.
- **Terminal Touch Scrolling**: `packages/ui/src/lib/terminal-touch-scroll.ts` adapts coarse/any-pointer touch swipes to xterm v6's custom `scrollLines` buffer surface, with animation-frame batching and bounded fling inertia. The xterm viewport/scrollable elements use `touch-action: none` and `overscroll-behavior: contain` to prevent browser page pan and pull-to-refresh; `TerminalPanel` cleanup cancels frames and removes passive listeners. Focused unit and browser coverage lives in `terminal-touch-scroll.test.ts` and `browser-tests/terminal-scroll-buttons.browser.tsx`.
- **Git VCS Roots**: `WorkspaceGitPanel` now loads server-reported VCS roots, scopes branch/history queries by selected root, groups local changes by `rootId`, and blocks mixed-root commits in the UI.
- **Browser Debug**: `BrowserDebugKeepAliveHost` preserves one iframe across workspace surfaces; the extension bridge accepts only exact origin/source/nonce/request matches and returns bounded DOM/ARIA metadata. Optional user-mediated browser capture or manual PNG/JPEG input remains local until explicit attach; the authenticated server artifact API stores capped JSON/PNG outside project roots for 10 minutes, exposes no read/list route, and inserts only generated paths into a live PTY without auto-submit.
- **Usage Session Audit**: `UsagePage` adds a Sessions tab backed by aggregate list/detail transport calls. It uses derived HMAC session identities, dynamic provider-qualified models, flat token summaries bounded by detail retention, cursor and URL deep links, and 15-second polling only for visible documents. Primary token totals exclude cached input; raw commands/content/storage data are not exposed. Paused summaries remain readable and deletion is explicit. Browser and native hosts share the behavior.

## Key Features

### Backend (Rust Server)

- **File System Operations**: Streaming upload/download, directory traversal, conflict handling
- **Terminal Management**: PTY session manager with WebSocket streaming
- **Agent Store**: Version-controlled agent configurations, skills, and templates
- **Authentication**: JWT-based with dev-mode bypass; no-auth binds require a trusted development network
- **WebSocket Transport**: Bi-directional communication for real-time updates

### Frontend (React + Vite)

- **IDE Interface**: File tree, editor tabs, code highlighting (Monaco)
- **Terminal Emulator**: Multi-session xterm terminal management with color support and active-pane client-side find
- **Workspace Navigation**: Multi-workspace switching, project discovery
- **Real-time Sync**: TanStack Query for efficient data synchronization
- **Git Integration**: Diff viewer, commit history, merge conflict handling

### Development Features

- **Dev Mode**: `--no-auth` bypasses authentication on the configured host; never expose publicly
- **Agent Store Inventory**: Browse, ship, and manage agent templates
- **Configuration Management**: Workspace and global configuration editors
- **Search**: Command search (BM25 index), file search with fuzzy matching

## Architecture Layers

### Application Tier

```
Browser Host (apps/web/) / Native Host (apps/native/)
  ├── Query client + transport bootstrap
  ├── Logger configuration
  └── Shared React UI package (packages/ui/)
         ├── Components (atoms, molecules, organisms)
         ├── Page templates (Dashboard, Workspace, Git, Settings)
         ├── API client + transport abstractions
         └── Hooks, stores, styles, assets, tests
         ↓
Backend BFF/API (server/)
  ├── Router (axum-based HTTP)
  ├── Auth Middleware (JWT validation)
  ├── API Handlers
  └── WebSocket Handler
         ↓
Service Layer (server/)
  ├── PTY Session Manager
  ├── Agent Store Service
  ├── File System Subsystem
  ├── Command Registry (BM25)
  └── SSH Credential Store
         ↓
Infrastructure
  ├── MongoDB (user auth, optional)
  ├── Filesystem (workspace, projects)
  ├── Git Repositories
  └── Config Files (TOML)
```

## Technology Stack

### Backend

- **Language**: Rust (deployment pins Rust 1.97.1)
- **Runtime**: Tokio (async/await)
- **Web Framework**: Axum 0.7
- **WebSocket**: Tokio-TungsteniteWebSocket, tower-http
- **Authentication**: JWT (jsonwebtoken), bcrypt
- **Database**: MongoDB (optional), SQLite (internal)
- **Build**: Cargo, Docker
- **Testing**: tokio::test, tower, tempfile

### Frontend

- **Language**: TypeScript 5.3+
- **Framework**: React 19
- **Build Tool**: Vite 6
- **State Management**: Zustand (stores), TanStack Query
- **Transport**: fetch + WebSocket transport abstractions
- **UI Framework**: Tailwind CSS v4
- **Code Editor**: Monaco Editor
- **Terminal**: xterm.js
- **Drag & Drop**: @dnd-kit/core 6.3.1 (Phase 02: Drag-to-Split)
- **Layout**: react-resizable-panels (resizable split panes)

## Current platform and deployment status

- Browser Debug native child WebView is Windows v1 supported only after the WebView2 gate; Linux implementation/package builds are runtime-unverified, macOS is deferred, and Android uses the iframe adapter.
- Native Browser Debug stores profile-scoped data under app data, validates generation/nonce/request identity, mirrors app zoom, and reports raw rendered bounds. Native relay v1 exposes picker/navigation; console forwarding is disabled.
- Docker serves the built SPA from `/opt/dam-hopper/web` on port 4800. systemd production is backend-only on `0.0.0.0:4801`; legacy nohup is loopback `127.0.0.1:4800` and must remain separate.
- Build-time origins for the extension are controlled by `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`; changing them requires rebuilding and redistributing the extension. `VITE_DAM_HOPPER_LOG_LEVEL` controls web bootstrap logging.
- Profile metadata and tokens are localStorage-scoped; editor persistence is metadata-only and Encrypt session material is memory-only. Transport rebind destroys the previous WS and advances a generation to reject stale responses.

See [Native Browser Debug Support](./native-browser-debug-support.md), [Configuration Guide](./configuration-guide.md), and [Linux systemd](./linux-systemd.md).

### Phase 03: IntelliJ-Compatible Git Actions ✅ Complete

- **Status**: Safe-vs-rewrite Git actions split across backend and web UI
- **Features**:
  - `POST /api/git/{project}/undo-last-commit` for local commit recovery
  - Safe revert paths for pushed/shared commits and selected changes
  - Separate `Revert Selected Changes` and `Drop Selected Changes` actions
  - History context menu groups safe actions apart from rewrite actions
- **Validation**: tests and build passed

### Phase 03: Frontend VCS Root UI ✅ Complete

- **Status**: Root selector and root-scoped Git UI for multi-root/submodule workspaces
- **Features**:
  - `WorkspaceGitPanel` root selector sourced from `git:roots`
  - Root-aware `branches`, `git-log`, and mutation hooks
  - Local changes grouped by `rootId` with submodule/gitlink rows kept distinct
  - Mixed-root staged commits blocked before submit
- **Validation**: frontend tests updated

### Phase 01: Server-Side Auth Bypass ✅ Complete

- **Status**: Fully implemented and tested (7/7 tests passing)
- **Feature**: `--no-auth` CLI flag for local dev mode
- **Safety**: Production guards prevent unsafe configurations
- **Tests**: Dev mode, normal mode regression, production safety
- **Documentation**: Historical phase record referenced in this summary; source directory is no longer present.

### Phase 04: SQLite Session Persistence ✅ Complete

- **Status**: Session persistence infrastructure with CRUD operations
- **Features**:
  - SQLite-backed `SessionStore` for session metadata and scrollback buffers
  - Two-table schema: `sessions` (metadata) and `session_buffers` (output)
  - Persistence is always enabled when the SQLite database opens
  - Configuration section `[server]` with two settings:
    - `session_db_path` (string, default ~/.config/dam-hopper/sessions.db)
    - `session_buffer_ttl_hours` (u64, default 24)
  - 0o600 Unix file permissions for security
  - Automatic migrations on startup
  - Integrates with Phase 04 auto-restart and Phase 02 buffer offset tracking
- **Tests**: 6 unit tests passing (open, save_session, save_buffer, load_sessions, load_buffer, delete_buffer_before)
- **Documentation**: [Configuration Guide - Server Configuration](./configuration-guide.md#server-configuration), [System Architecture - persistence/ module](./system-architecture.md#persistence-phase-04)

### Phase 04: Monaco Editor ✅ Complete

- **Status**: Advanced editor integration
- **Features**: Syntax highlighting, multi-tab support, git integration
- **Documentation**: Historical phase record; source file is no longer present in this checkout.

### Phase 04: PTY Restart Engine ✅ Complete

- **Status**: Auto-restart for terminal sessions with exponential backoff
- **Features**:
  - Supervisor pattern for async/blocking I/O separation
  - Restart policies: Never, OnFailure, Always
  - Exponential backoff (1s → 30s)
  - Session ID reuse (no frontend navigation)
  - Bounded respawn channel (DoS protection)
- **Tests**: 8 decision matrix rows + 5 integration tests (13/13 passing)
- **Known Limitation**: Exit code inference (portable-pty API) — cannot distinguish exit 0 from exit 1

### Phase 05: Config Write Roundtrip ✅ Complete

- **Status**: Absolute and relative project paths preserved correctly in TOML output
- **Features**:
  - Projects outside config directory preserve absolute paths in TOML writes
  - Projects inside config directory written as relative paths for portability
  - Relative paths normalized to forward slashes in TOML output
  - Config read → write → read cycle remains idempotent
  - Roundtrip behavior applies to both parser serialization and API config updates
- **Runtime Security**: Write behavior is serialization-only; runtime file access still limited by configured per-project roots
- **Tests**: Parser roundtrip tests and API config update tests passing
- **Related**: [Configuration Guide - Project Path Serialization](./configuration-guide.md#project-discovery)

### Phase 06: Startup Restore ✅ Complete

- **Status**: Session restoration from SQLite on server startup
- **Features**:
  - `restore_sessions()` function loads and respawns sessions
  - Smart filtering: skip `Never` restart policy, skip removed projects
  - Config-driven retry count via `restart_max_retries`
  - Lazy buffer loading fallback for dead sessions
  - Graceful error handling: per-session failures logged as warnings
  - Startup time < 1s with 10 sessions
  - TTL-based cleanup of expired buffers
- **Integration**: Called after PtySessionManager creation in main.rs
- **Tests**: 3 tests passing (skip filters, restore success)
- **Documentation**: Historical phase record; source directory is no longer present in this checkout.

## Critical Components

### Authentication Module (`server/src/api/auth.rs`)

- JWT creation and validation
- Cookie-based sessions (`HttpOnly; SameSite=Strict`; HTTP-compatible without `Secure`)
- MongoDB-backed user management
- Dev mode bypass with `no_auth` flag
- Token expiry: 30 days (dev mode), configurable production

### File System Subsystem (`server/src/fs/`)

- Sandboxed path validation
- Streaming upload/download (chunked transfers)
- Directory watching with inotify
- Conflict detection and merging
- Permission preservation

### PTY Session Manager (`server/src/pty/`)

- Tokio-based PTY management
- WebSocket streaming for terminal output
- Session persistence across reconnects
- PTY spawn env starts from a safe baseline allowlist, then applies `TERM` and the resolved session env snapshot
- Terminal env loading reads project `env_file` per session, with request overrides and clear missing/malformed file handling
- Signal handling (SIGTERM, SIGHUP)
- Binary and UTF-8 support
- Shell lifecycle integration for Bash, Zsh, and Fish with optional exit status

### Agent Store (`server/src/agent_store/`)

- Git-backed agent storage
- Worktree management for parallel editing
- Skill distribution and merging
- BM25-based command search
- Incremental imports and exports

## Configuration

### Environment Variables

```bash
DAM_HOPPER_CONFIG        # Explicit project registry file
DAM_HOPPER_WORKSPACE     # Legacy workspace directory override / discovery root
DAM_HOPPER_PORT          # Server port (default: 4800)
DAM_HOPPER_HOST          # Bind address (default: 0.0.0.0)
DAM_HOPPER_NO_AUTH       # Dev mode, bypasses auth
MONGODB_URI              # MongoDB connection (optional)
MONGODB_DATABASE         # MongoDB database name (optional)
RUST_ENV                 # Runtime environment (blocks if "production")
```

### Configuration Files

```
~/.config/dam-hopper/
  ├── server-token         # JWT signing secret (hex UUID)
  ├── config.toml          # Global defaults / known workspaces
  └── dam-hopper.toml      # Canonical project registry

registry-dir/
  ├── dam-hopper.toml      # Loaded registry (default: ~/.config/dam-hopper/)
  └── .dam-hopper/         # Internal directory next to the loaded registry
      ├── agent-store/     # Agent store repository
      └── cache/           # Cache directory
```

## Development Commands

### Server Development

```bash
cd server

# Dev mode with no authentication
cargo run -- --no-auth --config /path/to/dam-hopper.toml

# Dev mode with watch
cargo watch -x run

# Run tests
cargo test
cargo test auth_no_auth    # Specific test module

# Release build
cargo build --release
```

### Web Development

```bash
cd apps/web

# Install dependencies
pnpm install

# Dev server with HMR
pnpm dev

# Production build
pnpm build

# Run tests
pnpm test

# Coverage report
pnpm coverage
```

### Full Stack

```bash
# From root
pnpm install
pnpm dev          # Start browser host HMR
pnpm dev:server   # Start Rust server
pnpm build        # Build browser host
pnpm build:native # Build native host
pnpm check        # Build web + native, lint, and run Rust tests
```

## File Structure

```
dam-hopper/
├── server/                    # Rust backend
│   ├── src/
│   │   ├── main.rs           # CLI entry point, production safety guards
│   │   ├── state.rs          # AppState definition
│   │   ├── api/
│   │   │   ├── auth.rs       # Authentication handlers
│   │   │   ├── ws.rs         # WebSocket transport
│   │   │   └── mod.rs        # Router configuration
│   │   ├── pty/              # Terminal management
│   │   ├── fs/               # File system operations
│   │   ├── agent_store/      # Agent store service
│   │   └── lib.rs            # Library exports
│   ├── tests/
│   │   └── auth_no_auth.rs   # Auth bypass integration tests
│   └── Cargo.toml            # Dependencies
├── apps/
│   ├── web/                  # Thin browser Vite host
│   └── native/               # Tauri v2 host + src-tauri shell
├── packages/
│   ├── ui/                   # Shared React UI, hooks, stores, tests, styles
│   └── shared/               # Shared logger and runtime helpers
├── docs/                      # Documentation
│   ├── codebase-summary.md   # This file
│   ├── system-architecture.md
│   ├── api-reference.md
│   ├── code-standards.md
│   └── phase-01-server-auth-bypass/
│       ├── index.md
│       └── implementation.md
├── plans/                     # Feature plans and phases
│   └── 20260416-multi-server-auth/
│       ├── phase-01-server-auth-bypass.md
│       ├── phase-02-multi-server-frontend.md
│       └── phase-03-auth-integration.md
└── CLAUDE.md                  # Development commands
```

## Test Coverage

### Passing Tests

- **Server**: 111 unit tests, 7 integration tests (auth)
- **Web**: Component tests with Vitest, 80% coverage target

### Known Limitations (Pre-existing)

- 8 platform-specific failures (Windows symlink privileges, path format)
- Git worktree edge cases
- Not phase-01-related

## Performance Metrics

- **Startup Time**: ~500ms (Rust server)
- **API Response**: <100ms (typical)
- **WebSocket Latency**: <50ms (terminal operations)
- **Build Time**: ~45s (server), ~30s (web)
- **Memory**: ~50MB (server), ~100MB (web dev)

## Security Considerations

### Authentication

- **JWT Signing**: Uses server-token (hex UUID) stored at `~/.config/dam-hopper/server-token`
- **Cookie Security**: auth cookies are `HttpOnly; SameSite=Strict`; HTTP media sessions use host-only `HttpOnly; SameSite=Lax` cookies. HTTP transport remains interceptable.
- **Dev Mode Safety**: Production guards prevent unsafe configurations with `--no-auth`

### File System

- **Sandbox**: All paths validated relative to the selected project's configured root
- **Symlinks**: Allowed but cannot escape sandbox
- **Permissions**: Preserved from filesystem

### MongoDB (Optional)

- **Bcrypt Hashing**: Password hashed with DEFAULT_COST (12 rounds)
- **Account Status**: Supports enabled/disabled flag
- **Connection**: Pooled, support for MongoDB Atlas

## Documentation Library

| Document                                                       | Purpose                                       |
| -------------------------------------------------------------- | --------------------------------------------- |
| [system-architecture.md](./system-architecture.md)             | Component interactions, data flow             |
| [api-reference.md](./api-reference.md)                         | HTTP endpoints, request/response schemas      |
| [code-standards.md](./code-standards.md)                       | Naming conventions, patterns, best practices  |
| [configuration-guide.md](./configuration-guide.md)             | Setup, environment variables, config files    |
| [native-browser-debug-support.md](./native-browser-debug-support.md)   | Native Browser Debug platform gate and security boundaries |
| [user-guide-multi-server-profiles.md](./user-guide-multi-server-profiles.md) | Profile storage, switching, and cross-origin policy |
| [ws-protocol-guide.md](./ws-protocol-guide.md)                 | WebSocket message types, terminal protocol    |
| [project-roadmap.md](./project-roadmap.md)                     | Planned features and phases                   |

---

**Last Updated**: August 30, 2026
**Phase Status**: Current support is tracked by feature and platform qualification; historical phase labels and evidence remain dated records.
**Generated by**: Manual source-verified maintenance; a temporary Repomix refresh was attempted but blocked by the harness policy.
