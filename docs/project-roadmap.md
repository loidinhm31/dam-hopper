# DamHopper Project Roadmap

This document outlines the high-level roadmap for DamHopper development, tracking progress across major phases and milestones.

## Status Overview

- **Current Phase:** Safe Inline Terminal Suggestions Phase 05: Release Validation, Documentation, and Rollout (completed 2026-07-16 +07; review approved)
- **Last Milestone:** Completed automated release validation, documentation, and fail-closed rollout preparation
- **Total Phases Completed:** 23 phases (F-01 7/7, F-08 5/6, UI/UX 1/1, Tauri shared UI 5/5, terminal notification center 1/1, inline terminal suggestions 5/5 complete)
- **Next Milestone:** Complete external release checks: real zsh/fish/Bash PTY, IME, screen-reader, and WebGL/renderer validation

## Roadmap Phases

### Phase 01: IDE File Explorer

**Status: [COMPLETED 2026-05-15]**

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

### Phase 02: Terminal Workspace Shortcut Routing

**Status: [COMPLETED 2026-05-19]**

- [x] Added configurable `terminalWorkspaceShortcut` to Rust `UiConfig` and TS UI config defaults
- [x] Exposed Terminal workspace shortcut in Settings Keyboard Shortcuts
- [x] Wired `WorkspacePage` to toggle IDE/Terminal modes from the configured shortcut
- [x] Suppressed the shortcut from `TerminalPanel` and `PaneContainer` xterm input
- [x] Validation passed: `pnpm --filter @dam-hopper/web test -- --run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts`, `pnpm build`, `cargo test ui_config`

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
- [x] replay API with `reset`/`truncated` metadata for efficient delta replay
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
- [x] Added ServerConfig to config schema with session_db_path and session_buffer_ttl_hours
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

- **2026-07-17:** Completed context-menu placement Phase 02: consumer migration.
  - ✅ Routed the existing context-menu consumers through the shared Radix foundation with forwarded trigger refs.
  - ✅ Kept branch `Select` isolated from the generic context-menu trigger path.
  - ✅ Lifted the diagnostics trigger into dedicated consumer wiring; Phase 01 foundation stays unchanged.

- **2026-07-17:** Completed context-menu placement Phase 03: unit and component verification.
  - ✅ Marked Radix wrapper and consumer coverage complete in the Phase 03 plan.
  - ✅ Recorded Phase 03 status as Done with 2026-07-17 23:17 +0700 timestamp.

- **2026-07-17:** Completed context-menu placement Phase 01: Radix shared foundation.
  - ✅ Added direct `@radix-ui/react-context-menu` integration with body-only portal protection, `Trigger asChild`, collision defaults, and available-space sizing.
  - ✅ Added module-scoped one-open coordination and capture-level scroll close without app-wide state.
  - ✅ Added JSDOM wrapper, lifecycle, and five-category trigger compatibility coverage; UI validation passed: 107 files / 556 tests and TypeScript check.
  - ⏭️ Phase 02 will migrate the seven existing context-menu consumers; Phase 03/04 retain keyboard/focus and Chromium geometry regression coverage.

- **2026-07-16:** Completed Codex terminal notification replay Phase 01: Replay-safe delivery lifecycle (review approved 13:14 +07).
  - ✅ Replayed OSC 9 is suppressed until xterm reports buffer-write completion; concurrent live chunks flush in order afterward.
  - ✅ Focused lifecycle and affected UI validation passed; Phase 02 regression coverage remains pending.

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 03: Suggestion Controller and History/Search Separation (review approved 05:07 +07).

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 05: Release Validation, Documentation, and Rollout (review approved).
  - ✅ Automated validation passed for the shipped inline-suggestion behavior and documentation/rollout work
  - ✅ Automatic suggestions remain fail-closed and retain the immediate kill switch and unsupported-session fallback
  - ⚠️ External release gates remain: manual real-PTY zsh/fish/Bash, IME, screen-reader, and WebGL/renderer checks; none are claimed completed

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 02: Verified Shell Lifecycle Integration.
  - ✅ Added per-PTY-incarnation nonce-backed lifecycle validation and zsh/fish launch adapters
  - ✅ Added bounded OSC 633 parsing with legal transition checks, exact validated command capture, and malformed-byte preservation
  - ✅ Broadcast lifecycle state/generation without serializing the nonce; reset trust on reattach, respawn, invalid markers, and TUI alternate buffers
  - ✅ Kept unsupported shells fail-closed; Bash support uses guarded exact-command capture
  - ✅ Validation passed: focused shell lifecycle parser tests (7/7) and lifecycle protocol coverage

- **2026-07-16:** Completed Safe Inline Terminal Suggestions Phase 01: Security containment and history privacy.
  - ✅ Removed PTY-silence authorization, automatic overlay rendering, input interception, and automatic command recording
  - ✅ Kept all native terminal input byte-for-byte passive while automatic suggestions are unavailable
  - ✅ Added browser-local history clear/disable controls and preserved exact commands for direct API writes
  - ✅ Retained legacy browser history unchanged with no automatic purge; users may clear it explicitly in Settings
  - ✅ Validation passed: focused containment, capability, command-history, prompt-detector, and settings tests

- **2026-07-16:** Completed Codex Terminal Notification Center.
  - ✅ Added bounded session-only notification history with unread badge, item read, mark-all-read, and clear actions
  - ✅ Added responsive top-right bell/feed and a maximum-three toast viewport with automatic and manual dismissal
  - ✅ Preserved native browser notifications while ensuring denied native permission cannot suppress in-app delivery
  - ✅ Reused terminal selection navigation and kept the existing Codex notification setting as the master gate
  - ✅ Validation passed: UI TypeScript compile, 93 files / 482 UI tests, 2 files / 10 browser tests, changed-file ESLint, and feature diff/whitespace checks
  - ⚠️ Root lint remains blocked by three unrelated pre-existing errors in `EditorTabs.tsx` and `use-coarse-pointer.ts`

- **2026-07-14:** Completed Explorer Copy Path context menu (Copy Absolute / Copy Relative Path on file-tree right-click; pure helpers + unit tests; native separators; 422 tests passing).
- **2026-07-09:** Completed Phase 03 TerminalPanel xterm integration for xterm agent notifications.
  - ✅ Wired BEL, OSC, output, command, and exit events into the notification tracker
  - ✅ Final review approved by user, score 9.3/10
  - ✅ No critical issues or warnings

- **2026-05-26:** Completed Tauri v2 Shared UI Native Phase 05: Verification And Documentation.
  - ✅ Fixed compact workspace hook/lint regressions in `WorkspacePage` without changing desktop shell behavior
  - ✅ Revalidated shared, UI, web, native, root build, and lint targets
  - ✅ Updated system architecture, codebase summary, frontend components, and configuration docs for the `apps/web` + `apps/native` + `packages/ui` split
  - ⚠️ Documented remaining manual validation blockers: Tauri Linux prerequisites, sandboxed browser probing limits, and local no-auth server env/persistence issues

- **2026-05-25:** Completed Tauri v2 Shared UI Native Phase 04: Responsive Companion Layout.
  - ✅ Added compact workspace responsive behavior with `MobileWorkspaceShell`, shared compact breakpoint helpers, and safe-area/dynamic-height CSS primitives
  - ✅ Reused existing editor, terminal, fleet, ports, Git, and project surfaces without duplicating business logic or PTY lifecycle
  - ✅ Added terminal refit/layout revision handling for compact surface switches and hardened empty-surface mobile shell behavior
  - ✅ Fixed TopNav compact/tablet behavior, selector layering, project/branch visibility on small screens, and compact connection/status typography
  - ✅ Validation passed: `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, and `pnpm dev` boot verification

- **2026-05-25:** Completed Tauri v2 Shared UI Native Phase 02: Shared Logger And Runtime Utilities.
  - ✅ Added dependency-free `@dam-hopper/shared` logger package with scoped `debug/info/warn/error` calls
  - ✅ Added recursive sensitive metadata redaction before sink delivery, plus focused logger tests
  - ✅ Configured web bootstrap log level from Vite env with dev `debug` and production `warn` fallback
  - ✅ Replaced direct `console` usage in high-value transport, auth, terminal, dashboard, error-boundary, and filesystem paths
  - ✅ Validation passed: `pnpm --filter @dam-hopper/shared test`, `pnpm --filter @dam-hopper/shared build`, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/web build`

- **2026-05-24:** Completed Tauri v2 Shared UI Native Phase 01: Workspace Split.
  - ✅ Split the frontend into `apps/web` thin host and `packages/ui` shared React UI package
  - ✅ Preserved browser behavior while moving transport, components, styles, tests, and assets into the shared UI package
  - ✅ Added package exports for `DamHopperApp` and shared styles, with the host owning transport/query bootstrapping
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web build`, `pnpm --filter @dam-hopper/web exec tsc -p tsconfig.json`, `pnpm --filter @dam-hopper/ui build`, `pnpm --filter @dam-hopper/ui test`

- **2026-05-20:** Completed Terminal Workspace Docking Phase 05.
  - ✅ Verified `pnpm --filter @dam-hopper/web test`, `pnpm build`, and focused Rust `ui_config` tests
  - ✅ Real-browser verification caught a swapped split-action mapping in the terminal tab bar
  - ✅ Fixed `Split Right`/`Split Down` direction wiring and added a focused regression test
  - ✅ Kept Ports visible in Terminal mode below Fleet Terminal for development port access
  - ✅ Documented terminal workspace persistence keys and runtime verification boundaries

- **2026-05-19:** Completed Terminal Workspace Docking Phase 02.
  - ✅ Added configurable terminal workspace shortcut with default `Mod+Shift+Backquote`
  - ✅ Moved shortcut config through Rust UiConfig, TS UiConfig, and settings UI
  - ✅ Made `Ctrl+Backquote` exact so new-terminal no longer conflicts
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web test -- --run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts`, `pnpm build`, `cargo test ui_config`

- **2026-05-20:** Completed Terminal Workspace Docking Phase 04.
  - ✅ Added intent-based docking targets for pane center, pane edge, and tab insertion index
  - ✅ Added labeled pane docking previews and stronger drag overlay context
  - ✅ Added tab reorder and cross-pane insertion behavior without PTY remount changes
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web exec vitest run src/lib/terminal-layout-docking.test.ts`, `pnpm --filter @dam-hopper/web build`

- **2026-05-19:** Completed Terminal Workspace Docking Phase 01.
  - ✅ Workspace mode state added for IDE/Terminal shell switching
  - ✅ Top nav toggle wired through `WorkspacePage`, `IdeShell`, and `TopNav`
  - ✅ Validation passed: `pnpm --filter @dam-hopper/web test` (123/123), `pnpm build`

- **2026-05-19:** Completed IntelliJ-Compatible Actions Phase 03.
  - ✅ Added safe revert path for pushed/shared commits
  - ✅ Split revert selected changes from drop selected changes
  - ✅ Added undo last commit semantics for local rewrite recovery
  - ✅ Confirmation copy now separates safe vs destructive Git actions
  - ✅ Status updated in plan and phase docs

- **2026-05-16:** Completed PTY Env Leakage Fix Phase 01.
  - ✅ PTY child env now starts from a safe baseline instead of inheriting server process env
  - ✅ Project `env_file` values load into terminal sessions before request overrides
  - ✅ Validation passed: `cargo test --manifest-path server/Cargo.toml pty`, `cargo test --manifest-path server/Cargo.toml terminal`, full `cargo test`

- **2026-05-16:** Completed PTY Env Leakage Fix Phase 02.
  - ✅ Added PTY regressions for synthetic parent-env leakage and safe-baseline shell vars
  - ✅ Added API coverage for project environment-file loading, override precedence, and malformed-file rejection
  - ✅ Documented terminal env precedence in `docs/configuration-guide.md` and recorded completion in `docs/CHANGELOG.md`
  - ✅ Full verification passed: `cargo test --manifest-path server/Cargo.toml`

- **2026-05-15:** Completed Control Running Ports Phase 02.
  - ✅ `PortsPanel` now exposes a confirmed kill action for detected ports with owner sessions
  - ✅ `usePorts()` kill mutation revalidates ports and terminal session data
  - ✅ Validation passed: web build + web tests

- **2026-05-15:** Completed File Extension Decorations Phase 01.
  - ✅ Shared file decoration registry added in `packages/web/src/lib`
  - ✅ MIME fallback compatibility kept in `mime-to-language.ts`
  - ✅ Unit coverage added for exact-name, extension, and fallback cases

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
  - ✅ Replay API provides delta/full snapshot metadata
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

| Metric                   | Target   | Current  | Status    |
| ------------------------ | -------- | -------- | --------- |
| Workspace load time      | <200ms   | ~150ms   | ✓ Passing |
| File explorer response   | <100ms   | ~45ms    | ✓ Passing |
| Large file save (10MB)   | <2s      | ~1.2s    | ✓ Passing |
| Memory usage (10MB save) | Constant | Constant | ✓ Passing |
