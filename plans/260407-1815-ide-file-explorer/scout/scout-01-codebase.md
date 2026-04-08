# Scout 01 — Codebase map for IDE file explorer + editor

## Server (`server/src/`)

### 1. AppState (state.rs:1-79, lib.rs)
- `Arc<RwLock<PathBuf>>` workspace_dir — mutable on workspace:switch
- `Arc<RwLock<DevHubConfig>>` config — live reloaded
- `PtySessionManager` pty_manager — `Arc<Mutex<Inner>>` internally; cheap clone
- `BroadcastEventSink` event_sink — tokio broadcast for fan-out (PTY + future fs events)
- **Plug**: add `pub fs_subsystem: FsSubsystem` field, mirror PtySessionManager pattern

### 2. Router (api/router.rs:1-143)
- Pattern `Router::new().route(path, method(handler))` → `protected` wrapped with `auth::require_auth`
- Naming `/api/{domain}/{resource}`
- Static paths must be registered before parameterized (line 65-67)
- Global body limit 10 MB
- **Plug**: add `/api/fs/...` routes after projects routes (line 49-51)

### 3. WebSocket (api/ws.rs:1-127)
- Envelope: `{ type: "channel:action", id?, data?, ... }`
- `InboundMsg` enum (lines 56-63): `terminal:write`, `terminal:resize`
- Outbound (74-123): text frames from broadcast → client
- Loop is single `tokio::select!` (broadcast rx vs socket.recv)
- No request/response correlation today — push + unidirectional
- **Plug**: extend `InboundMsg` with `fs:subscribeTree`, `fs:unsubscribeTree`, `fs:read`, `fs:write`, etc.; add dispatch arms (111-123)

### 4. Workspace + project resolution (api/workspace.rs:26-62, state.rs:48-55)
- `project_path(name)` → returns `PathBuf` or NotFound
- workspace_dir = current WS root; projects relative
- `config.config_path` parent = workspace root
- **Plug**: fs ops resolve project_id → config.projects[].path; sandbox to project subtree (workspace-wide policy still allowed)

### 5. PtySessionManager (pty/manager.rs:40-73)
- `Arc<Mutex<Inner>>` with `HashMap<String, LiveSession>` + dead cache
- API: create/write/resize/kill/get_sessions
- Each session wraps portable_pty + broadcaster
- **Plug**: FsWatcher manager mirrors this — `HashMap<ProjectId, FileWatcher>` (project_id → broadcaster + ref count)

### 6. Errors (error.rs:1-55, api/error.rs:1-50)
- `thiserror` enum: Config, Io, NotFound, Internal, PtyError, SessionNotFound, InvalidInput, Git…
- `status_code()` mapping: 404 / 400 / 500
- ApiError IntoResponse → (status, JSON {error})
- **Plug**: add `FsError` variant (NotFound, PermissionDenied, PathEscape, TooLarge), map appropriately

### 7. Cargo.toml (1-81)
- Present: axum 0.8 (ws), tokio, serde, git2, portable_pty, chrono, handlebars, regex, tempfile
- **Missing**: notify, mime_guess, infer, dunce, cap-std
- **Add**: `notify = "7"`, `notify-debouncer-full`, `infer = "0.15"`, optional `dunce = "1"`

### 8. Path validation / sandbox (utils/fs.rs:1-50)
- Has `atomic_write(target, content)` (.tmp + rename)
- **NO sandbox/validation** — no canonicalize, no symlink check
- **Plug**: new helper `validate_fs_path(workspace_root, requested) -> Result<PathBuf>` — canonicalize + prefix check + reject `..` + symlink escape policy

### 9. Tests (pty/tests.rs, api/tests.rs)
- `tempfile::TempDir`, real shells, polled (no sleep)
- `make_state(&TempDir)` helper for AppState with test token
- tower::ServiceExt to call handlers
- **Mirror**: fs tests use same `tempfile::TempDir` + `make_state()`; cover escape detection, symlink, concurrent writes, watcher

## Web (`packages/web/src/`)

### 10. App.tsx (1-52)
- Routes: Dashboard, Terminals, Git, Settings, AgentStore + fallback
- `AppLayout` wrapper (Sidebar + main)
- Global Ctrl+` opens new terminal
- Listens for `workspace:changed` → invalidate queries
- **Plug**: add `/editor` route OR refactor shell to IDE three-pane layout

### 11. WsTransport (api/ws-transport.ts:1-344)
- Dual mode: fetch() REST + persistent WS for push + terminal I/O
- Message format `{ type, id?, data?, payload? }`
- Terminal: `terminal:data`, `terminal:exit`
- id-based correlation for sessions; type-based for events
- Outbound: terminalWrite/terminalResize via WS.send()
- Auto-reconnect 1s→30s exp backoff
- **Plug**: add fs cases to `channelToEndpoint()`; new outbound helpers; new inbound event types `fs:treeSnapshot`, `fs:event`

### 12. TanStack Query (api/queries.ts:1-80)
- `useQuery({ queryKey, queryFn })`; mutations invalidate
- staleTime Infinity for event-driven, 30s for projects
- **Plug**: add useTreeSubscription hook (NOT plain useQuery — needs WS subscribe lifecycle); add useReadFile / useWriteFile mutations

### 13. Terminal panel (components/organisms/TerminalPanel.tsx:1-60)
- xterm v6 + addon-fit
- Subscribe via `getTransport().onTerminalData(id, cb)` / `onTerminalExit`
- useEffect init/cleanup
- **Mirror**: editor pane subscribes to fs:event for open file; tree pane subscribes to fs:treeEvent for project

### 14. vite.config.ts (1-20)
- Plugins: react, tailwindcss v4
- Proxies /api and /ws to backend
- Alias @ → /src
- base: "./"
- **Plug**: Monaco needs worker setup (`monaco-editor/esm/vs/editor/editor.worker?worker`) OR use `@monaco-editor/react` which CDN-loads — decide in researcher report

### 15. package.json
- Present: React 19, react-router-dom 7, TanStack Query 5, @xterm, tailwindcss, lucide-react, clsx, tailwind-merge
- **Missing**: monaco-editor / @monaco-editor/react, react-resizable-panels, react-arborist, zustand (optional)

### 16. Pages convention (SettingsPage.tsx)
- Function component, hooks for queries/mutations, AppLayout wrapper

## Plug points (summary)

**Server**
- state.rs:21 → add fs_subsystem
- api/router.rs:49-51 → fs routes
- api/ws.rs:58-63 → InboundMsg enum extension
- api/ws.rs:111-123 → dispatch arms
- api/mod.rs → export `fs` module
- error.rs → FsError variant
- NEW: server/src/fs/mod.rs (FsSubsystem)
- NEW: server/src/fs/watcher.rs (notify-based)
- NEW: server/src/fs/sandbox.rs (path validation)
- NEW: server/src/fs/ops.rs (atomic write, read, list, mkdir, mv, rm)

**Web**
- api/ws-transport.ts:145-147 → channelToEndpoint cases + new subscription helpers
- api/queries.ts → fs hooks
- api/client.ts → fs API types
- App.tsx → IDE shell refactor (or new route)
- NEW: pages/EditorPage.tsx (or refactor App into IDE shell)
- NEW: components/organisms/FileExplorer.tsx
- NEW: components/organisms/FileEditor.tsx
- NEW: components/organisms/IdeShell.tsx (three-pane resizable)

## Gaps (must introduce)

1. File watcher subsystem (notify + debounce + broadcast per project)
2. Path sandbox helper (canonicalize + prefix check)
3. MIME / binary detection (infer)
4. Editor component (Monaco)
5. Tree view UI (virtualized)
6. Resizable pane layout (react-resizable-panels)
7. WS subscription pattern (current WS is push-only/no sub registry)
8. Conflict strategy — locked: last-write-wins (no extra infra needed beyond docs)

## Open questions

- IDE shell as new route vs replace current shell?
- Symlink escape: hard reject vs warn?
- Default hidden files visibility?
- .gitignore respect in tree?
- Max file size cap for Monaco load (recommend 5 MB)?
- Search/grep across files in scope for v1?
- Git status badges in tree (decoration) — defer?
