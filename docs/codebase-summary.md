# DamHopper Codebase Summary

This document provides a high-level overview of the current repository. Historical phase records are retained where useful; phase labels and test counts below are not release guarantees unless explicitly dated.

## Project Overview

**DamHopper** is a workspace management system for agent-based development. It combines a Rust backend server with split frontend hosts (`apps/web` for browser, `apps/native` for Tauri) that both reuse a shared React UI package (`packages/ui`) to provide an integrated environment for workspaces, agents, terminals, file operations, and optional Browser Debug.

**Repository Structure**:

- Repomix snapshot (2026-09-03): 1,541 files and 3,173,280 tokens packed into
  `repomix-output.xml`; five security-sensitive files were excluded by the
  compaction security check.
- Predominantly Rust (server) and TypeScript/React (web). The Linux release
  package includes the `dam-hopper` manager and `dam-hopper-web` binaries;
  the web host is declared in the same Cargo package for lockstep versioning.

## Current Frontend Shared Logic

- **Shared Runtime Logger**: `packages/shared/src/logger.ts` centralizes `configureLogger`, `getLoggerConfig`, `resolveLogLevel`, and `logger.debug/info/warn/error`, with recursive sensitive metadata redaction before the sink.
- **Host-resource alerts**: the cached snapshot retains its legacy memory `alert` and adds bounded concurrent thermal/disk `currentAlerts`; resource and memory incidents share newest-first bounded history and the existing validated `host:alertChanged` channel. Explicit resource recovery removes only its incident, while an omitted additive field remains compatible with older servers.
- **Host-resource storage preference**: `UiConfig.hostResourcePinnedMount` persists as TOML `host_resource_pinned_mount`; `null` clears it and non-null values are limited to 1–4096 UTF-8 bytes. The browser treats an absent mount as missing without fallback rebinding. It is presentation-only and independent of telemetry/alert classification.
- **Runtime Origin Bootstrap**: `apps/web/src/main.tsx` fetches the reserved
  `/__dam-hopper/runtime-config.json` before constructing transport. Valid
  config reconciles one stable-ID managed profile; an existing active user
  profile wins, and missing/invalid config leaves the client idle rather than
  guessing the web origin or port.
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
- **Linux Release Manager**: `server/src/bin/dam-hopper.rs` dispatches the
  `fetch`, `install`, `role set`, `start`, `status`, `rollback`, `recover`, and
  `version` grammar. `server/src/linux_release/` owns Fedora profile checks,
  bounded GitHub acquisition, optional attestation, exact inventory/archive
  validation, role projection, deployment locking, pending candidate
  persistence, durable activation, health-gated rollback, and boot recovery.
- **Dedicated Web Host**: `server/src/bin/dam-hopper-web.rs` runs the
  non-writing `web_host` router on port `4802`. It validates a non-symlink
  release root and optional ≤4 KiB runtime config, serves only GET/HEAD, keeps
  health/runtime routes reserved with `no-store`, streams regular files, applies
  hashed/index/one-hour cache classes, and restricts SPA fallback to safe HTML
  navigation. It has no `AppState`, API database, proxy, or write surface.

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
         │
         ├── release browser → dam-hopper-web :4802
         │                    └── static assets + runtime origin metadata
         └── API/WS → dam-hopper-server :4801 (systemd)
                              :4800 only for direct/legacy/Docker modes
                                      ↓
Backend BFF/API (server/)
  ├── API-only router by default
  ├── Optional explicit --web-dir combined fallback (Docker)
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
- `dam-hopper-web` is the dedicated non-writing release SPA host on
  `0.0.0.0:4802`; it serves static assets plus reserved health/runtime-origin
  JSON only. Phase 04 renders independent API (`root:root`, `4801`) and web
  (`dam-hopper-web`, `4802`) candidates; Phase 05 installs them through the
  durable activation transaction and orders
  `dam-hopper-recovery.service` before both app units. Docker explicitly
  combines both through `--web-dir /opt/dam-hopper/web` on port `4800`; the
  legacy runner remains separate.

- Web runtime origin is fetched at `/__dam-hopper/runtime-config.json` with `cache: "no-store"` and strict 4 KiB/schema/origin validation. Active user profiles outrank managed deployment profiles; a managed URL change clears only that profile's token.
- Build-time origins for the extension are controlled by `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`; changing them requires rebuilding and redistributing the extension. `VITE_DAM_HOPPER_LOG_LEVEL` controls web bootstrap logging, while `VITE_DAM_HOPPER_SERVER_URL` is forbidden for production builds.
- Profile metadata and tokens are localStorage-scoped; editor persistence is metadata-only and Encrypt session material is memory-only. Transport rebind destroys the previous WS and advances a generation to reject stale responses.

See [Native Browser Debug Support](./native-browser-debug-support.md), [Configuration Guide](./configuration-guide.md), [Linux systemd](./linux-systemd.md), and [API Reference](./api-reference.md).

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

### Linux Release Manager (`server/src/linux_release/`)

Phase 01's strict Manifest v1 contract, Phase 02's manager consumer, Phase 03's
web service metadata, Phase 04's role-aware systemd boundary, and Phase 05's
durable lifecycle share one focused release module:

- `constants.rs`, `version.rs`, `manifest.rs`, `manifest_validation.rs`,
  `inventory.rs`, `inventory_path.rs`, and `inventory_validation.rs` enforce
  profile, stable tag/SemVer, lockstep versions, normalized paths, role
  projections, required service/template/sysusers assets, modes, digests, and
  runtime-file exclusions.
- `cli.rs` plus `server/src/bin/dam-hopper.rs` define and dispatch the manager
  grammar. `privilege.rs` enforces non-root `fetch`, root mutation commands,
  and read-only `status`/`version`.
- `platform.rs`, `origin.rs`, and `host_config.rs` gate Fedora 44/x86_64,
  glibc/systemd requirements, exact web origins, and persistent role/public
  host configuration.
- `acquire.rs`, `acquire_client.rs`, and `attestation.rs` resolve stable
  GitHub releases, bound HTTPS requests, require archive SHA-256 equality, and
  optionally run repository-bound `gh` attestation checks.
- `archive.rs` and `archive_extract.rs` reject unsafe tar entries and extract
  only the selected role projection.
- `unit.rs`, `unit_parser.rs`, and `unit_policy.rs` render allowlisted
  placeholders into independent API/web units and enforce their identities,
  paths, lifecycle, environment, hardening, and no-coupling properties.
  `stage_units.rs` writes selected units, the recovery unit, web sysusers, and
  candidate public config; `systemd.rs` uses direct `systemd-analyze`,
  `systemd-sysusers`, and `systemctl` argument vectors.
- `account.rs`, `ownership.rs`, `process.rs`, and `process_holders.rs` check
  the dedicated web account, release/state modes, process identity/executable/
  cgroup, 4800/4801/4802 listeners, and SQLite holder safety.
- `layout.rs`, `lock.rs`, `stage.rs`, and `stage_transaction.rs` provide
  canonical `/opt`, `/etc`, `/var/lib`, and `/run/lock` paths, a nonblocking
  deployment lock, root-private transaction staging, role resolution, rendered
  candidates, and fsync-backed pending handoff.
- `durable_fs.rs`, `state.rs`, `state_record.rs`, `journal.rs`, `transaction.rs`,
  and `systemd_backup.rs` persist the generation-numbered state envelope,
  enforce the deployment journal, retain unit/config backups, and make updates
  crash durable.
- `health.rs`, `activate_preflight.rs`, `activate.rs`, `rollback.rs`,
  `recovery.rs`, and `retention.rs` implement exact health probes, preflight,
  lock-scoped cutover, automatic/manual rollback, boot reconciliation, and
  fail-closed retention.
- `error.rs` keeps diagnostics typed and bounded. The publisher schema remains
  `deploy/release/release-manifest.schema.json`.

`server` renders `dam-hopper-api.service` as `root:root` on `0.0.0.0:4801`;
`web` renders `dam-hopper-web.service` as the isolated `dam-hopper-web` account
on `0.0.0.0:4802`; `both` stages both from one exact release. API
`NoNewPrivileges=false` is intentional for interactive PTY `sudo` behavior.
Web uses strict systemd sandboxing, no environment files/write paths, and
read-only access only to its release root and public host config. Neither app
unit depends on the other; both are preceded by the recovery unit.

#### Activation and recovery

`install` and `role set` stop at `PENDING`. The unified `start` command takes
the deployment lock and advances only valid transitions:

`ABSENT | ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`

The transaction quiesces old services, proves cgroups/listeners/SQLite holders
are clear, installs concrete units/configuration, daemon-reloads, and starts
the selected candidate. `health.rs` requires initial readiness within 20
seconds, then 20 consecutive probes at 500 ms (10 seconds) for API
`/api/health` and web `/__dam-hopper/health`; probes verify active MainPID,
expected executable/identity/listener, and exact `schemaVersion: 1`, `status:
ok`, role, and version JSON. A mismatch fails; a transient failure resets the
stability window.

The manager writes `/var/lib/dam-hopper-manager/state.json` with a
same-directory temp file, write/sync, rename, and parent-directory sync. It
records active/previous/pending releases, transaction phase, hashes, and the
latest failure; `/opt/dam-hopper/current` is repaired afterward as a
convenience pointer. Candidate failure restores the previous concrete units,
config, and state through the same health gate. First-install failure leaves
all app units stopped/disabled and no active release. Manual `rollback`
promotes the recorded previous release through the same rules; restoration
failure or corrupt/unowned/hash-mismatched state becomes `RECOVERY_REQUIRED`.
`recovery.rs` resumes pending work only where safe, restores interrupted
transactions, repairs committed pointers/enablement, and otherwise blocks all
application units.

The guarded format-2 runner remains separate; migration/retirement is outside
Phase 05.

### Dedicated web host (`server/src/web_host/`)

`web_host` is an API-state-free, non-writing Axum host used by the release web
role. `router.rs` reserves health/runtime-config routes before static fallback;
`safe_path.rs` rejects symlink components, traversal, encoded separators, and
directory access; `cache_policy.rs` classifies hashed assets, index HTML,
reserved metadata, and other files; `runtime_config.rs` validates the public
schema and ≤4 KiB input. `server/src/bin/dam-hopper-web.rs` supplies the
`0.0.0.0:4802` CLI and graceful SIGTERM/CTRL-C lifecycle.

### Environment Variables

```bash
DAM_HOPPER_CONFIG              # API project registry file
DAM_HOPPER_WORKSPACE           # Legacy workspace directory override
DAM_HOPPER_PORT                # API listen port (default: 4800; systemd: 4801)
DAM_HOPPER_HOST                # API bind address (default: 0.0.0.0)
DAM_HOPPER_CORS_ORIGINS        # Exact credentialed browser origins
DAM_HOPPER_NO_AUTH             # Dev mode API auth bypass
DAM_HOPPER_WEB_DIR             # Explicit API combined-mode static root (Docker)
DAM_HOPPER_WEB_ROOT            # Dedicated web host static root
DAM_HOPPER_WEB_HOST            # Dedicated web bind address (default: 0.0.0.0)
DAM_HOPPER_WEB_PORT            # Dedicated web port (default: 4802)
DAM_HOPPER_WEB_RUNTIME_CONFIG  # Optional runtime-config.json path
DAM_HOPPER_WEB_RELEASE_VERSION # Optional health release-version override
MONGODB_URI                    # MongoDB connection (optional)
MONGODB_DATABASE               # MongoDB database name (optional)
RUST_ENV                       # Runtime environment (blocks no-auth in production)
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

The Linux release manager uses a separate host layout:

```text
/opt/dam-hopper/
  ├── .staging/<transaction-id>/       # root-private in-flight transaction (0700)
  ├── releases/<tag>/<role>/           # immutable unpacked role view
  └── current                           # repaired active-view convenience link
/etc/dam-hopper/
  ├── host.toml                         # recorded role + exact allowed origins
  ├── host-config.json                  # active public web runtime config
  ├── sysusers.d/dam-hopper-web.conf    # committed web identity input (web role)
  ├── server.env                        # machine-local API environment
  └── web.env                           # reserved machine-local web environment
/var/lib/dam-hopper-manager/
  ├── pending-units/                    # candidate API/web/recovery units + sysusers
  ├── pending-host-config.json          # candidate public web config
  ├── backups/<transaction-id>/         # unit/config rollback backups
  └── state.json                        # authoritative generation/state envelope
/etc/systemd/system/
  ├── dam-hopper-recovery.service       # boot reconciliation unit
  ├── dam-hopper-api.service            # committed API unit
  └── dam-hopper-web.service            # committed web unit
/run/lock/dam-hopper/deploy.lock        # nonblocking deployment lock
```

Staging writes only the manager's pending candidate. Explicit `start` installs
the selected concrete units/configuration, atomically commits state, repairs
`current`, and garbage-collects only verified unreferenced trees. Published
release assets must not contain machine-local environment/config, tokens,
credentials, or SQLite state. See [Linux Release Manager](./linux-release-manager.md)
for ownership and transaction details.

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

# Release manifest contract checks
cargo test --test linux_release_manifest --test linux_release_manifest_errors
cargo test linux_release
```

### Dedicated web host

```bash
# Serve a selected immutable web release view
cargo run --bin dam-hopper-web -- \
  --root /path/to/immutable/web-dist \
  --host 0.0.0.0 --port 4802 \
  --runtime-config /etc/dam-hopper/runtime-config.json
```

`--root` is required and must be a real directory, not a symlink. Omit
`--runtime-config` for a static-only host; the reserved endpoint then returns
404. Runtime JSON is public, bounded to 4 KiB, and contains no credentials.

The API server does not serve static files unless an explicit `--web-dir` is
passed. Docker is the supported combined-mode example:

```bash
dam-hopper-server --port 4800 --web-dir /opt/dam-hopper/web
```

```bash
# Inspect the manager grammar without mutating the host
cargo run --bin dam-hopper -- version

# Focused Linux release manager suites
cargo test --test linux_release_cli --test linux_release_platform \
  --test linux_release_archive --test linux_release_acquisition \
  --test linux_release_staging --test linux_release_manifest \
  --test linux_release_manifest_errors
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
├── server/                         # Rust backend and release binaries
│   ├── src/
│   │   ├── main.rs                 # API bootstrap (API-only by default)
│   │   ├── bin/dam-hopper.rs       # Linux release manager binary
│   │   ├── bin/dam-hopper-web.rs   # Dedicated static web host binary
│   │   ├── web_host/               # Web routes, paths, cache, runtime config
│   │   ├── api/                    # Axum REST/WebSocket handlers
│   │   ├── linux_release/          # Manifest, acquisition, and staging
│   │   ├── pty/                    # Terminal management
│   │   ├── fs/                     # Filesystem operations/sandbox
│   │   ├── agent_store/            # Agent-store service
│   │   └── lib.rs                  # Library exports
│   ├── tests/
│   │   ├── linux_release_*.rs      # Focused release suites
│   │   └── common/release_fixtures.rs
│   └── Cargo.toml                  # Server and binary metadata
├── deploy/release/
│   └── release-manifest.schema.json # Publisher schema v1
├── apps/
│   ├── web/                        # Thin browser Vite host
│   ├── native/                     # Tauri v2 host and shell
│   └── browser-extension/          # Browser debug extension
├── packages/
│   ├── ui/                         # Shared React UI and tests
│   ├── shared/                     # Shared runtime utilities
│   └── browser-bridge/             # Browser debug protocol
├── docs/                           # Maintained documentation
├── plans/                          # Feature plans and phase reports
└── CLAUDE.md                       # Development commands
```

## Test Coverage
### Passing Tests

- **Linux release Phase 02**: 45/45 focused tests across seven suites:
  CLI/privilege, platform/origins, acquisition, archive, staging, and the two
  Manifest v1 contract suites.
- **Linux release Phase 03**: `linux_release_web_host` 8/8; API-only/default
  and API-health focused tests 2/2; runtime/server-config Vitest 72/72.
- **Linux release Phase 04**: focused `linux_release_unit_policy`,
  `linux_release_ownership`, and `linux_release_staging` suites cover
  allowlisted rendering, API-root/web-isolated policy, role-selected
  candidates, staged web sysusers/public-config validation, ownership modes,
  listener parsing, role conflicts, lock contention, and symlink rejection.
- **Linux release Phase 05**: `linux_release_state_machine`,
  `linux_release_health`, and `linux_release_unit_policy` cover durable phase
  transitions, recovery classification, health identity/listener/JSON gates,
  candidate and rollback unit policy, and recovery-unit ordering.
- **Compile proofs**: vendored all-target Cargo check plus UI and web builds
  exited `0` (recorded 2026-09-03).
- **Other server/frontend counts**: historical snapshots only; consult the
  dated roadmap/changelog entries rather than treating them as a release gate.

### Known Limitations (Pre-existing or phase-scoped)

- Phase 05 implements Linux release activation, unit installation/enablement,
  health-gated cutover, rollback, and boot recovery. The guarded format-2
  runner remains separate; its migration/retirement is later work, and no
  broader distro-release evidence is implied by these module-level proofs.
- The API candidate intentionally runs as `root` by owner decision; this broad
  privilege is an accepted v1 risk. The web candidate remains separately
  unprivileged and sandboxed.
- Recovery blocks all application units when durable state is corrupt,
  unowned, hash-mismatched, or cannot be restored safely.
- Platform-specific Windows filesystem behavior and Git worktree edge cases
  remain outside this phase.

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

### Linux release manager

- Manifest v1 is validated by `server/src/linux_release/` before archive
  inspection; the publisher schema remains
  `deploy/release/release-manifest.schema.json`.
- The `dam-hopper` manager implements the complete grammar and privilege
  policy. Non-root `fetch` downloads a stable GitHub release with bounded
  HTTPS; root `install`/`role set` validates and stages a role view. `status`
  and `version` are read-only; `start` activates a pending candidate or
  starts/verifies the committed role; `rollback` and `recover` run the durable
  lifecycle paths.
- Archive inspection requires exact common/server/web inventory equality,
  normalized paths, regular files/directories, manifest modes, sizes, and
  SHA-256 digests. Links, special entries, and disallowed runtime/config files
  fail closed.
- Phase 04 renders independent units from allowlisted release-root/version/
  public-config/origin placeholders. The API candidate is `root:root` on
  `0.0.0.0:4801` with explicit environment ordering and `NoNewPrivileges=false`;
  the web candidate is `dam-hopper-web` on `0.0.0.0:4802` with strict sandboxing,
  no environment files/write paths, and read-only release/config paths. Neither
  app unit depends on the other.
- `dam-hopper-web` is declared through `sysusers.d` with `/nonexistent` home and
  `/sbin/nologin`; the account verifier rejects missing, root, login-capable, or
  unrestricted-home identities. Rendered unit/sysusers files use `0644`;
  release directories/binaries use `0755` and other release files `0644`.
- The deployment lock is `/run/lock/dam-hopper/deploy.lock`; transaction
  extraction is under `/opt/dam-hopper/.staging/<transaction-id>`, role views
  under `/opt/dam-hopper/releases/<tag>/<role>`, and pending candidates under
  `/var/lib/dam-hopper-manager/`. Unit/config backups live under
  `backups/<transaction-id>/`; `/var/lib/dam-hopper-manager/state.json` is the
  authoritative generation-numbered state envelope. `/opt/dam-hopper/current`
  is a repaired convenience pointer.
- Valid activation advances
  `ABSENT | ACTIVE → STAGED → PENDING → QUIESCED → SWITCHED → PROBING → COMMITTED`.
  `health.rs` requires readiness within 20 seconds, then 20 consecutive probes
  at 500 ms (10 seconds) for API `/api/health` and web
  `/__dam-hopper/health`, checking active MainPID, expected executable/
  identity/listener, and exact role/version health JSON.
- `dam-hopper-recovery.service` is a root boot-reconciliation unit ordered
  before the API and web units. Candidate failure restores the previous
  concrete units/configuration through the same health gate; first-install
  failure leaves application units stopped/disabled with no active release.
  Manual `rollback` promotes the recorded previous release by the same rules;
  unsafe or unrecoverable state is `RECOVERY_REQUIRED`.
- Retention deletes only verified unreferenced release trees. Published
  archives contain no machine-local `.env`, server config, token, credentials,
  or SQLite state. API root authority is an accepted v1 risk; web remains
  separately unprivileged and isolated.

### Dedicated web host

- `dam-hopper-web` receives only a selected static root and optional runtime
  config; root/config symlinks are rejected and runtime input is capped at 4 KiB.
- Reserved health/runtime-config paths cannot fall through to distribution files
  or SPA HTML. Both return `Cache-Control: no-store`.
- File resolution rejects traversal, NUL, encoded separators, symlinks, and
  directories. Other methods return `405` with `Allow: GET, HEAD`; no writes,
  proxy, API, or runtime execution are exposed.
- Runtime `apiUrl` is an exact HTTP(S) origin with no credentials/path/query/
  fragment. The browser never derives it from `Host`; managed profile URL changes
  clear only the managed profile token.

## Documentation Library

| Document | Purpose |
| --- | --- |
| [system-architecture.md](./system-architecture.md) | Component interactions, data flow |
| [api-reference.md](./api-reference.md) | HTTP endpoints, request/response schemas |
| [code-standards.md](./code-standards.md) | Naming conventions, patterns, best practices |
| [configuration-guide.md](./configuration-guide.md) | Setup, environment variables, config files |
| [linux-release-manifest.md](./linux-release-manifest.md) | Linux release manifest v1 contract |
| [linux-release-manager.md](./linux-release-manager.md) | Phase 02 manager CLI, platform gate, acquisition, staging, Phase 03 web role handoff, Phase 04 units, and Phase 05 durable activation/recovery |
| [native-browser-debug-support.md](./native-browser-debug-support.md) | Native Browser Debug platform gate and security boundaries |
| [user-guide-multi-server-profiles.md](./user-guide-multi-server-profiles.md) | Profile storage, switching, and cross-origin policy |
| [ws-protocol-guide.md](./ws-protocol-guide.md) | WebSocket message types, terminal protocol |
| [project-roadmap.md](./project-roadmap.md) | Planned features and phases |

---

**Last Updated**: September 3, 2026
**Phase Status**: Phases 01–05 of the Linux Release Installer Architecture
are complete and reviewed. Phase 05 adds durable generation state,
lock-scoped health-gated activation, recovery-before-app startup, automatic
and manual rollback, and verified retention; format-2 runner migration remains
later work.
**Generated by**: Source review grounded in `repomix-output.xml` (Repomix
1.18.0); metrics reflect the 1,541-file/3,173,280-token compaction and five
security exclusions.
