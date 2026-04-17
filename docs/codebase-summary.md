# DamHopper Codebase Summary

This document provides a high-level overview of the DamHopper codebase. For detailed phase documentation, see [phase-01-server-auth-bypass/](./phase-01-server-auth-bypass/).

## Project Overview

**DamHopper** is a workspace management system for agent-based development. It combines a Rust backend server with a React web frontend to provide an integrated development environment for managing workspaces, agents, terminals, and file operations.

**Repository Structure**: 
- 274 total files
- ~564K tokens
- Predominantly Rust (server) and TypeScript/React (web)

## Key Features

### Backend (Rust Server)
- **File System Operations**: Streaming upload/download, directory traversal, conflict handling
- **Terminal Management**: PTY session manager with WebSocket streaming
- **Agent Store**: Version-controlled agent configurations, skills, and templates
- **Authentication**: JWT-based with dev-mode bypass for local development
- **WebSocket Transport**: Bi-directional communication for real-time updates

### Frontend (React + Vite)
- **IDE Interface**: File tree, editor tabs, code highlighting (Monaco)
- **Terminal Emulator**: Multi-session terminal management with color support
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
Web Frontend (packages/web/)
  ├── React Components (atoms, molecules, organisms)
  ├── Page Templates (Dashboard, Git, Settings, etc.)
  ├── API Client (axios-based)
  └── WebSocket Transport (for terminals, file ops)
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
- **Framework**: React 18.2
- **Build Tool**: Vite 5.1.3
- **State Management**: Zustand (stores), TanStack Query
- **HTTP Client**: Axios
- **UI Framework**: Bootstrap 5
- **Code Editor**: Monaco Editor
- **Terminal**: xterm.js

## Recent Phases

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
  - Configuration section `[server]` with three settings:
    - `session_persistence` (bool, default false)
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
DAM_HOPPER_WORKSPACE     # Workspace root directory
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
  └── config.toml          # Global config (workspaces)

workspace-root/
  ├── dam-hopper.toml      # Workspace configuration
  └── .dam-hopper/         # Internal directory
      ├── agent-store/     # Agent store repository
      └── cache/           # Cache directory
```

## Development Commands

### Server Development
```bash
cd server

# Dev mode with no authentication
cargo run -- --no-auth --workspace /path/to/workspace

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
cd packages/web

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
pnpm dev          # Start both server and web with HMR
pnpm test         # Run all tests
pnpm build        # Build both server and web
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
├── packages/web/             # React frontend
│   ├── src/
│   │   ├── api/              # HTTP client, WebSocket transport
│   │   ├── components/       # React components
│   │   ├── pages/            # Page templates
│   │   ├── stores/           # Zustand state management
│   │   ├── hooks/            # Custom React hooks
│   │   └── App.tsx           # Root component
│   ├── vite.config.ts        # Vite configuration
│   └── package.json
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
- **Sandbox**: All paths validated relative to workspace root
- **Symlinks**: Allowed but cannot escape sandbox
- **Permissions**: Preserved from filesystem

### MongoDB (Optional)
- **Bcrypt Hashing**: Password hashed with DEFAULT_COST (12 rounds)
- **Account Status**: Supports enabled/disabled flag
- **Connection**: Pooled, support for MongoDB Atlas

## Documentation Library

| Document | Purpose |
|----------|---------|
| [system-architecture.md](./system-architecture.md) | Component interactions, data flow |
| [api-reference.md](./api-reference.md) | HTTP endpoints, request/response schemas |
| [code-standards.md](./code-standards.md) | Naming conventions, patterns, best practices |
| [configuration-guide.md](./configuration-guide.md) | Setup, environment variables, config files |
| [phase-01-server-auth-bypass/](./phase-01-server-auth-bypass/) | Dev mode authentication bypass implementation |
| [ws-protocol-guide.md](./ws-protocol-guide.md) | WebSocket message types, terminal protocol |
| [project-roadmap.md](./project-roadmap.md) | Planned features and phases |

---

**Last Updated**: April 16, 2026  
**Phase Status**: Phase 01 (Server-Side Auth Bypass) Complete  
**Generated by**: Automated codebase compaction (repomix) + manual documentation  
*For latest phase documentation, see [phase-01-server-auth-bypass/index.md](./phase-01-server-auth-bypass/index.md)*
