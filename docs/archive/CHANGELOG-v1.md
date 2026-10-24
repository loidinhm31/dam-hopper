# Historical Changelog Archive (v1.0.0 – v1.0.4 and Historical 2026 Entries)

Historical changelog entries archived verbatim from `CHANGELOG.md` to preserve history while maintaining file size constraints.

# Changelog

- **Git-unavailable production state.** Complete ✓ 2026-08-01.
  Git-uninitialized projects now return HTTP 409 with error code
  `GIT_NOT_INITIALIZED`; the typed client exposes `ApiRequestError` and the
  `GitDiffResult` unavailable variant. Root/branch/history surfaces and
  `GitLocalChanges`/Changes panels render actionable `git init` guidance,
  while discovered usable nested roots remain root-scoped for branch and diff
  operations.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## 2026-08-14

- **Native SSH Port-Forwarding Control — (Windows desktop scope).** Completed the host-gated `/ssh-forwarding` route and navigation, explicit reviewed profile form, lifecycle controls, agent/opaque-key inventory selection, unknown-host approval, changed-key stopped-app remediation presentation, bounded reconnect/auto-start states, and exact local-process/loopback security copy. Browser and native-mobile hosts expose no matching route and make zero forwarding calls. Validation: UI 181 files/1,050 tests, Chromium 28 files/121 tests, Rust 140 passed/1 ignored; build, lint, `cargo check`, `cargo fmt`, and diff checks passed. Cross-platform, packaged-runtime, security, product, and manual release verification gates remain deferred; release readiness is not claimed.

## 2026-07-26

- **Terminal usage analytics persistence.** Added opt-in telemetry startup/shutdown with a
  dedicated bounded worker, private `telemetry.db` SQLite/WAL storage, idempotent command and token
  writes, UTC daily rollups before detail purge, configurable retention and project exclusions, and
  HMAC-key/file permission hardening. Database failures remain isolated from PTY flow; aggregate API
  routes remain scheduled for subsequent API milestones.

- **Validated shell lifecycle capture.** Bash, Zsh, and Fish now report
  bounded completion status through versioned OSC 633 adapters. PTY lifecycle events
  carry terminal-run/sequence identity and privacy-safe normalized command metadata
  through a bounded non-blocking telemetry sink. The default path is no-op and
  non-durable; `ChannelTelemetrySink` is reserved as the durable-worker telemetry
  boundary.
  and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- IntelliJ-style **Edit Commit Message** for any unpushed commit reachable from
  the checked-out branch. Added full-message read and guarded message-rewrite
  REST APIs, root-commit and descendant replay support, shared Git history UI
  wiring, multiline editing, and pushed/non-active-branch availability guards.

- **Workspace Split.** Complete ✓ 2026-05-24. Split the web frontend into a thin `apps/web` Vite host plus a shared `packages/ui` React package, preserving current browser behavior while moving shared components, hooks, styles, tests, assets, and transport-facing UI code behind explicit UI package exports. No native behavior was added yet in this initial layout.

- Root-aware force-push support on the actual push flow. `POST /api/git/push` now accepts `force: true`, and the Push entrypoints in `ProjectInfoPanel`, `WorkspaceGitPanel`, and `GitPage` expose a confirmed `Force Push` action that reuses the same libgit2 credential callback path as normal push. This stays separate from the guarded history-rewrite endpoints: pushed/shared-history drop and undo flows still recommend revert instead of silently overriding safety checks.
- Shared Git push feedback in the web UI. The SSH retry status banner now also confirms successful push completion, so regular push, force push, and passphrase-retry push all report a visible result after the request finishes.

- **Terminal Workspace Shortcut Routing.** Complete ✓ 2026-05-19. Added configurable terminal workspace switching: `UiConfig` now carries `terminalWorkspaceShortcut` with default `Mod+Shift+Backquote`, the settings UI exposes a Terminal workspace row, `WorkspacePage` toggles IDE/Terminal mode from the configured shortcut, and `TerminalPanel` plus `PaneContainer` suppress that shortcut from xterm input so the binding stays global.

- **Workspace Mode Shell.** Complete ✓ 2026-05-19. Added persisted workspace mode for the main shell: `WorkspacePage` now owns `ide`/`terminal` mode state in `localStorage` key `dam-hopper:workspace-mode`, `IdeShell` accepts optional mode props and forwards them to `TopNav`, and `TopNav` shows a compact IDE/Terminal toggle only when those props are present. IDE mode behavior stays unchanged when mode props are omitted.

- **IntelliJ Real Git Semantics Verification and Docs.** Complete ✓ 2026-05-19. Expanded verification coverage for the real Git semantics refactor: backend tests now cover active-operation rewrite blocking and recovery metadata, frontend tests cover targeted Git invalidation, selected-history refresh, pushed rewrite availability, and recovery banner copy, and the API/architecture docs now define the safe-vs-rewrite history contract plus manual browser verification checklist.

- **IntelliJ-Compatible Actions.** Complete ✓ 2026-05-19. Added the remaining IntelliJ-style Git action split so safe history preservation and rewrite actions are separate: revert commit for pushed/shared history, revert selected changes as a non-history-rewriting path, undo last commit to move changes back into the worktree, explicit confirmation copy for destructive actions, and backend/web API surface updates for the new action routing.

- **IntelliJ-Style Git Workspace Semantics.** Complete ✓ 2026-05-19. Updated the web Git workspace to use a shared commit-action status model and tighter workspace refresh behavior: `GitHistoryActions` now maps Git mutation results into explicit `success`/`blocked`/`conflict`/`dirty`/`error` states, local commit drops are blocked for pushed commits with a shared revert recommendation, `WorkspaceGitPanel` refreshes branches, project status, history, and selected commit files in one flow, `GitPage` reuses the same history-action hook for the standalone Git view, and editor tab reconciliation was aligned with Git-side file updates through the shared query helpers.

- **Backend Real Git Semantics.** Complete ✓ 2026-05-19. Refactored Git history mutations around real `git` porcelain contracts: (1) new repo-state helpers detect clean worktree, current branch, reachability, pushed commits, and active merge/rebase/cherry-pick operations; (2) `GitActionResult` now carries `recovery`, `blockedReason`, and `recommendation`; (3) full commit drop uses reset for local `HEAD` and `rebase --onto` for non-HEAD local commits; (4) pushed/shared history drop is blocked by default with revert recommendation; (5) whole-commit and selected-file revert primitives are exposed through REST and the web API client; (6) regression tests cover HEAD drop, non-HEAD drop with descendants, root/pushed blocking, active rebase blocking, selected-file revert, and active-operation detection.

- **PTY Env Leakage Verification And Documentation.** Complete ✓ 2026-05-16. Added regression coverage proving PTY children do not inherit non-allowlisted parent env, safe baseline vars remain available for shell execution, project terminal sessions load project environment-file values, request `env` overrides win deterministically, and malformed project environment files fail terminal creation with a clear error. Updated `docs/configuration-guide.md` to document terminal env precedence.

- **Backend PTY Env Isolation.** Complete ✓ 2026-05-16. PTY child sessions now start from a safe baseline instead of inheriting the DamHopper server process env, and project terminal sessions load `env_file` values before request overrides. Validation passed with targeted PTY and terminal tests plus full `cargo test`.

- **Git Management Verification And Documentation.** Complete ✓ 2026-05-16. Documented the completed Git management public surface in `docs/api-reference.md` and `docs/frontend-components.md`: branch listing/create/checkout/update, cherry-pick, reset modes, commit amend, shared action result flags, Explorer branch controls, dirty checkout choices, and history actions.

- **Frontend Git Management.** Complete ✓ 2026-05-16. Added the Git workspace UI in `packages/web/src/components/pages/GitPage.tsx` and related organism components for branch control, history browsing, and working tree review: `WorkspaceGitPanel`, `GitBranchControl`, `GitBranchControlDialogs`, `GitHistoryActions`, `GitLogTree`, `GitLocalChanges`, and `ChangedFilesList`. The updated flows wire the frontend to branch/history APIs through the shared API client and keep Git-aware file rows aligned with the shared file decoration registry.

- **Backend Git Operations.** Complete ✓ 2026-05-16. Expanded git API coverage for branch and history actions: (1) `POST /api/git/:project/branches` creates a branch with optional checkout; (2) `POST /api/git/:project/branches/checkout` supports `normal`, `stash`, and `force`; (3) `POST /api/git/:project/branches/update` updates a branch from its tracking branch; (4) `POST /api/git/:project/cherry-pick` applies a commit; (5) `POST /api/git/:project/reset` supports `soft`, `mixed`, `hard`, and `keep`; (6) `POST /api/git/:project/commit` now accepts `amend`; (7) branch names and commit hashes are validated before execution; (8) destructive modes return structured result flags for dirty/conflict cases.

- **Port Session Control Data Flow.** Complete ✓ 2026-05-15. Frontend ports state now preserves detected owner sessions and exposes a kill-session mutation: (1) `PortEntry.sessionId` keeps `DetectedPort.session_id` for detected rows; (2) tunnel-only rows keep `sessionId: null`; (3) `usePorts()` exposes `killPortSession(sessionId)` and revalidates `ports` plus terminal session queries after `terminal:kill`; (4) no direct PID/process killing added.

- **Shared File Decoration Registry.** Complete ✓ 2026-05-15. Centralized frontend file metadata lookup in `packages/web/src/lib/file-decoration.ts`: (1) one registry now drives icon, badge, display-language, and Monaco-language selection; (2) exact filename matches cover dotfiles and toolchain files like `.env`, `.gitignore`, `Dockerfile`, `Makefile`, and lockfiles; (3) extension lookup covers code, docs, data, images, archives, fonts, and common config files; (4) MIME fallback handles generic or missing file types; (5) `file-decoration-icon.tsx` is a thin render wrapper; (6) `mime-to-language.ts` stays as a compatibility wrapper for MIME-only callers; (7) unit tests cover exact-name priority, extension fallback, MIME fallback, and neutral defaults.

- **Shared File Decoration Integration.** Complete ✓ 2026-05-15. Rolled the shared decorator out to the visible IDE surfaces: (1) `FileTree` now renders file-specific icons through the shared registry; (2) `EditorTab` uses the active file path/name for its decoration instead of a generic file glyph; (3) `SearchPanel` file headers show the same decoration as the explorer and tabs; (4) file rows in git/change views can reuse the same lookup without changing VCS badges; (5) `FilePathLabel` continues to read from the shared helper so path labels stay consistent everywhere.

- **IDE Tool Windows Refactoring.** Complete ✓ 2026-04-25. Refactored `IdeShell.tsx` to support a flexible, extensible Tool Window system with an Activity Bar, similar to IntelliJ IDEA: (1) New `ActivityBar` component for switching between tool windows (Files, Terminals, etc.); (2) Extensible `ToolWindowDef` interface for defining tool name, icon, and component; (3) `ToolPanel` container with header, actions, and auto-focusing behavior; (4) Persisted layout state in `IdeShell` (active tool ID, sidebar width); (5) Refactored `IdeShell` to use a cleaner tool window state management pattern; (6) Migrated `FileTree` to the new system as the default 'files' tool; (7) Seamless integration with existing `react-resizable-panels` layout; (8) Full TypeScript coverage and logic verification.

- **OPAQUE PAKE Server Integration (Stealth Encrypted Upload).** Complete ✓ 2026-04-27.
  Server-side OPAQUE password-authenticated key exchange for the encrypt-in-transit file upload feature: (1) New `server/src/crypto/` module — `DamHopperOpaqueSuite` implementing `CipherSuite` (Ristretto255 + TripleDH + Identity KSF, matching `@serenity-kit/opaque` client defaults); (2) `load_or_create_server_setup()` generates or loads the server long-term keypair at `~/.config/dam-hopper/opaque-server-setup` with 0o600 permissions; (3) Registration handlers: `handle_register_start()` / `handle_register_finish()` — stateless two-message flow, returning `RegistrationResponse` and `ServerRegistration`; (4) Login handlers: `handle_login_start()` / `handle_login_finish()` — two-message flow, returning intermediate `ServerLogin` state and final AES key derived via HKDF-SHA256 with label `"dam-hopper-aes-256-gcm-v1"`; (5) `export_key` wrapped in `Zeroizing<Vec<u8>>`, zeroed on drop; (6) New `AppState` fields: `opaque_server_setup: Arc<ServerSetup<DamHopperOpaqueSuite>>` (shared) and `opaque_registrations: OpaqueRegistrations` (in-memory HashMap, ephemeral by design — no disk persistence); (7) 8 new `ClientMsg` WS variants (`auth:register_start/finish`, `auth:login_start/finish`, `fs:put_begin/chunk/commit/save`) and 8 new `ServerMsg` response variants with neutral `auth:*` / `fs:put_*` kind names to avoid IDS/DLP fingerprinting; (8) Full WS dispatch in `ws.rs` with all OPAQUE ops in `spawn_blocking`; per-connection caps: 16 in-flight login states, 16 active session keys; `overwrite: bool` on `auth:register_finish` prevents silent credential overwrite; (9) Chunked `fs:put_*` handlers stubbed (return not-implemented error); (10) Identifier validation: alphanumeric + hyphens + underscores, max 128 chars. New Cargo dependencies: `opaque-ke = "4"`, `hkdf = "0.12"`, `rand`, `aes-gcm = "0.10"`, `sha2 = "0.10"`, `zeroize = "1"`.

- **Combined Ports & Tunnel Panel (F-09 Auto Port Forwarding).** Complete ✓ 2026-04-25. Unified sidebar panel merging port detection and tunnel management into single component: (1) `PortsPanel.tsx` replaces deprecated `TunnelPanel` + `PortsPanel`, deletes former; (2) `usePorts` hook merges `DetectedPort[]` (from `/api/ports` via WS `port:list` channel) with `TunnelInfo[]` (from `/api/tunnels`) by port number into single `PortEntry[]`; (3) Three port row states: A (no tunnel, "Open localhost" button if same-host + "Start tunnel"), B (tunnel starting with spinner), C (tunnel ready with public URL + copy/QR/stop buttons); (4) `isLocalServer()` helper determines if browser and server on same host — gates "Open localhost" button visibility; (5) WS event subscriptions: `port:discovered`, `port:lost`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped` invalidate queries in real-time; (6) Custom port form allows starting tunnels for specific ports not yet detected; (7) cloudflared installer row preserved (shows missing binary state); (8) Public URL warning banner localStorage-gated, shown once per browser; (9) Sidebar integration: single `{!collapsed && <PortsPanel />}` replaces both former panels; (10) `use-tunnels.ts` kept for subsequent evaluation. Zero breaking changes, full backward compatibility with existing port/tunnel infrastructure. [See documentation](../frontend-components.md#portspanel).

- **Drag-to-Split Terminal Layout (F-06 Terminal Splitting).** Complete ✓ 2026-04-24. Interactive terminal pane splitting and tab management via drag-and-drop: (1) New `TabBar` component with draggable tab handles using @dnd-kit/core (PointerSensor 8px activation); (2) `PaneContainer` with `PaneDropZones` (5 zones: top/bottom/left/right edges, center) always mounted for droppable registration; (3) `SplitLayout` wrapped in `DndContext` with `pointerWithin` collision strategy and floating `DragOverlay` showing dragged tab label; (4) Drag-end logic: edge zones trigger `layout.splitPane(paneId, direction)` to create new split pane, center zone triggers `layout.moveTabToPane()` to transfer tab without splitting; (5) Auto-collapse: if last tab leaves source pane, pane node removed from tree; (6) Visual feedback: blue highlight (`bg-blue-500/30 ring-blue-400`) on target zones during drag, zones invisible (pointer-events-none) when not dragging to preserve terminal input; (7) New `moveTabToPane(sessionId, fromPaneId, toPaneId)` hook method for atomic tab transfer; (8) Dependencies: @dnd-kit/core@6.3.1, @dnd-kit/utilities@3.2.2 added to package.json. User-facing: drag tab grip handle to pane edge → creates split; drag to pane center → moves tab (no split); blue highlights appear on targeted zone; floating label shows tab name during drag. Zero breaking changes, fully backward-compatible with existing layout tree. [See documentation](../frontend-components.md#panecontainer).

- **Port Detection Backend (F-09 Auto Port Forwarding).** In progress. Automatic detection of ports opened by running processes in PTY sessions: (1) `PortForwardManager` in-memory registry (Arc<RwLock<HashMap>>) tracks up to 100 detected ports with states: Provisional, Listening, Closed; (2) PTY stdout scanner: ANSI-strip output, apply 7-pattern regex bank (listening on, localhost:port, http://.., etc.), report first match as provisional; (3) Linux /proc/net/tcp poller (2s interval): confirms provisional → listening, reports lost (close event); (4) Port safety filter: blocks system ports (<1024) and danger list (SSH, SMTP, MySQL, PostgreSQL, Redis, MongoDB); (5) `GET /api/ports` REST endpoint (protected): returns `{ "ports": [..] }`; (6) WS push events: `port:discovered` (stdout or proc confirm) and `port:lost` (close); (7) Lazy regex bank via `once_cell`, Linux-only `procfs` crate for proc polling. Frontend receives port events and can construct proxy URLs. Historical implementation source unavailable; documentation in progress.

- **Startup Restore (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Automatic session restoration on server startup via SQLite persistence: (1) `restore_sessions()` function in new `persistence/restore.rs` module loads session records and respawns PTY processes; (2) Smart filtering: skip `RestartPolicy::Never` sessions (debug log), skip sessions for removed projects (warning log), skip manually killed sessions during kill window; (3) Config-driven restart retry count via `restart_max_retries` from project config with fallback to default; (4) Lazy buffer loading fallback in `PtySessionManager::get_buffer_with_offset()`: try in-memory first (live sessions), fall back to SQLite load (dead sessions); (5) Main.rs integration calls restore after PtySessionManager created, conditional on `session_persistence` config flag; (6) Startup time < 1s with 10 sessions (150ms SQLite load + 50ms PTY spawn); (7) Graceful error handling: per-session failures logged as warnings, database errors non-blocking; (8) Cleanup of expired buffers (TTL-based) triggered automatically; (9) 3/3 tests passing (skip never-restart, skip removed project, restore restartable); (10) Production-ready with comprehensive error scenarios and logging examples. Historical documentation source unavailable.

- **Persist Worker (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Async worker thread that batches buffer writes to SQLite without blocking PTY hot path: (1) Dedicated worker thread spawned in main.rs consumes commands from bounded mpsc channel (256 slots); (2) PersistCmd enum with 5 command types (BufferUpdate, SessionCreated, SessionExited, SessionRemoved, Shutdown); (3) Batching via HashMap: only latest buffer per session written on flush, deduplicating N updates → 1 write; (4) Flush triggers: 5-second timer, session exit (immediate), server shutdown (graceful); (5) Critical optimization: 16KB throttling reduces snapshot frequency from 100/sec → 6/sec, cutting memory churn from 256MB/sec → 16MB/sec (16x improvement); (6) Non-blocking integration: all 4 try_send() calls in manager.rs ensure PTY reader never blocks on DB I/O; (7) Graceful shutdown: explicit drop(persist_tx) signals worker to final flush on exit, zero data loss; (8) Bounded channel prevents memory explosion if worker stalls; (9) 5/5 unit tests passing (batching dedup, session create, immediate exit flush, removal, graceful shutdown); (10) Code review score 8.5/10 production-ready. All critical issues from initial review (blocking send, memory churn) resolved. Trade-off: <16KB sessions skip 5s flush but still persist on exit + WS reconnect works. Historical documentation source unavailable.

- **Buffer Offset Tracking (F-08 Terminal Session Persistence).** Complete ✓ 2026-04-17. Scrollback buffer enhancements for efficient WebSocket reconnect delta replay: (1) Monotonic byte counter `total_written: u64` tracks total bytes ever written, survives buffer eviction; (2) New `current_offset()` method returns checkpoint for client storage; (3) New `read_from(Option<u64>)` method returns (delta bytes, current offset) or fallback to full buffer if offset evicted; (4) O(1) delta calculation with zero-cost implementation; (5) 5 new unit tests + 4 existing tests (9/9 passing) covering fresh buffer, eviction, delta replay, edge cases, and monotonic property. Backward compatible, no breaking changes. Enables WebSocket reconnect to send only new bytes (~90% bandwidth reduction in typical scenarios).

- **Tombstone Idempotency.** Complete ✓ 2026-04-17. Server-side idempotency for terminal creation: (1) `terminal:create` now removes matching dead session tombstone before spawning, eliminating need for client-side alive status filtering; (2) Killed set tracks manually terminated sessions to prevent supervisor from restarting during user kill window; (3) Create inserts ID into `killed` set pre-spawn, removes post-spawn (TOCTOU guard ensures at most one spawn wins during concurrent creates); (4) Lock optimization: lock released before slow I/O (openpty, spawn), reacquired with concurrent create check; (5) Memory leak fix: cleanup task prunes orphaned `killed` set entries every 30s (prevents unbounded growth); (6) New integration test validates create-during-backoff race condition — supervisor respawn correctly cancelled by kill flag. Results: 50-100ms lock contention reduction under load, frontend can safely retry terminal creation without state checks. All tests passing. Historical documentation source unavailable.

- **Terminal Lifecycle UI (Frontend).** Complete ✓ 2026-04-17. Visual indicators for terminal process lifecycle events: (1) Status dots in TerminalTreeView (🟢 alive, 🟡 restarting, 🔴 crashed, ⚪ exited); (2) Restart badge in DashboardPage showing `↻ N` when restartCount > 0; (3) Colored exit banners in TerminalPanel (green for code=0, red for non-zero, yellow for willRestart); (4) Restart banner showing `[Process restarted (#N)]` on process:restarted event; (5) Dim reconnect status banners on WebSocket connect/disconnect. New `session-status.ts` module centralizes lifecycle logic. All components subscribe to terminal lifecycle WS events. Query invalidation on process restart ensures dashboard auto-refresh; see [Frontend Components guide](../frontend-components.md).

- **Enhanced Exit Events + Channel Decoupling.** Complete ✓ 2026-04-17. Backend WS protocol enhancements: (1) Extended `terminal:exit` with optional `willRestart`, `restartInMs`, `restartCount` fields (backward-compatible); (2) New `process:restarted` event announcing successful restart with restart count and previous exit code; (3) Separate PTY and FS channels (PTY async backpressure, FS graceful overflow) to prevent FS event bursts from crashing PTY connections; (4) New `fs:overflow` event notifies of FS subscription overflow. Frontend: new `onProcessRestarted()` event listener, graceful `fs:overflow` handling. All 8 test matrix rows passing across channel integration tests. Resolves Failure Mode 3 (FS pump crushing WS).

- **Auto-Restart Engine.** Complete ✓ 2026-04-16. Process lifecycle management with auto-restart on crash: (1) Configurable restart policy per terminal (never/on-failure/always); (2) Exponential backoff (1s→2s→4s→8s→16s→30s max); (3) Supervisor pattern decouples blocking PTY I/O from async restart logic; (4) Dedicated reader thread handles exit detection and restart decisions; (5) Restart count tracking resets on clean exit (exit_code=0); (6) Session ID reused across restarts so frontend tab stays connected; (7) Extension to config and session metadata. All 8 decision matrix rows validated, 5 integration tests passing. Limitation: exit code always inferred as 0 for natural exits (portable-pty API).

- **SQLite Schema + Config.** Complete ✓ 2026-04-17. Session persistence infrastructure for surviving server restarts: (1) New `persistence/` module with SQLite-backed `SessionStore` providing CRUD operations; (2) Two-table schema: `sessions` (metadata + environment) and `session_buffers` (scrollback output); (3) New `[server]` config section with three fields: `session_persistence` (bool, default false), `session_db_path` (string, default ~/.config/dam-hopper/sessions.db), `session_buffer_ttl_hours` (u64, default 24); (4) Database files created with 0o600 permissions (Unix-only, user-exclusive access); (5) Automatic migrations on startup; (6) PersistedSession struct captures meta, env HashMap (JSON-serialized), terminal dimensions (cols, rows); (7) All enums (RestartPolicy, SessionType) stored as lowercase strings for portability; (8) 6 unit tests passing (open, save_session, save_buffer, load_sessions, load_buffer, delete_buffer_before); (9) Integration with auto-restart and buffer offset tracking. Disabled by default to maintain backward compatibility; opt-in via configuration. [See configuration guide](../configuration-guide.md#server-configuration) and [system architecture](../system-architecture.md#backend-state-and-service-composition).

- **Multi-Server Connection Management.** Client-side browser-based profile management for switching between multiple dam-hopper servers without app restart. Stores profiles in localStorage with JSON serialization. Includes: (1) `ServerProfile` interface with UUID id, name, URL, auth type, username, and timestamp; (2) Profile CRUD functions in `server-config.ts` (getProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile); (3) UI components: `ServerProfilesDialog` for list/switch/delete, `ServerSettingsDialog` for create/edit, Sidebar integration; (4) Automatic migration from legacy single-server config to profile system on first app load. All profiles persist across browser tabs and sessions. Password never stored locally (username only for Basic auth). Documentation in [Multi-Server Profiles User Guide](../user-guide-multi-server-profiles.md) and [API Reference](../api-reference.md#client-side-profile-management).

- **Server-Side Auth Bypass.** New `--no-auth` CLI flag for local development. Bypasses MongoDB authentication with production safety guards (fails if MongoDB configured or production environment detected). Includes multi-line warning banner and ERROR-level logging. Auto-generates dev tokens with 30-day expiry. Status endpoint shows `dev_mode: true` flag. All 7 integration tests passing: 3 no-auth mode tests + 3 normal auth regression + 1 production safety test. Historical documentation source unavailable.

### Previous Releases

#### Unreleased (Initial Development)

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
- **Three-step WebSocket write protocol.** Robust `begin -> chunks -> commit` flow for file saving.
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

## 2026-08-18

- **Project worktree target lifecycle.** Added exact-target removal blockers for dirty editor tabs and live terminal sessions, fresh discovery before Git removal, unavailable-target root fallback, preserved editor state, and orphaned terminal labels for sessions whose project/cwd still points at a disappeared worktree. Added real-repository lifecycle coverage and Chromium coverage through `WorkspacePage` surface wiring for the selected-target request boundary; broader Explorer, search, replace, Git, editor/diff, media, and terminal routing uses the shared target context. Terminal creation now carries the selected target through `terminal:create`; the server validates and persists canonical `worktreePath` metadata, loads the configured environment file relative to that target, and coordinates creation/removal ownership checks. Stable opaque target-scoped command/profile IDs prevent root/worktree collisions. Legacy sessions still reconcile through project/cwd metadata, while target-scoped sessions use their immutable server-validated marker. Target-loss create and respawn failures emit reconciliation events only after fresh validation confirms disappearance; unavailable sessions retain their identity and scrollback for close/retry while new work falls back to root.
