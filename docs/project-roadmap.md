# DamHopper Project Roadmap

This document outlines the high-level roadmap for DamHopper development, tracking progress across major phases and milestones.

## Status Overview

- **Current Phase:** Phase 07: Compact Top Navigation (UI/UX Redesign)
- **Last Milestone:** Compact Top Navigation feature completed
- **Total Phases Completed:** 14 phases (F-01 7/7, F-08 5/6, UI/UX 1/1)
- **Next Milestone:** Phase 06: Startup Restore — Load persisted sessions on server restart

## Roadmap Phases

### Phase 01: IDE File Explorer
**Status: [COMPLETED]**
- [x] Filesystem sandbox
- [x] List/read/stat REST endpoints
- [x] Binary detection
- [x] Path validation and security checks

### Phase 07: Compact Top Navigation (UI/UX Redesign)
**Status: [COMPLETED 2026-04-29]**
- [x] Replace vertical Sidebar with horizontal `TopNav`
- [x] Inline menu toggle (Ctrl+B) with glassmorphism
- [x] Adapted `WorkspaceSwitcher` for compact layout
- [x] Vertical layout refactoring (`AppLayout`, `IdeShell`)
- [x] Responsive design and accessibility polish

### Phase 02: File Watcher
**Status: [COMPLETED]**
- [x] inotify integration (Linux) / notify crate (Cross-platform)
- [x] WebSocket subscription + fs:event push
- [x] Live tree sync on file changes
- [x] Debounced events for UI performance

### Phase 03: IDE Shell
**Status: [COMPLETED]**
- [x] react-resizable-panels layout (tree | editor | terminal)
- [x] react-arborist file tree with live sync
- [x] TanStack Query + useFsSubscription hook
- [x] /ide lazy route with feature gate

### Phase 04: Monaco Editor + Save
**Status: [COMPLETED]**
- [x] Monaco integration with tab management
- [x] Ctrl+S save via 3-phase WS write protocol (begin → chunks → commit)
- [x] File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary)
- [x] Mtime-guarded atomic writes (conflict detection)
- [x] ConflictDialog (overwrite or reload on concurrent edits)
- [x] LargeFileViewer (range reads), BinaryPreview (hex dump)
- [x] **Performance Optimization: Binary Streaming for Large Files** (Completed 2026-04-14)
    - [x] Binary protocol for `fsWriteFile`
    - [x] Disk-backed buffering via `NamedTempFile`
    - [x] Optimized client-side transport for binary frames

### Terminal Enhancement Feature (F-01) — Process Lifecycle + Auto-Restart

**Phase 04: Auto-Restart Engine (Backend)**
**Status: [COMPLETED 2026-04-16]**
- [x] Restart policy configuration (never/on-failure/always)
- [x] Exponential backoff logic (1s→30s)
- [x] Supervisor pattern for async restarts
- [x] Restart count tracking (resets on clean exit)
- [x] Session ID reuse across restarts
- [x] All 8 decision matrix rows validated
- [x] 5 integration tests passing

**Phase 05: Enhanced Exit Events + Channel Decoupling (Backend/Frontend WS)**
**Status: [COMPLETED 2026-04-17]**
- [x] Extended `terminal:exit` event with `willRestart`, `restartInMs`, `restartCount`
- [x] New `process:restarted` event
- [x] Separate PTY/FS channels (prevent FS overflow from crashing PTY)
- [x] New `fs:overflow` event for graceful degradation
- [x] Frontend: `onProcessRestarted()` event listener
- [x] All tests passing; Failure Mode 3 (filesystem pump overflow) resolved

**Phase 06: Terminal Lifecycle UI (Frontend)**
**Status: [COMPLETED 2026-04-17]**
- [x] `session-status.ts` helper module (lifecycle status determination)
- [x] Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited)
- [x] Restart badge in DashboardPage (`↻ N` when restartCount > 0)
- [x] Exit banners in TerminalPanel (color-coded by exit code + willRestart)
- [x] Restart banners (`[Process restarted (#N)]`)
- [x] Reconnect status banners (dim, on WS events)
- [x] Query invalidation on process restart
- [x] All manual test scenarios passing
- [x] Unit tests for session-status helpers

**Phase 07: Create Idempotency (Backend)**
**Status: [COMPLETED 2026-04-17]**
- [x] Auto-clean dead session tombstones on terminal:create
- [x] Killed set prevents supervisor from restarting during user kill window
- [x] Idempotent create logic with TOCTOU guard
- [x] Lock optimization (release before slow I/O, reacquire with concurrent check)
- [x] Memory cleanup task for orphaned killed set entries every 30s
- [x] Integration test for create-during-backoff race condition
- [x] All tests passing; 50-100ms lock contention reduction under load

### Terminal Session Persistence Feature (F-08) — WebSocket Reconnect + Delta Replay

**Phase 01: Buffer Offset Tracking (Backend)**
**Status: [COMPLETED 2026-04-17]**
- [x] Monotonic byte counter `total_written: u64` to track cumulative bytes written
- [x] `current_offset()` method for client checkpoint storage
- [x] `read_from(Option<u64>)` method for efficient delta replay
- [x] O(1) delta calculation with zero overhead
- [x] Graceful fallback to full buffer when offset evicted
- [x] 5 new unit tests + 4 existing tests (9/9 passing)
- [x] Backward compatible, all regression tests pass
- [x] Documentation: Quick start guide + technical implementation + completion summary

**Phase 02: WebSocket Reconnect Handler (Planned)**
- [ ] Accept `last_offset` on reconnect message
- [ ] Call `buffer.read_from()` to get delta
- [ ] Send (delta bytes, new offset) to client
- [ ] Client updates terminal with only new bytes
- [ ] Measures: ~90% bandwidth reduction vs full buffer resend

**Phase 03: Frontend Reconnect UI (Planned)**
- [ ] Implement xterm.js terminal reconnect UI
- [ ] Session recovery on WebSocket reconnect
- [ ] Visual status indicators during reconnect
- [ ] Graceful fallback to full buffer on replay

**Phase 04: SQLite Schema + Config (Backend)**
**Status: [COMPLETED 2026-04-17]**
- [x] Added rusqlite dependency
- [x] Created persistence module with SessionStore CRUD operations
- [x] Created SQL schema with sessions and session_buffers tables
- [x] Added ServerConfig to config schema with session_persistence, session_db_path, session_buffer_ttl_hours
- [x] Parse [server] section in config loader
- [x] Initialize SessionStore in main.rs when enabled
- [x] 6 unit tests passing (all CRUD operations covered)
- [x] Code review score: 9/10 (after critical fixes)
- [x] Security: Database file permissions (0o600), SQL injection prevention
- [x] Files: 12 files created/modified, ~480 lines

**Phase 05: Persist Worker (Completed 2026-04-17)**
- [x] Implement background worker for periodic session snapshots
- [x] Buffer flushing to SQLite on configurable interval
- [x] TTL-based buffer cleanup
- [x] Integration with SessionStore
- [x] 5/5 tests passing
- [x] Code review: 9/10, all critical issues resolved
- [x] Production ready for Phase 06

**Phase 06: Startup Restore (Planned)**
- [ ] Load persisted sessions on server startup
- [ ] Restore buffer content to memory
- [ ] Maintain session IDs across restarts
- [ ] Handle corrupted database gracefully

**Phase 07-Additional Session Persistence Features (Planned)**
- [ ] Session snapshots (save/restore terminal state)
- [ ] Offline replay (queue commands during disconnect)
- [ ] Cross-browser session recovery
- [ ] History search and replay UI

### Phase 05: Write Operations
**Status: [PLANNED]**
- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 06+: Advanced Features
**Status: [PLANNED]**
- [ ] Advanced Terminal (split panes, session persistence, search)
- [ ] Git integration UI (blame, diff)
- [ ] AI assistant integration (Gemini/Claude)
- [ ] Multi-workspace management UI

## Recent Milestones

- **2026-04-29:** Completed Compact Top Navigation Redesign.
    - ✅ Replaced vertical sidebar with horizontal `TopNav`
    - ✅ Maximized vertical space for terminal and editor
    - ✅ Implemented glassmorphism and modern toggle menu
    - ✅ Refactored `AppLayout` and `IdeShell` for vertical stacking
    - ✅ Repurposed `Ctrl+B` for top menu visibility

- **2026-04-25:** Completed IDE Tool Windows Refactoring.
    - ✅ Flexible Tool Window system with Activity Bar (IntelliJ style)
    - ✅ Extensible `ToolWindowDef` for new tool integrations
    - ✅ Persisted layout state (sidebar width, active tool)
    - ✅ Refactored `IdeShell` for better state management
    - ✅ Migrated File Tree to the new system

- **2026-04-17:** Completed Phase 05: Persist Worker (F-08 Terminal Session Persistence).
    - ✅ Background worker for async session snapshots
    - ✅ Buffer flushing to SQLite on configurable interval (default 5s)
    - ✅ TTL-based buffer cleanup (default 24h)
    - ✅ Integration with SessionStore for CRUD operations
    - ✅ 5/5 persistence worker tests passing
    - ✅ Critical issues resolved: try_send() hot path, buffer cloning optimization, field cleanup
    - ✅ Code review score: 9/10, approved for merge
    - ✅ 0 critical issues, 0 warnings
    - ✅ Production ready for Phase 06 (Startup Restore)

- **2026-04-17:** Completed Phase 01-04: Session Persistence Infrastructure (F-08).
    - ✅ Phase 01: Buffer Offset Tracking — Monotonic byte counter, delta replay API
    - ✅ Phase 02: Protocol Extension — `terminal:attach` and `terminal:buffer` messages
    - ✅ Phase 03: Frontend Reconnect UI — xterm.js reconnect, "Reconnecting..." overlay, 3s timeout fallback
    - ✅ Phase 04: SQLite Schema + Config — sessions and session_buffers tables, ServerConfig extension
    - ✅ Backend: 128/128 tests passing
    - ✅ Frontend: 0 type errors, production ready

- **2026-04-17:** Completed Phase 01: Buffer Offset Tracking (F-08 Terminal Session Persistence).
    - ✅ Monotonic byte counter `total_written: u64` tracks cumulative bytes written
    - ✅ `current_offset()` method returns checkpoint for client storage
    - ✅ `read_from(Option<u64>)` method provides delta replay API
    - ✅ O(1) delta calculation, zero performance overhead
    - ✅ Graceful fallback to full buffer when offset evicted
    - ✅ 9/9 tests passing (5 new + 4 existing)
    - ✅ Backward compatible, no breaking changes
    - ✅ Enables Phase 02 WebSocket reconnect with ~90% bandwidth reduction

- **2026-04-17:** Completed Terminal Enhancement Phases 04–07 (F-01 series).
    - **Phase 06: Terminal Lifecycle UI (Frontend)**
        - ✅ Status dots (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited)
        - ✅ Restart badge (`↻ N`) in DashboardPage
        - ✅ Exit/restart/reconnect banners in TerminalPanel
        - ✅ ANSI color-coded banners (green/red/yellow/dim)
        - ✅ Query invalidation on `process:restarted`
        - ✅ All 7 manual test scenarios passing
        - ✅ New `session-status.ts` helper module with unit tests
    - **Phase 05: Enhanced Exit Events + Channel Decoupling (2026-04-17)**
        - ✅ Extended `terminal:exit` with `willRestart`, `restartInMs`, `restartCount` (backward-compatible)
        - ✅ New `process:restarted` event
        - ✅ Separate PTY/FS channels (prevent FS overflow from crashing PTY connections)
        - ✅ New `fs:overflow` degradation event
        - ✅ Frontend: `onProcessRestarted()` listener
        - ✅ Resolves Failure Mode 3 (FS pump overflow)
    - **Phase 04: Auto-Restart Engine (2026-04-16)**
        - ✅ Configurable restart policy (never/on-failure/always)
        - ✅ Exponential backoff (1s→2s→4s→8s→16s→30s max)
        - ✅ Supervisor pattern for safe async restarts
        - ✅ Restart count tracking (resets on clean exit)
        - ✅ Session ID reuse (frontend stays connected)
        - ✅ All 8 decision matrix rows validated
        - ✅ 5 integration tests passing

- **2026-04-16:** Completed Phase 01: Multi-Server Auth Bypass.
    - ✅ Added `--no-auth` CLI flag for dev mode authentication bypass
    - ✅ Updated AppState with `no_auth: bool` field
    - ✅ Modified auth middleware, login handler, and status endpoint
    - ✅ Added production safety guards (panics if no_auth + MongoDB or prod env)
    - ✅ Created 7 integration tests (all passing)
    - ✅ Code reviewed: 9.5/10 (critical security issue resolved)

- **2026-04-14:** Implemented Binary Streaming for Large File Writes.
    - Switched `fsWriteFile` from base64 text frames to zero-overhead binary frames for large files.
    - Introduced `NamedTempFile` buffering on the server to prevent RAM spikes during large saves.
    - Updated `ws-transport.ts` to support the hybrid JSON+Binary protocol.

- **2026-04-09:** Completed Phase 04: Monaco Editor + Save.
- **2026-03-25:** Completed Phase 03: IDE Shell.

## Success Metrics Tracking

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Workspace load time | <200ms | ~150ms | ✓ Passing |
| File explorer response | <100ms | ~45ms | ✓ Passing |
| Large file save (10MB) | <2s | ~1.2s | ✓ Passing |
| Memory usage (10MB save) | Constant | Constant | ✓ Passing |
