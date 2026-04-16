# DamHopper Project Roadmap

This document outlines the high-level roadmap for DamHopper development, tracking progress across major phases and milestones.

## Status Overview

- **Current Phase:** Phase 07: Create Idempotency (Planned)
- **Last Milestone:** Phase 06: Terminal Lifecycle UI (Completed 2026-04-17)
- **Total Phases Completed:** 6 out of 7 (Terminal Enhancement F-01 series)
- **Next Milestone:** Phase 07: Server-side session cleanup on terminal create

## Roadmap Phases

### Phase 01: IDE File Explorer
**Status: [COMPLETED]**
- [x] Filesystem sandbox
- [x] List/read/stat REST endpoints
- [x] Binary detection
- [x] Path validation and security checks

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
**Status: [PLANNED]**
- [ ] Auto-clean dead session tombstones on terminal:create
- [ ] Simplify reconnect logic (no need for Phase 1 alive check)
- [ ] Reduce session state explosion

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

- **2026-04-17:** Completed Terminal Enhancement Phases 04–06 (F-01 series).
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
