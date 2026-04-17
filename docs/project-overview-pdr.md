# DamHopper Project Overview & PDR

## Project Vision

DamHopper is a **workspace-first IDE assistant** that manages multiple projects within a single workspace, providing integrated terminal management, file exploration, and AI-powered agent distribution.

Target users: Developers managing monorepos or multi-project workspaces who want a lightweight, AI-friendly interface for common development tasks.

## Core Product Requirements

### PR-001: Workspace Management

**Functional Requirements:**
- Support TOML-based workspace configuration (dam-hopper.toml)
- Auto-discover projects by type (Maven, Gradle, npm, pnpm, Cargo, custom)
- Hot-reload workspace config without restart
- Store global defaults at ~/.config/dam-hopper/config.toml

**Acceptance Criteria:**
- ✓ Load and parse dam-hopper.toml
- ✓ Resolve relative project paths to absolute
- ✓ Support workspace:switch via API
- ✓ Fallback to global config defaults

**Technical Constraints:**
- Serde for TOML deserialization with snake_case field mapping
- Workspace resolver priority: CLI flag > ENV var > global config

### PR-002: Terminal Session Management

**Functional Requirements:**
- Create isolated PTY sessions per project
- Run pre-configured build/run commands
- Stream terminal output to connected WebSocket clients
- Support terminal input (stdin) via API
- Auto-restart crashed processes with configurable policy
- Ensure idempotent session creation

**Acceptance Criteria:**
- ✓ Spawn new PTY session with UUID
- ✓ Broadcast output to multiple subscribers
- ✓ Retain buffer for live sessions only
- ✓ Graceful shutdown (SIGTERM → SIGKILL)
- ✓ Auto-restart on crash per policy (never/on-failure/always)
- ✓ Exponential backoff (1s→30s max)
- ✓ Session ID reused across restarts (frontend tab stays connected)
- ✓ Idempotent create: removes dead tombstones, cancels pending restarts, safe to retry (Phase 07 ✓)

**Technical Constraints:**
- portable-pty for cross-platform compatibility
- Tokio broadcast channels for fan-out + separate PTY/FS channels
- WebSocket for output streaming + lifecycle events
- Supervisor pattern: reader thread (blocking) + supervisor task (async restart)
- Killed set prevents double-spawn during concurrent creates
- Cleanup task prunes dead tombstones (60s TTL) and orphaned killed entries (every 30s)

**Phase-Based Implementation:**
- Phase 02: Config extension — RestartPolicy enum per terminal
- Phase 03: Session metadata — restart_count, last_exit_at fields
- Phase 04: Restart engine — supervisor + exponential backoff
- Phase 05: Enhanced WS events — terminal:exit (willRestart field) + process:restarted
- Phase 07: Idempotency — killed set lifecycle, TOCTOU guard, memory leak fix

### PR-003: Git Operations

**Functional Requirements:**
- Clone repositories with optional recursion
- Fetch, push, pull with progress reporting
- Query repository status (branch, ahead/behind)
- Support SSH key loading for authentication

**Acceptance Criteria:**
- ✓ Clone from any git URL
- ✓ Detect SSH key requirement and prompt
- ✓ Broadcast git progress to WebSocket
- ✓ Handle merge conflicts gracefully

**Technical Constraints:**
- git2 library for operations, CLI fallback for advanced ops
- SSH key storage in ~/.config/dam-hopper/credentials/
- Constant-time comparison for auth tokens

### PR-004: IDE File Explorer (Phase 01)

**Functional Requirements:**
- List directory contents with metadata (size, mtime, symlink status)
- Read file content (text with range support, binary detection)
- Get file metadata (kind, size, mime type, binary flag)
- Enforce sandbox: no traversal outside project bounds

**Acceptance Criteria:**
- ✓ GET /api/fs/list returns DirEntry array
- ✓ GET /api/fs/read supports offset+len for large files (max 10MB per read)
- ✓ GET /api/fs/stat includes mime type detection
- ✓ Symlink validation prevents escape attempts
- ✓ Binary files return { binary: true, mime: "..." }

**Technical Constraints:**
- Max read: 10MB per request (configurable)
- MIME type detection via mime_guess crate
- Async I/O via tokio::fs

**Phase 02+:** File watcher, create/delete/move ops (see Roadmap below)

### PR-005: Agent Store Distribution

**Functional Requirements:**
- Distribute .claude/ items (skills, commands, hooks, MCP servers) across projects
- Support symlink-based distribution (ship/unship)
- Absorb project items into central store
- Health check for broken symlinks
- Import items from remote repositories

**Acceptance Criteria:**
- ✓ ship() creates symlinks
- ✓ unship() removes symlinks
- ✓ absorb() copies file into store
- ✓ Distribution matrix tracks coverage
- ✓ Health check reports broken links

**Technical Constraints:**
- Store path: .dam-hopper/agent-store/
- Symlinks relative to project root
- Shallow clone for remote import (temp cleanup)
- URL regex validation before clone

### PR-006: REST API & Authentication

**Functional Requirements:**
- Bearer token authentication (hex UUID)
- Structured error responses
- CORS configurable per deployment
- Content negotiation for binary vs. text responses

**Acceptance Criteria:**
- ✓ All routes protected by token validation
- ✓ Constant-time comparison prevents timing attacks
- ✓ Errors return JSON with status code
- ✓ Binary files detected, not force-decoded as text

**Non-Functional Requirements:**
- Token generation on first start
- Store token securely (0600 file permissions)
- Log auth failures without leaking tokens

### PR-007: Multi-Server Profile Management (Phase 2)

**Functional Requirements:**
- Manage multiple server connection profiles in browser (no backend involvement)
- Switch between servers without page reload
- Store profile metadata: name, URL, auth type, username
- Automatically migrate legacy single-server config to profile system
- Display active profile in UI sidebar

**Acceptance Criteria:**
- ✓ Create/read/update/delete profiles via localStorage
- ✓ `ServerProfile` model: { id (UUID v4), name, url, authType ("basic"|"none"), username?, createdAt (timestamp) }
- ✓ Server profiles list via `ServerProfilesDialog.tsx` component
- ✓ Profile editor via `ServerSettingsDialog.tsx` component
- ✓ Active profile indicator in `Sidebar.tsx`
- ✓ `migrateToProfiles()` called in `App.tsx` startup — converts legacy `damhopper_server_url` + `damhopper_auth_username` to "Default Server" profile
- ✓ Profile switching without browser reload
- ✓ Delete active profile clears active ID

**Storage:**
- Profiles JSON: localStorage key `damhopper_server_profiles`
- Active profile ID: localStorage key `damhopper_active_profile_id`

**Non-Functional Requirements:**
- Password never stored (only display username)
- UUID v4 for profile IDs (browser crypto.randomUUID())
- Storage quota: typical localStorage limit (5-10MB)
- Profile switching instant (no network latency)

## Non-Functional Requirements

### Performance

**Target Metrics:**
- Workspace load: <200ms
- PTY spawn: <500ms
- File list (1000 items): <100ms
- File read (10MB): <2s

**Implementation:**
- Arc<Mutex> for zero-copy clones
- Tokio async I/O
- Broadcast channels for fan-out (not polling)

### Reliability

**Uptime:** 24/7 server stability for long-running sessions
**Session Recovery:** Retain PTY state if WebSocket disconnects briefly
**Sandbox:** Prevent information leakage across projects

### Security

**Authentication:** Bearer token + constant-time comparison
**Sandbox:** Path validation prevents directory traversal
**Error Messages:** Never leak filesystem paths or credentials
**Symlink Handling:** Validate symlink targets stay in bounds

### Developer Experience

- Single config file for entire workspace
- Consistent REST API design
- Detailed error messages with suggestions
- Structured logging (tracing crate)

## Architecture Decisions

### Decision: Arc<Mutex<T>> for shared state

**Context:** Multiple PTY sessions, git operations, filesystem operations run concurrently.

**Decision:** Use Arc<Mutex<T>> for PtySessionManager, FsSubsystem, AgentStoreService.

**Rationale:** Cheap clones, clear ownership, Mutex never held across `.await`.

**Alternative Rejected:** Channels (too much boilerplate) or Actor model (overkill).

### Decision: IDE Explorer Enabled by Default

**Context:** File exploration is a core requirement of DamHopper's IDE-like functionality.

**Decision:** IDE endpoints are permanently enabled.

**Rationale:** The feature gate added unnecessary complexity for the primary use case of the project.

**Alternative Rejected:** Feature-gated endpoints (was used in early development but removed to simplify architecture).

### Decision: Symlink-based Agent Store Distribution

**Context:** Need to share .claude/ items across projects without duplication.

**Decision:** Central store at .dam-hopper/agent-store/, symlinks to projects.

**Rationale:** No file duplication, easy to add/remove items, clear visibility of distribution.

**Alternative Rejected:** Copy (duplicates), environment variables (harder to manage).

## Roadmap

### Phase 01: IDE File Explorer (Complete)
- ✓ Filesystem sandbox
- ✓ List/read/stat REST endpoints
- ✓ Binary detection

### Phase 02: File Watcher (Complete)
- ✓ inotify integration (Linux), notify crate cross-platform
- ✓ WebSocket subscription + fs:event push
- ✓ Live tree sync on file changes

### Phase 03: IDE Shell (Complete)
- ✓ react-resizable-panels layout (tree | editor | terminal)
- ✓ react-arborist file tree with live sync
- ✓ TanStack Query + useFsSubscription hook
- ✓ /ide lazy route with feature gate

### Phase 04: Monaco Editor + Save (Complete)
- ✓ Monaco integration with tab management
- ✓ Ctrl+S save via 3-phase WS write protocol (begin → chunks → commit)
- ✓ File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary)
- ✓ Mtime-guarded atomic writes (conflict detection)
- ✓ ConflictDialog (overwrite or reload on concurrent edits)
- ✓ LargeFileViewer (range reads), BinaryPreview (hex dump)
- ✓ **Binary Streaming Optimization for Large Files (2026-04-14)**

### Phase 05: Write Operations (In Progress)
- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 06+: Advanced Features (Future)
- [ ] Advanced Terminal (split panes, session persistence, search)
- [ ] Git integration UI (blame, diff)
- [ ] AI assistant integration

## Success Metrics

| Metric | Target | Tracking |
|--------|--------|----------|
| Workspace load time | <200ms | Benchmark tests |
| File explorer response | <100ms (1k items) | API latency logging |
| Zero workspace corruption | 100% | Integration tests |
| Agent item distribution coverage | 100% of enabled projects | Health check |
| Feature gate compliance | 0 disabled endpoints active | Route registration tests |

## Dependencies & Constraints

### External Crates

Core: axum, tokio, serde, serde_json
Operations: git2, portable-pty, notify
Security: subtle (constant-time), walkdir
Workspace: toml

### System Requirements

- Rust 1.70+ (tokio async syntax)
- Node.js 18+ (web build)
- Git 2.0+ (for operations)
- POSIX shell (for command execution)

### Known Limitations

- No native Windows PTY support (portable-pty limitation)
- Max read size: 100MB (hard cap in fs::ops); 128KB per WS chunk
- Max write size: 100MB
- Symbolic link validation may follow platform limits
- Binary files read-only in Phase 04 (no write support)

## Timeline

| Phase | Scope | Status |
|-------|-------|--------|
| 01 | IDE File Explorer | ✓ Complete |
| 02 | File Watcher + WS subscription | ✓ Complete |
| 03 | IDE Shell (layout + tree) | ✓ Complete |
| 04 | Monaco Editor + Save | ✓ Complete (2026-04-14) |
| 05 | Create/delete/move/rename | In Progress |
| 06+ | Advanced features (git UI, AI) | Future |
