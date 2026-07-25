# DamHopper Codebase Summary

This document provides a high-level overview of the DamHopper codebase. For detailed phase documentation, see [phase-01-server-auth-bypass/](./phase-01-server-auth-bypass/).

## Project Overview

**DamHopper** is a workspace management system for agent-based development. It combines a Rust backend server with split frontend hosts (`apps/web` for browser, `apps/native` for Tauri) that both reuse a shared React UI package (`packages/ui`) to provide an integrated environment for workspaces, agents, terminals, and file operations.

**Repository Structure**:

- 274 total files
- ~564K tokens
- Predominantly Rust (server) and TypeScript/React (web)

## Current Frontend Shared Logic

- **Shared Runtime Logger**: `packages/shared/src/logger.ts` centralizes `configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`, with recursive sensitive metadata redaction before the sink.
- **Web Bootstrap Logging**: `apps/web` resolves its bootstrap log level from Vite env, with dev defaulting to `debug` and production defaulting to `warn` when no override is set.
- **High-Value Call Sites**: transport, auth, terminal, dashboard, error boundary, and filesystem flows now use the shared logger instead of direct `console` calls.
- **File Decorations**: `packages/ui/src/lib/file-decoration.ts` is the shared registry for file icon, badge, display-language, and Monaco-language lookup.
- **Compatibility Layer**: `packages/ui/src/lib/mime-to-language.ts` keeps MIME-only callers working while routing to the shared registry.
- **Rendering Wrapper**: `packages/ui/src/lib/file-decoration-icon.tsx` is a thin icon component over the registry.
- **Shared Surfaces**: explorer tree, editor tabs, search headers, and path labels all read from the same lookup so file identity stays aligned across the UI.
- **Terminal Find**: `TerminalPanel` and `PaneContainer` route Ctrl/Cmd+F only to the active pane's session-local xterm find controller, suppress the browser default, and keep the key out of PTY input. `PaneContainer` restores the TerminalPanel base key handler after temporary pane routing; inactive, detached, and reparented terminals close find state so queries and decorations do not leak across hosts.
- **Safe Inline Terminal Suggestions**: supported local interactive zsh/fish/Bash sessions expose only a server-validated lifecycle to a fail-closed, per-terminal controller. Bash preserves prompt hooks, records normalized simple-command text from `BASH_COMMAND`, and abandons compound, multiline, substitution, and redirection syntax. Ghost acceptance writes a suffix only; unsupported shells, replay, alternate buffers, and coarse-pointer / native-keyboard-suppressed surfaces show no automatic UI. Command history stays browser-local with clear and disable controls.
- **Shared Context Menus**: `packages/ui/src/components/ui/ContextMenu.tsx` wraps Radix Context Menu with body-only portal protection, one-open coordination, and capture-level scroll close. Phase 03 keeps the verification boundary in JSDOM wrapper and consumer tests, while Chromium browser coverage owns the real portal geometry and Arrow/Home/End focus behavior.
- **Workspace Terminal Layout**: `WorkspacePage` switches between IDE and terminal modes, `TerminalWorkspaceShell` renders the full-height terminal workspace with a persisted Fleet Terminal rail, and `MultiTerminalDisplay` reuses the existing terminal manager state across layout changes.
- **Git VCS Roots**: `WorkspaceGitPanel` now loads server-reported VCS roots, scopes branch/history queries by selected root, groups local changes by `rootId`, and blocks mixed-root commits in the UI.
- **Browser Debug**: `BrowserDebugKeepAliveHost` preserves one iframe across workspace surfaces; the extension bridge accepts only exact origin/source/nonce/request matches and returns bounded DOM/ARIA metadata. Optional user-mediated browser capture or manual PNG/JPEG input remains local until explicit attach; the authenticated server artifact API stores capped JSON/PNG outside project roots for 10 minutes, exposes no read/list route, and inserts only generated paths into a live PTY without auto-submit.

## Key Features

### Backend (Rust Server)

- **File System Operations**: Streaming upload/download, directory traversal, conflict handling
- **Terminal Management**: PTY session manager with WebSocket streaming
- **Agent Store**: Version-controlled agent configurations, skills, and templates
- **Authentication**: JWT-based with dev-mode bypass for local development
- **WebSocket Transport**: Bi-directional communication for real-time updates

### Frontend (React + Vite)

- **IDE Interface**: File tree, editor tabs, code highlighting (Monaco)
- **Terminal Emulator**: Multi-session xterm terminal management with color support and active-pane client-side find
- **Workspace Navigation**: Multi-workspace switching, project discovery
- **Real-time Sync**: TanStack Query for efficient data synchronization
- **Git Integration**: Diff viewer, commit history, merge conflict handling

### Development Features

- **Dev Mode**: `--no-auth` flag bypasses authentication for local development
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

- **Language**: Rust 1.79+
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

## Recent Phases

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
- **Documentation**: [phase-01-server-auth-bypass/](./phase-01-server-auth-bypass/)

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
- **Documentation**: [phase-04-monaco-editor.md](./phase-04-monaco-editor.md)

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
- **Documentation**: [Phase 06 documentation](./phase-06-startup-restore/index.md)

## Critical Components

### Authentication Module (`server/src/api/auth.rs`)

- JWT creation and validation
- Cookie-based sessions (httpOnly, Secure, SameSite)
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
DAM_HOPPER_CORS_ORIGINS  # Comma-separated CORS origins
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
- **Cookie Security**: HttpOnly, Secure, SameSite=Strict
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
| [phase-01-server-auth-bypass/](./phase-01-server-auth-bypass/) | Dev mode authentication bypass implementation |
| [ws-protocol-guide.md](./ws-protocol-guide.md)                 | WebSocket message types, terminal protocol    |
| [project-roadmap.md](./project-roadmap.md)                     | Planned features and phases                   |

---

**Last Updated**: May 26, 2026  
**Phase Status**: Tauri shared-ui/native verification and documentation update in progress  
**Generated by**: Automated codebase compaction (repomix) + manual documentation  
_For latest phase documentation, see [phase-01-server-auth-bypass/index.md](./phase-01-server-auth-bypass/index.md)_
