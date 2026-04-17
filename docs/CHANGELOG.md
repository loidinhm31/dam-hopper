# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Phase 07: Tombstone Idempotency.** Complete ✓ 2026-04-17. Server-side idempotency for terminal creation: (1) `terminal:create` now removes matching dead session tombstone before spawning, eliminating need for client-side alive status filtering; (2) Killed set tracks manually terminated sessions to prevent supervisor from restarting during user kill window; (3) Create inserts ID into `killed` set pre-spawn, removes post-spawn (TOCTOU guard ensures at most one spawn wins during concurrent creates); (4) Lock optimization: lock released before slow I/O (openpty, spawn), reacquired with concurrent create check; (5) Memory leak fix: cleanup task prunes orphaned `killed` set entries every 30s (prevents unbounded growth); (6) New integration test validates create-during-backoff race condition — supervisor respawn correctly cancelled by kill flag. Results: 50-100ms lock contention reduction under load, frontend can safely retry terminal creation without state checks. All tests passing. [See Phase 07 documentation](./phase-07-create-idempotency.md).

- **Phase 06: Terminal Lifecycle UI (Frontend).** Complete ✓ 2026-04-17. Visual indicators for terminal process lifecycle events: (1) Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited); (2) Restart badge in DashboardPage showing `↻ N` when restartCount > 0; (3) Colored exit banners in TerminalPanel (green for code=0, red for non-zero, yellow for willRestart); (4) Restart banner showing `[Process restarted (#N)]` on process:restarted event; (5) Dim reconnect status banners on WebSocket connect/disconnect. New `session-status.ts` module centralizes lifecycle logic. All components subscribe to Phase 5 WS events. Query invalidation on process restart ensures dashboard auto-refresh. [See Phase 06 documentation](./phase-06-frontend-lifecycle-ui.md) and [Frontend Components guide](./frontend-components.md).

- **Phase 05: Enhanced Exit Events + Channel Decoupling.** Complete ✓ 2026-04-17. Backend WS protocol enhancements: (1) Extended `terminal:exit` with optional `willRestart`, `restartInMs`, `restartCount` fields (backward-compatible); (2) New `process:restarted` event announcing successful restart with restart count and previous exit code; (3) Separate PTY and FS channels (PTY async backpressure, FS graceful overflow) to prevent FS event bursts from crashing PTY connections; (4) New `fs:overflow` event notifies of FS subscription overflow. Frontend: new `onProcessRestarted()` event listener, graceful `fs:overflow` handling. All 8 test matrix rows passing (Phase 04 integration). Resolves Failure Mode 3 (FS pump crushing WS). [See Phase 05 documentation](./phase-05-ws-events-channel-split.md).

- **Phase 04: Auto-Restart Engine.** Complete ✓ 2026-04-16. Process lifecycle management with auto-restart on crash: (1) Configurable restart policy per terminal (never/on-failure/always); (2) Exponential backoff (1s→2s→4s→8s→16s→30s max); (3) Supervisor pattern decouples blocking PTY I/O from async restart logic; (4) Dedicated reader thread handles exit detection and restart decisions; (5) Restart count tracking resets on clean exit (exit_code=0); (6) Session ID reused across restarts so frontend tab stays connected; (7) Extension to config and session metadata (Phase 3). All 8 decision matrix rows validated, 5 integration tests passing. Limitation: exit code always inferred as 0 for natural exits (portable-pty API). [See Phase 04 documentation](./phase-04-restart-engine.md).

- **Phase 02: Multi-Server Connection Management.** Client-side browser-based profile management for switching between multiple dam-hopper servers without app restart. Stores profiles in localStorage with JSON serialization. Includes: (1) `ServerProfile` interface with UUID id, name, URL, auth type, username, and timestamp; (2) Profile CRUD functions in `server-config.ts` (getProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile); (3) UI components: `ServerProfilesDialog` for list/switch/delete, `ServerSettingsDialog` for create/edit, Sidebar integration; (4) Automatic migration from legacy single-server config to profile system on first app load. All profiles persist across browser tabs and sessions. Password never stored locally (username only for display). Auth tokens remain in sessionStorage (cleared on tab close for security). [See Phase 02 documentation](./user-guide-multi-server-profiles.md) and [API Reference](./api-reference.md#client-side-profile-management-phase-2).

- **Phase 01: Server-Side Auth Bypass.** New `--no-auth` CLI flag for local development. Bypasses MongoDB authentication with production safety guards (fails if MongoDB configured or production environment detected). Includes multi-line warning banner and ERROR-level logging. Auto-generates dev tokens with 30-day expiry. Status endpoint shows `dev_mode: true` flag. All 7 integration tests passing: 3 no-auth mode tests + 3 normal auth regression + 1 production safety test. [See Phase 01 documentation](./phase-01-server-auth-bypass/index.md).

### Previous Releases

#### Unreleased (before Phase 01)

### Added
- **Binary streaming for FsWriteFile protocol.** This feature allows for more efficient writing of large files (>5MB) by using binary frames instead of base64 encoded text frames, reducing bandwidth overhead by ~33%.
- **Disk-backed buffering on the server.** The server now uses `NamedTempFile` for buffering `fsWriteFile` chunks, preventing memory spikes for large saves.
- **Client-side binary transport.** Updated `ws-transport.ts` to support the hybrid JSON+Binary frame protocol.
- **Improved Optimistic Concurrency Control (OCC).** mtime and size enforcement are now more robust and verified with extensive tests.

### Fixed
- **Large file RAM spike during saves.** Previously, the server buffered all chunks in RAM, leading to potential OOM for large files.

### Changed
- **Default encoding for large file writes.** Switched from base64 text frames to binary WebSocket frames for better efficiency.

## [1.0.4] - 2026-04-09

### Added
- **Monaco Editor integration.** Full-featured editor with syntax highlighting and tab management.
- **3-phase WebSocket write protocol.** Robust `begin -> chunks -> commit` flow for file saving.
- **File tiering.** Automatic handling of different file types and sizes (normal, degraded, large, binary).
- **Mtime-guarded atomic writes.** Prevents data loss during concurrent edits.
- **ConflictDialog.** User-friendly handling of save conflicts (overwrite vs reload).
- **LargeFileViewer.** Efficient viewing of files > 5MB via range reads.
- **BinaryPreview.** Hex dump viewer for binary files.

## [1.0.3] - 2026-03-25

### Added
- **IDE Shell layout.** Responsive layout using `react-resizable-panels`.
- **Live file tree.** Syncs in real-time with filesystem changes.
- **TanStack Query hooks.** Robust data fetching and FS subscription management.
- **Feature-gated /ide route.**

## [1.0.2] - 2026-03-10

### Added
- **File watcher.** notify-based real-time notifications for file system events.
- **WebSocket event push.** Efficiently pushes FS events to connected clients.
- **inotify-based debouncing.** Prevents event storms on large file changes.

## [1.0.1] - 2026-02-28

### Added
- **IDE File Explorer REST API.** Endpoints for listing, reading, and stating files.
- **Filesystem sandbox.** Secure path validation to prevent traversal.
- **Binary file detection.** Automatic identification of binary files using MIME guessing.

## [1.0.0] - 2026-02-15

### Added
- Initial release of DamHopper.
- Workspace management and project auto-discovery.
- PTY terminal session management.
- Bulk git operations.
- Agent store distribution via symlinks.
