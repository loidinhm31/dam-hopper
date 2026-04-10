# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  ├─ React 19 SPA (packages/web/dist/)                      │
│  ├─ fetch(/api/*) for REST queries                         │
│  └─ WebSocket(/ws) for terminal I/O + events               │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│  dev-hub-server (Rust, Axum, port 4800)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─ AppState (shared across all handlers)                  │
│  │  ├─ workspace_dir: Arc<RwLock<PathBuf>>                │
│  │  ├─ config: Arc<RwLock<DevHubConfig>>                  │
│  │  ├─ pty_manager: PtySessionManager                     │
│  │  ├─ agent_store: Arc<AgentStoreService>                │
│  │  ├─ event_sink: BroadcastEventSink                     │
│  │  ├─ fs: FsSubsystem                                    │
│  │  ├─ ssh_creds: Arc<RwLock<Option<...>>>               │
│  │  ├─ auth_token: Arc<String>                            │
│  │  └─ ide_explorer: bool (feature gate)                  │
│  ├─ Router                                                 │
│  │  ├─ /api/projects → ProjectList handler                │
│  │  ├─ /api/pty/* → PTY spawn/send/kill                   │
│  │  ├─ /api/git/* → Clone/push/status                     │
│  │  ├─ /api/fs/* → [conditional] List/read/stat           │
│  │  ├─ /api/agent-store/* → Distribution/import           │
│  │  ├─ /api/workspace/* → Config switching                │
│  │  └─ /ws → WebSocket upgrade                            │
│  └─ Services                                               │
│     ├─ PtySessionManager (Arc<Mutex<Map<uuid, ...>>>)     │
│     ├─ FsSubsystem (Arc<Mutex<WorkspaceSandbox>>)         │
│     ├─ AgentStoreService (symlink distribution)           │
│     ├─ CommandRegistry (BM25 search)                      │
│     └─ Broadcast channels (PTY output, git progress)      │
└─────────────────────────────────────────────────────────────┘
```

## Module Breakdown

### config/
Handles TOML parsing, project discovery, feature flags.

**Key types:**
- `DevHubConfig` — parsed workspace config
- `ProjectConfig` — individual project settings
- `FeaturesConfig` — feature flags (ide_explorer, etc.)

**Path resolution priority:**
1. `--workspace` CLI flag
2. `DEV_HUB_WORKSPACE` env var
3. `~/.config/dev-hub/config.toml` default path

### fs/ (Phase 01+: IDE File Explorer + Editor)

**error.rs** — `FsError` enum (Unavailable, NotFound, PermissionDenied, TooLarge, Conflict).
- `Conflict` variant (Phase 04): raised when write rejected due to mtime mismatch.

**sandbox.rs** — `WorkspaceSandbox` validates paths stay within project bounds.
- Cheap clone (PathBuf)
- Never held across `.await`

**ops.rs** — Filesystem operations:
- `list_dir()` — directory contents with metadata
- `read_file()` — text/binary detection, range reads (max 100MB, Phase 04: capped at 10MB per REST call, unlimited via WS)
- `stat()` — file metadata (kind, size, mtime, mime, isBinary)
- `detect_binary()` — heuristic detection
- `atomic_write_with_check()` (Phase 04) — mtime-guarded atomic write via tempfile + rename

**mod.rs** — `FsSubsystem` (Arc<Mutex<Inner>>):
- Lazy init: sandbox stored as Option (Unavailable if init failed)
- Cheap clone pattern

### pty/
Manages portable terminal sessions via `portable-pty`.

**session_manager.rs** — `PtySessionManager` (Arc<Mutex<Inner>>):
- Map<uuid, PtySession>
- `spawn()` creates new session
- `send()` writes to stdin
- Output broadcast via `tokio::sync::broadcast`
- Buffer retained only during live session

### git/
Git operations via `git2` library + CLI fallback.

**repository.rs** — Clone, push, pull, status, diff.

### agent_store/
Distributes `.claude/` items across projects.

**distributor.rs** — Ship/unship/absorb operations.

**health_check.rs** — Detects broken symlinks.

### api/
HTTP request handlers + WebSocket upgrade.

**router.rs** — Route definitions (ide_explorer routes are feature-gated).

**fs.rs** — File explorer handlers (list, read, stat).

**error.rs** — Maps AppError to HTTP status codes.

### state.rs

`AppState` holds:
- Workspace config (Arc<RwLock>)
- PTY manager (cheap clone pattern)
- FS subsystem (cheap clone pattern)
- Auth token (Arc<String>)
- Feature flags (captured at startup)

### main.rs

Server bootstrap:
- Config loading
- PTY manager init
- FS subsystem init
- AppState construction
- Router registration (ide_explorer routes conditional)
- Port binding + graceful shutdown

## Data Flow: File List Request

```
GET /api/fs/list?project=web&path=src
         ↓
    resolve() handler
         ↓
    AppState.project_path("web")
    → finds project in config
    → returns absolute path
         ↓
    WorkspaceSandbox.validate()
    → checks path stays in bounds
    → returns canonical path
         ↓
    ops::list_dir()
    → tokio::fs::read_dir()
    → collects DirEntry (name, kind, size, mtime, isSymlink)
         ↓
    JSON response: { entries: [...] }
```

## Concurrency Model

**Tokio async:** All I/O non-blocking.

**Mutexes:**
- AppState.workspace_dir, config, global_config: RwLock<T>
- PtySessionManager.inner: Mutex<Map<...>>
- FsSubsystem.inner: Mutex<Option<Sandbox>>
- SshCredStore: Mutex<...>

**Broadcast channels:** PTY output fan-out to multiple WebSocket clients.

**Important:** Never hold FsSubsystem, PtySessionManager locks across `.await` — clone fields out first.

## Authentication & Security

**Bearer token:**
- Hex UUID stored in `~/.config/dev-hub/server-token`
- Validated via `subtle::constant_time_compare()`
- All routes protected via middleware

**Filesystem sandbox:**
- Projects cannot traverse above their root
- Symbolic links are allowed but validated
- Binary file detection prevents accidental text parsing

**CORS:** Configurable via `--cors-origins` flag.

## Feature Gating: IDE Explorer

Routes `/api/fs/*` (list, read, stat) only registered when:
- Config: `[features] ide_explorer = true` in dev-hub.toml
- OR env: `DEV_HUB_IDE=1`

If disabled, requests return 404.

FsSubsystem still initializes (needed for future phases), but routes are gated at router level.

## Error Handling Strategy

Each module defines error enum:
- `FsError` — sandbox/ops errors
- `AppError` — top-level (Fs, Git, NotFound, etc.)
- `ApiError` — HTTP mapping

API layer (handlers) catch AppError → HTTP status:
- 400 Bad Request (validation)
- 404 Not Found
- 503 Service Unavailable (feature disabled)

## Phase Progression

**Phase 01 (Complete):** File explorer foundation—sandbox, list/read/stat REST endpoints.

**Phase 02 (Complete):** Watcher subsystem via inotify/notify; WebSocket subscription protocol `{kind:}` envelope (hard cut from legacy `{type:}`); fs:subscribe_tree/fs:unsubscribe_tree/fs:event channels; health endpoint with feature flags.

**Phase 03 (Complete):** Web IDE shell—react-resizable-panels layout (file tree | editor | terminal); react-arborist tree component; TanStack Query + useFsSubscription hook for live tree sync; applyFsDelta merges server events into client cache; feature flag `ide_explorer` gates routes and sidebar link; /ide lazy route with fallback placeholder.

**Phase 04 (Complete):** Monaco editor with tab mgmt + save. WS write protocol (fs:write_begin → fs:write_chunk* → fs:write_commit). File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary). Conflict detection via mtime. Ctrl+S save, MonacoHost, EditorTabs, LargeFileViewer, BinaryPreview, ConflictDialog components.

**Phase 05 (Complete):** CRUD + WS-chunked upload + streaming download.

**Phase 06 (Pending):** Unified workspace—merge IdePage + TerminalsPage into single WorkspacePage. Tabbed left sidebar (Files/Terminals), multi-terminal bottom panel with TerminalTabBar + MultiTerminalDisplay. Terminal state extracted to `useTerminalManager` hook. Single `/workspace` route; `/terminals` and `/ide` redirect. Feature flag `ide_explorer` controls editor/file-tree visibility within page (not route access).
