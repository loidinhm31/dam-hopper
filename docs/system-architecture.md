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
│  dam-hopper-server (Rust, Axum, port 4800)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─ AppState (shared across all handlers)                  │
│  │  ├─ workspace_dir: Arc<RwLock<PathBuf>>                │
│  │  ├─ config: Arc<RwLock<DamHopperConfig>>                  │
│  │  ├─ pty_manager: PtySessionManager                     │
│  │  ├─ agent_store: Arc<AgentStoreService>                │
│  │  ├─ event_sink: BroadcastEventSink                     │
│  │  ├─ fs: FsSubsystem                                    │
│  │  ├─ ssh_creds: Arc<RwLock<Option<...>>>               │
│  │  ├─ auth_token: Arc<String>                            │
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
- `DamHopperConfig` — parsed workspace config
- `ProjectConfig` — individual project settings

**Path resolution priority:**
1. `--workspace` CLI flag
2. `DAM_HOPPER_WORKSPACE` env var
3. `~/.config/dam-hopper/config.toml` default path

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
- `search()` (Phase 07) — .gitignore-aware text search using `ignore` crate; returns file + match context; results capped at 1000

**mod.rs** — `FsSubsystem` (Arc<Mutex<Inner>>):
- Lazy init: sandbox stored as Option (Unavailable if init failed)
- Cheap clone pattern

### Multi-Server Profile Management (Phase 2)

**Client-side only** — no backend involvement. React component integration:

**File:** `packages/web/src/api/server-config.ts`
- `ServerProfile` interface: { id (UUID), name, url, authType, username?, createdAt (timestamp) }
- Functions: `getProfiles()`, `saveProfiles()`, `createProfile()`, `updateProfile()`, `deleteProfile()`, `setActiveProfile()`, `getActiveProfile()`, `migrateToProfiles()`
- Storage: localStorage with keys `damhopper_server_profiles` (all profiles) + `damhopper_active_profile_id` (current)

**Components:**
- `ServerSettingsDialog.tsx` (organisms/) — create/edit profile form with URL + auth type selector
- `ServerProfilesDialog.tsx` (organisms/) — list profiles, switch active, delete, edit (calls callbacks to parent)
- `Sidebar.tsx` — displays active profile name; "Change Server" button opens `ServerProfilesDialog`

**Integration in App.tsx:**
- Calls `migrateToProfiles()` at startup to convert legacy config
- Sidebar triggers profile switcher dialog (with callback for page reload if needed)

**Data Persistence:**
- Profiles: localStorage (survives browser close, shared across tabs)
- Active profile ID: localStorage (survives browser close, shared across tabs)
- Auth token: sessionStorage (cleared on tab close, isolated per tab) — password never stored

### pty/ (Phase 04: Restart Engine ✅ / Phase 07: Idempotency ✅)

Manages portable terminal sessions with automatic restart capabilities and idempotent creation.

**manager.rs** — `PtySessionManager` (Arc<Mutex<Inner>>):
- Map<id, LiveSession> for active sessions
- Map<id, DeadSession> tombstones (60s TTL; auto-evicted by cleanup task)
- Set<id, String> killed tracks manually terminated sessions (used to prevent supervisor respawn race)
- `create()` fully idempotent: removes dead tombstone, inserts into killed set pre-spawn, removes post-spawn (TOCTOU guard)
- `kill()` marks session dead + adds to killed set, retains 60s tombstone for reconnect
- `remove()` immediately evicts session + adds to killed set (no restart on user kill)
- `spawn_cleanup_task()` runs every 30s: prunes expired tombstones AND orphaned killed set entries (prevents unbounded memory growth)
- Bounded respawn channel (256 slots) prevents DoS

**session.rs** — Session state management:
- `SessionMeta` — public status (id, alive, exit_code, restart_count)
- `LiveSession` — owns master PTY + writer, reader thread reference
- `DeadSession` — tombstone with exit code, restart decision, backoff delay
- `RespawnOpts` — cloneable subset of PtyCreateOpts for respawn

**Restart Engine (Phase 04):**

**Supervisor Pattern** — decouples blocking I/O from async restart logic:
1. Reader thread (std::thread) reads PTY output blocking
2. On EOF: infer exit code → decide restart → send RespawnCmd
3. Supervisor task (tokio) receives cmd, waits backoff, calls create()
4. New session inherits same ID (no frontend navigation needed)

**Decision Matrix:**
| Policy | Exit=0 | Exit≠0 | Killed |
|--------|--------|--------|---------|
| Never | ✗ | ✗ | ✗ |
| OnFailure* | ✗ | ✓ | ✗ |
| Always | ✓ | ✓ | ✗ |

*OnFailure currently acts like Always due to portable-pty API limitation

**Exponential Backoff:**
- 1s, 2s, 4s, 8s, 16s, 30s (max)
- Cap at `MAX_RESTART_DELAY_MS` (30s)
- Resets to 1s on clean exit (exit_code == 0)

**Exit Code Inference** (Limitation):
- portable-pty API only signals EOF (no waitpid equivalent)
- Inferred as: process in live map → exit 0; not found → exit -1
- Cannot distinguish exit 0 from exit 1 (architectural limitation)
- Upstream issue filed: requires std::process wrapper as future work

**Known Issues (Phase 04 Review):** Both fixed before merge:
1. Bounded channel prevents unbounded respawn queue growth (DoS vector) — ✓ Fixed
2. Exit code always 0 for natural exits (OnFailure policy broken) — ✓ Fixed

**Phase 07 Improvements:**
- Killed set prevents double-spawn on concurrent create (50-100ms lock contention reduction)
- Idempotent create eliminates client need for alive status filtering
- Cleanup task prevents killed set from accumulating orphaned entries (was potential memory leak)

**Killed Set Lifecycle (Phase 07 Idempotency Mechanism):**

Prevents supervisor from restarting a session during the kill window and enables full idempotency on create:

1. **User kill**: Session moved to killed set immediately (before reader sees EOF)
2. **Reader exit**: Checks killed set — if present, skips restart decision
3. **Supervisor restart**: Checks killed set — if present, skips delayed respawn
4. **Cleanup task**: Every 30s, removes orphaned IDs (not in live or dead maps)

Example race sequence (create during backoff):
- T0: Process exits, reader sends RespawnCmd with 1s backoff
- T200ms: User calls `terminal:create` with same ID
- T200ms: Create inserts ID into killed set (cancels pending respawn)
- T200ms: Create spawns fresh process, reacquires lock, removes ID from killed set
- T1.2s: Supervisor wakes up, checks killed set — not there anymore but session exists with different PID, skips restart
- Result: Single shell, no race condition

**Tests (Phase 04-07):**
- 8 decision matrix rows (all 8/8 passing)
- 5 base integration tests (Phase 04, all passing)
- 1 race condition test: `create_during_backoff_cancels_pending_restart` (Phase 07, validates idempotency)
- Covers: session create/list, write/buffer, resize, kill, remove, respawn, concurrent create race

### git/
Git operations via `git2` library + CLI fallback.

**repository.rs** — Clone, push, pull, status.

**types.rs** — Shared data types:
- `DiffFileEntry` — file status, staged flag, additions/deletions
- `FileDiffContent` — hunks, original+modified content, language detection, binary flag
- `HunkInfo` — hunk position + header for unified diff display
- `ConflictFile` — 3-way merge content (ancestor, ours, theirs)

**diff.rs** (Phase 01) — Diff and conflict operations:
- `get_diff_files()` — list changed files (staged + unstaged)
- `get_file_diff()` — hunked diff for single file
- `stage_files()` — stage paths for commit
- `unstage_files()` — unstage paths
- `discard_file()` — restore file from HEAD
- `discard_hunk()` — revert single hunk (destructive)
- `get_conflicts()` — list merge-conflicted files with 3-way content
- `resolve_conflict()` — write resolved content, mark resolved

### agent_store/
Distributes `.claude/` items across projects.

**distributor.rs** — Ship/unship/absorb operations.

**health_check.rs** — Detects broken symlinks.

### api/
HTTP request handlers + WebSocket upgrade.

**router.rs** — Route definitions (ide_explorer routes are feature-gated).

**fs.rs** — File explorer handlers:
- `GET /api/fs/list` — directory contents with metadata
- `GET /api/fs/read` — file text/binary content
- `GET /api/fs/stat` — file metadata
- `GET /api/fs/search` (Phase 07) — global file content search, .gitignore-aware, results capped at 1000

**git_diff.rs** (Phase 01) — Git diff/staging/conflict handlers:
- `GET /api/git/:project/diff` — list changed files
- `GET /api/git/:project/diff/file?path=REL` — file diff with hunks
- `POST /api/git/:project/stage` — stage files
- `POST /api/git/:project/unstage` — unstage files
- `POST /api/git/:project/discard` — discard file changes
- `POST /api/git/:project/discard-hunk` — discard single hunk
- `GET /api/git/:project/conflicts` — list merge conflicts
- `POST /api/git/:project/resolve` — resolve merge conflict

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

## Data Flow: File Search Request (Phase 07)

```
GET /api/fs/search?project=web&q=pattern[&case=true&max=50]
         ↓
    search() handler (fs.rs)
         ↓
    WorkspaceSandbox.validate(project root)
         ↓
    spawn_blocking: walk_dir via ignore crate (respects .gitignore)
    → filter by path + file type
    → regex-escaped plain text search
    → collect matches (file, line, column, context)
         ↓
    cap results at max (default 200, hardcap 1000)
         ↓
    JSON response: { results: [{ file: "...", matches: [...] }] }
```

## Frontend Components (Phase 06+)

React 19 single-page application at `packages/web/` using Vite + Tailwind CSS.

### Component Architecture

**TerminalPanel** (`packages/web/src/components/organisms/TerminalPanel.tsx`)
- Renders single terminal session using xterm.js
- Subscribes to Transport events: `onTerminalExit`, `onProcessRestarted`, `onTransportStatus`
- Writes ANSI banners for lifecycle events:
  - Exit: Green (code=0), Red (code≠0, no restart), Yellow (willRestart)
  - Restart: Yellow `[Process restarted (#N)]`
  - Reconnect: Dim `[Reconnecting…]` / `[Reconnected]`
- Creates/reconnects to PTY session on mount via `terminal:spawn` command

**TerminalTreeView** (`packages/web/src/components/organisms/TerminalTreeView.tsx`)
- Sidebar tree displaying projects + commands + sessions
- Renders `StatusDot` component (NEW: Phase 6) for each session
- Status dots reflect session lifecycle via `getSessionStatus()` helper
- Color mapping:
  - 🟢 Green: alive
  - 🟡 Yellow: restarting (willRestart=true, within backoff)
  - 🔴 Red: crashed (exit≠0, no restart)
  - ⚪ Gray: exited cleanly (exit=0)
- Expandable profile nodes show instance children + alive count badge

**DashboardPage** (`packages/web/src/components/pages/DashboardPage.tsx`)
- Main view: all sessions with metadata (uptime, exit code)
- **SessionRow** renders:
  - Status dot (via `getSessionStatus`)
  - Restart badge `↻ N` (when `restartCount > 0`, yellow background)
  - Uptime and command
- Queries invalidated on `process:restarted` event → auto-refresh

### Session Lifecycle Helpers (Phase 06)

**session-status.ts** (`packages/web/src/lib/session-status.ts`)
- `getSessionStatus(sess: SessionInfo): "alive" | "restarting" | "crashed" | "exited"` — determines UI status
- `getStatusDotColor(status): string` — maps status to Tailwind class
- `getStatusGlowClass(status): string` — optional glow effect for active states
- Centralized logic prevents UI inconsistencies across components

**session-status.test.ts**
- Unit tests for all status transitions
- Color mapping validation
- Edge cases (null exit code, missing fields)

### Transport Events (Phase 06)

**WebSocket Transport** (`packages/web/src/api/ws-transport.ts`)
- New event listeners (Phase 5 contract):
  - `onTerminalExit(id, callback)` — trigger exit banner, call onExit
  - `onProcessRestarted(id, callback)` — trigger restart banner, invalidate queries
  - `onTransportStatus(callback)` — listen to WS connection status changes

### SessionInfo Type Extensions

```ts
export interface SessionInfo {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
  // Phase 3 restart policy fields
  restartPolicy?: "never" | "on-failure" | "always";
  restartCount?: number;
  lastExitAt?: number;
  // Phase 5 exit event fields
  willRestart?: boolean;       // Indicates if process will auto-restart
  restartInMs?: number;        // Milliseconds until restart attempt
}
```

### Data Flow: Terminal Lifecycle

```
User launches terminal
  ↓
terminal:spawn → Backend creates PTY
  ↓
terminal:spawned → Frontend stores SessionInfo (alive=true)
  ↓
TerminalPanel mounts, xterm renders, streams output
  ↓
Process exits
  ↓
terminal:exit (willRestart flag set by backend)
  ↓
TerminalPanel writes exit banner (color based on exit code + willRestart)
  ↓
If willRestart=true, waits for restart...
  ↓
process:restarted event
  ↓
TerminalPanel writes restart banner, UI updates badge
  ↓
xterm resumes streaming (same session ID, new PTY)
```

**FileTree.tsx (react-arborist)**
- `onMove` callback enabled for drag-and-drop
- Drop on directory → move file/folder into directory
- Drop on file → move into file's parent directory
- All moves validated through server `ops.move()` sandbox

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
- Hex UUID stored in `~/.config/dam-hopper/server-token`
- Validated via `subtle::constant_time_compare()`
- All routes protected via middleware

**Filesystem sandbox:**
- Projects cannot traverse above their root
- Symbolic links are allowed but validated
- Binary file detection prevents accidental text parsing

**CORS:** Configurable via `--cors-origins` flag.

## Feature Gating: IDE Explorer

Routes `/api/fs/*` (list, read, stat) only registered when:
- OR env: `DAM_HOPPER_IDE=1`

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

**Phase 01 (Complete):** 
  - File explorer foundation—sandbox, list/read/stat REST endpoints.
  - Git diff/staging/conflict API—8 endpoints for change management. `DiffFileEntry`, `FileDiffContent`, `HunkInfo`, `ConflictFile` types. `git::diff` module with hunked diff parsing, hunk-level discard, 3-way merge visualization.

**Phase 02 (Complete):** Watcher subsystem via inotify/notify; WebSocket subscription protocol `{kind:}` envelope (hard cut from legacy `{type:}`); fs:subscribe_tree/fs:unsubscribe_tree/fs:event channels; health endpoint with feature flags.

**Phase 03 (Complete):** Web IDE shell—react-resizable-panels layout (file tree | editor | terminal); react-arborist tree component; TanStack Query + useFsSubscription hook for live tree sync; applyFsDelta merges server events into client cache; feature flag `ide_explorer` gates routes and sidebar link; /ide lazy route with fallback placeholder.

**Phase 04 (Complete):** Monaco editor with tab mgmt + save. WS write protocol (fs:write_begin → fs:write_chunk* → fs:write_commit). File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary). Conflict detection via mtime. Ctrl+S save, MonacoHost, EditorTabs, LargeFileViewer, BinaryPreview, ConflictDialog components.

**Phase 05 (Complete):** CRUD + WS-chunked upload + streaming download.

**Phase 06 (Complete):** Unified workspace—merge IdePage + TerminalsPage into single WorkspacePage. Tabbed left sidebar (Files/Terminals), multi-terminal bottom panel with TerminalTabBar + MultiTerminalDisplay. Terminal state extracted to `useTerminalManager` hook. Single `/workspace` route; `/terminals` and `/ide` redirect. Feature flag `ide_explorer` controls editor/file-tree visibility within page (not route access).

**Phase 07 (Complete):** IDE explorer enhancements:
  - **Markdown split-view preview:** `MarkdownHost` + `MarkdownPreview` components in packages/web/src/components/organisms/. EditorTabs routes .md/.mdx files to MarkdownHost. Toggle modes: Edit | Split | Preview-only.
  - **Drag-and-drop file move:** FileTree.tsx DnD via react-arborist's built-in `onMove`. Drop on dir → move into dir. Drop on file → move to file's parent. Calls existing `ops.move()` with server-side sandbox validation.
  - **Backend search API:** `GET /api/fs/search?project=X&q=QUERY[&case=bool&max=N]` in server/src/api/fs.rs. Uses `ignore` crate v0.4 for .gitignore-aware directory walking. Plain text search (regex-escaped server-side). Results capped at 1000, default 200.
  - **Frontend search panel:** New "SEARCH" tab in SidebarTabSwitcher. SearchPanel component with debounced input (useDeferredValue), results grouped by file with match highlighting. `useFileSearch` hook in packages/web/src/hooks/. Ctrl+Shift+F keyboard shortcut to focus search. Gated behind ide_explorer feature flag.
