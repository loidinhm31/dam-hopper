# Dev-Hub Project Overview & PDR

## Project Vision

Dev-Hub is a **workspace-first IDE assistant** that manages multiple projects within a single workspace, providing integrated terminal management, file exploration, and AI-powered agent distribution.

Target users: Developers managing monorepos or multi-project workspaces who want a lightweight, AI-friendly interface for common development tasks.

## Core Product Requirements

### PR-001: Workspace Management

**Functional Requirements:**
- Support TOML-based workspace configuration (dev-hub.toml)
- Auto-discover projects by type (Maven, Gradle, npm, pnpm, Cargo, custom)
- Hot-reload workspace config without restart
- Store global defaults at ~/.config/dev-hub/config.toml

**Acceptance Criteria:**
- ✓ Load and parse dev-hub.toml
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

**Acceptance Criteria:**
- ✓ Spawn new PTY session with UUID
- ✓ Broadcast output to multiple subscribers
- ✓ Retain buffer for live sessions only
- ✓ Graceful shutdown (SIGTERM → SIGKILL)

**Technical Constraints:**
- portable-pty for cross-platform compatibility
- Tokio broadcast channels for fan-out
- Server-Sent Events or WebSocket for output streaming

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
- SSH key storage in ~/.config/dev-hub/credentials/
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
- Feature-gated: ide_explorer flag in dev-hub.toml or DEV_HUB_IDE=1 env
- Max read: 10MB per request (configurable)
- MIME type detection via mime_guess crate
- Async I/O via tokio::fs

**Future (Phase 02):**
- File watcher (inotify) for live updates
- Create/delete/move operations
- Write permissions (read-only in Phase 01)

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
- Store path: .dev-hub/agent-store/
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

### Decision: Feature-gated IDE Explorer

**Context:** File exploration may not be needed in all deployments; reduces attack surface.

**Decision:** IDE endpoints are conditional on ide_explorer feature flag.

**Rationale:** Can be disabled at build/deploy time or via config.

**Alternative Rejected:** Always-on endpoints (harder to disable in security-sensitive environments).

### Decision: Symlink-based Agent Store Distribution

**Context:** Need to share .claude/ items across projects without duplication.

**Decision:** Central store at .dev-hub/agent-store/, symlinks to projects.

**Rationale:** No file duplication, easy to add/remove items, clear visibility of distribution.

**Alternative Rejected:** Copy (duplicates), environment variables (harder to manage).

## Roadmap

### Phase 01: IDE File Explorer (Complete)
- ✓ Filesystem sandbox
- ✓ List/read/stat endpoints
- ✓ Binary detection
- ✓ Feature gating

### Phase 02: File Watcher
- [ ] inotify integration (Linux), FSEvents (macOS), ReadDirectoryChangesW (Windows)
- [ ] WebSocket push on file change
- [ ] Diff visualization for modified files

### Phase 03: Write Operations
- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 04: Merge Conflict UI
- [ ] Detect merge conflicts
- [ ] Visual 3-way diff
- [ ] Conflict resolution helpers

### Phase 05: Advanced Terminal
- [ ] Split panes (horizontal/vertical)
- [ ] Session persistence
- [ ] Command history search

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
- Max read size: 10MB per request (prevent DoS)
- Symbolic link validation may follow platform limits
- Agent store path not updated on workspace:switch (Phase 06 fix)

## Timeline

| Phase | Scope | Est. Duration |
|-------|-------|---|
| 01 | IDE File Explorer | 2 weeks |
| 02 | File Watcher | 1 week |
| 03 | Write Operations | 2 weeks |
| 04 | Merge Conflict UI | 2 weeks |
| 05 | Advanced Terminal | 3 weeks |
