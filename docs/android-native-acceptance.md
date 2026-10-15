# Android Native Client — Scope Baseline and Acceptance Ledger

**Document status:** Baseline updated for Phase 03 (Contracts ownership and live transport).  
**GATE-A1 Scope Status:** Approved in Phase 01. **GATE-A2 Toolchain & Foundation:** Foundation and security verified in Phase 02 (47/47 static assertions). **Phase 03 Transport & Ownership Foundation:** Implemented and statically verified (Cycle 2 Review 8.8/10; 48/48 static assertions, 28/28 shared JVM tests; live backend lifecycle qualification and device runtime launch open). GATE-B (Runtime Feasibility) pending Phase 05.  
**Baseline commit:** `d897a91f76a07ec819a50ffc2756cb69327b2fe3` (server v0.13.2, workbenchProtocol v2, authProtocol v2).  
**Working tree provenance:** Branch `feat/android-native-app`. Preserves pre-existing planning files and architecture documents.  
**Authority:** [User Decisions](../plans/261015-1647-android-native-app/research/decision-context.md), [Proposed Architecture](./architecture/android-native-client.md), [Validation Answers](../plans/261015-1647-android-native-app/validation-answers.md).

---

## 1. Scope Baseline & Boundary Constraints

### 1.1 Product Boundary
- **Root location:** `native-app/` at repository root, completely isolated from `apps/native/` (the Tauri 2 desktop host).
- **Technology foundation:** Kotlin Multiplatform (`commonMain`) for state, models, networking, and validation + Jetpack Compose for UI. Platform adapters in `androidApp` for terminal, editor, Keystore, and media playback.
- **Operating environment:** Android 10+ (`minSdk 29`, `targetSdk 35`). Physical ARM64 device (`arm64-v8a`) and emulator (`x86_64`) qualification targets.
- **Packaging:** Signed private APK; no Google Play Store distribution or background Google Play Services dependency.
- **Exclusions:** No WebView, embedded browser engine, local PTY, local Git, local AI agents, local Linux container, or local SSH port forwarding. Remote Rust server handles all execution.

### 1.2 Workspace Presentation Constraints (Binding User Decision)
- **Workspace Mode:** Strict **TERMINAL mode only** (`workspaceMode = "terminal"`). IDE shell and workspace mode switchers are excluded.
- **Terminal Presentation:** Strict **Traditional terminal only** (`terminalUsageMode = "traditional"`). Runtime terminal presentation and mode switchers are excluded.
- **Navigation Architecture:** Exactly **one in-layout panel-navigation row** positioned at the top of the screen directly beneath the server/project status header.
  - Button styling: Icon + short text label with explicit active/selected state.
  - Overflow behavior: Single-line horizontal scrolling. Never wraps into multiple rows; no overflow/More menu.
  - Keyboard behavior: Navigation row remains docked and visible while the software keyboard (IME) is open.
  - Screen sizes: Exactly one content area on phones, tablets, and foldables. Selecting a panel replaces the terminal visually while keeping controllers and sessions alive. No multi-pane or side-by-side terminal/panel docking.
  - Strict anti-floating rule: Zero floating action buttons (FABs), floating panel triggers, or draggable overlays. All navigation and actions are strictly inline.

---

## 2. Panel Destination Registry

All included remote workbench functions are accessed as panel destinations from the single top navigation row:

| Panel ID | Button Label | Icon | Purpose & Contained Functions | Owning Phase |
|---|---|---|---|---|
| `terminal` | Terminal | `Terminal` | Primary/default panel. Active remote PTY session, terminal grid, IME input, session switcher, scrollback, agent status badge. | 07 |
| `files` | Files | `Folder` | Project file tree, directory expansion, file creation/deletion/renaming, file search, federated search. | 08 |
| `editor` | Editor | `Code` | Code editor tabs, syntax highlighting, line numbers, dirty buffer indicators, mtime conflict resolution, safe saves. | 09 |
| `diff` | Diff | `GitCompare` | Side-by-side and inline Git file diffs, hunk revert, staging/unstaging changes. | 10 |
| `merge` | Merge | `GitMerge` | Three-way conflict editor, ours/theirs/base block resolution, conflict marker stripping. | 10 |
| `git` | Git | `GitBranch` | Git commit log graph, branch switcher, worktree management, CAS commit rewriting, safe squash, leased publication. | 12 |
| `workflow` | Workflow | `CheckSquare` | Project plans, phase/task checklists, session notes, workflow event history. | 13 |
| `agents` | Agents | `Bot` | Agent Store catalog, item ship/unship/absorb, project distribution status, agent memory templates. | 14 |
| `resources`| Metrics | `Activity` | Host fleet overview, CPU/memory/disk telemetry, alert badges, resource usage history. | 15 |
| `ports` | Ports | `Network` | Detected listening ports, Cloudflared tunnel creation/status, remote public exposure reminders. | 16 |
| `ssh_host` | Host | `Server` | Remote SSH key listing/loading, agent status, idle-suspend consent dialog, server cache reset. | 16 |
| `settings` | Settings | `Settings` | Multi-server profile configuration, local appearance preferences, Cognito privacy mode toggle. | 04, 17 |

*Code Realization:* Modeled authoritatively in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/model/WorkbenchModel.kt` as `enum class WorkbenchPanel(val label: String, val shortCode: String)` with exact 12 entries: `TERMINAL("Terminal", "TERM")`, `FILES("Files", "FS")`, `EDITOR("Editor", "EDIT")`, `DIFF("Diff", "DIFF")`, `MERGE("Merge", "MRG")`, `GIT("Git", "GIT")`, `WORKFLOW("Workflow", "FLOW")`, `AGENTS("Agents", "AGNT")`, `RESOURCES("Resources", "RES")`, `PORTS("Ports", "PORT")`, `SSH_HOST("Host Controls", "HOST")`, and `SETTINGS("Settings", "SET")`. (Note: In the Phase 02 foundation, `WorkbenchPanel` adapts button labels and short codes for compact button row rendering: `RESOURCES` is labeled "Resources" with code `RES`, and `SSH_HOST` is labeled "Host Controls" with code `HOST`). Bound directly to `PanelNavigationRow.kt` horizontal scrollable button row with active-panel highlight and structured placeholders until owning phases connect live transports and native widgets.
---

## 3. Complete Consumer & Feature Inventory

Every non-browser feature in the existing DamHopper web application (`packages/ui/`) is mapped below to its requirement ID, owning phase, source implementation, and observable acceptance journey:

| Req ID | Feature / Component | Source Files (`packages/ui/` / `server/`) | Owning Phase | Observable Acceptance Journey |
|---|---|---|---|---|
| **A01** | Multi-server profile isolation | `stores/profile-store.ts`, `api/ws-transport.ts` | 03, 04 | Configure 2 servers with identical project names. Switching profiles switches transports cleanly; closing or modifying one does not affect the other. |
| **A02** | Authentication & TOTP MFA | `components/organisms/AuthDialog.tsx`, `server/src/api/auth.rs`, `server/src/api/auth_mfa.rs` | 04 | Authenticate against SQLite/Mongo auth backend. Complete password login, TOTP setup/verify challenge, receive 401 on expired tokens, rotate tokens. |
| **C01** | TERMINAL Traditional shell | `components/organisms/IdeShell.tsx`, `components/organisms/TerminalPanel.tsx` | 06 | App launches into Traditional terminal shell. Project switching rebinds PTYs; zero IDE shell layout or switcher visible. |
| **NAV01**| Single-row panel navigation | `components/organisms/TopNavigation.tsx`, validation answers | 06, 17 | Horizontally scroll the top row to reach all 12 panels. Selecting a panel replaces the terminal; terminal session continues in background. Row remains visible above IME. |
| **C02** | Config & preferences target | `components/organisms/SettingsModal.tsx`, `server/src/api/config.rs` | 06, 17 | Inspect and edit project-specific `dam-hopper.toml` vs global config vs client-local preferences. Changes save to appropriate target. |
| **T01** | Remote PTY lifecycle | `stores/terminal-store.ts`, `server/src/api/terminal.rs`, `server/src/pty/` | 07 | Create, list, switch, rename, kill, and restart remote PTY sessions. Sessions survive client disconnect and reconnect with identical incarnation. |
| **T02** | Terminal stream & input | `lib/terminal-buffer.ts`, `server/src/api/ws_protocol.rs` | 05, 07 | Stream live terminal output with UTF-8 byte continuity. Support IME input, screen resize, selection, copy/paste, and scrollback search. |
| **T03** | Agent status & correlation | `components/molecules/AgentStatusBadge.tsx`, `server/src/agent_status/` | 07 | Observe OMP/Codex/Claude agent hook status and PTY correlation. Server epochs and leases control status; client does not inject synthetic status. |
| **F01** | File tree & CRUD | `components/organisms/FileTree.tsx`, `server/src/fs/` | 08 | Expand project directory trees lazily. Create, rename, delete, and move files/directories. Real-time watch events update tree without full reload. |
| **F02** | Search & replace | `components/organisms/SearchPanel.tsx`, `server/src/fs/search.rs` | 08, 09 | Execute regex/text content search and filename search. Bounded to 500 matches with truncation notice. Execute safe single/multi-file replacements. |
| **E01** | Native code editor | `components/organisms/MonacoHost.tsx`, `server/src/fs/` | 05, 09 | Open text files in native editor. Multi-tab management, line numbers, syntax highlighting, undo/redo, text selection, find/replace in document. |
| **E02** | Save conflict & mtime protection | `stores/editor-store.ts`, `server/src/api/ws_protocol.rs` | 09 | Attempt saving a dirty buffer when remote mtime changed. Server rejects stale write; UI displays reload vs force overwrite conflict dialog. |
| **E03** | Diff & three-way merge | `components/organisms/DiffViewer.tsx`, `components/organisms/MergeConflictEditor.tsx` | 10 | Inspect side-by-side Git diffs; accept/revert hunks. Open merge conflict files, inspect ours/theirs/base panes, resolve conflicts, strip markers. |
| **E04** | Dirty-buffer Git blame | `components/organisms/GitBlameGutter.tsx`, `server/src/api/git_blame.rs` | 10 | Compute blame annotations factoring in unsaved dirty buffer changes via `/api/git/{project}/blame/buffer`. Display author, commit OID, date. |
| **X01** | OPAQUE encrypted transfer | `packages/ui/src/lib/crypto.ts`, `server/src/fs/encrypted_upload.rs` | 05, 11 | Perform zero-knowledge encrypted upload via OPAQUE PAKE key derivation. Server verifies chunks and checksums; client rejects tampering. |
| **M01** | Media & large-file viewer | `components/organisms/MediaViewer.tsx`, `server/src/api/media_session.rs` | 09, 11 | View images (PNG/JPEG/SVG) and video via ticketed media sessions. View raw binary and partial ranges for files exceeding 5 MiB tier boundary. |
| **G01** | Git status, history & staging | `components/organisms/GitPage.tsx`, `server/src/git/` | 12 | View branch list, status, stage/unstage files, create commits, fetch, pull, and push to remote repositories. |
| **G02** | Git branch rewrites & squash | `components/organisms/GitLogTree.tsx`, `server/src/git/` | 12 | Perform CAS-protected commit rewrites, contiguous commit squash, and branch resets on inactive branches. Rejects operations on active/foreign trees. |
| **G03** | Leased rewrite publication | `components/organisms/GitPublishModal.tsx`, `server/src/git/` | 12 | Publish rewritten branch refs using leased publication tied to exact expected OIDs. Never falls back to blind `--force` push. |
| **W01** | Workflow tracking & items | `components/organisms/WorkflowPanel.tsx`, `server/src/api/workflow/` | 13 | Create and update workflow items, link to active terminal sessions, record session notes, purge completed workflow history with CAS verification. |
| **W02** | Project plans & roadmaps | `components/organisms/ProjectPlansPanel.tsx`, `server/src/api/plans.rs` | 13 | List project plan folders and Markdown plans. Render plan tasks with checkbox states. Display explicit unsupported banner for Mermaid diagrams. |
| **S01** | Agent Store management | `components/organisms/AgentStorePanel.tsx`, `server/src/agent_store/` | 14 | Browse global Agent Store catalog. Ship items to project, unship, absorb into global catalog, and inspect symlink health. |
| **S02** | Agent import & memory | `components/organisms/AgentImportModal.tsx`, `server/src/api/agent_memory.rs` | 14 | Scan server directories for external agent configurations. Preview templates, apply memory templates, and update system prompts. |
| **H01** | Host fleet & metrics | `components/organisms/HostResources.tsx`, `server/src/api/system.rs` | 15 | Subscribe to authenticated SSE resource stream. Display CPU, RAM, disk usage graphs, and active resource threshold alerts. Fallback to REST. |
| **U01** | Usage metrics & sessions | `components/organisms/UsagePanel.tsx`, `server/src/api/usage.rs` | 15 | View aggregate token and session metrics. Browse token usage per session. Purge usage database with confirmation. |
| **P01** | Ports & Cloudflared tunnels | `components/organisms/PortsPanel.tsx`, `server/src/tunnel/` | 16 | Discover listening ports on server. Start Cloudflared tunnel for port, copy public URL, stop tunnel, receive background exposure warnings. |
| **H02** | Idle-suspend & consent | `components/organisms/IdleSuspendModal.tsx`, `server/src/idle_suspend/` | 16 | Monitor server idle-suspend timer. Respond to `host:uiConnection` live socket consent challenge. Render capability denial if disabled. |
| **C03** | Remote SSH keys & settings | `components/organisms/SshPanel.tsx`, `server/src/api/ssh.rs` | 16, 17 | List SSH keys on remote host, load keys into remote ssh-agent, trigger server cache clear, export/import TOML configuration. |
| **N01** | Notifications & alarms | `hooks/use-notifications.ts`, Android NotificationManager | 07, 17 | Post local Android notifications on background terminal exit, long-running command completion, or critical resource alerts. Redact sensitive text. |
| **V01** | Cognito privacy overlay | `components/organisms/CognitoOverlay.tsx` | 17, 18 | Toggle in-app visual privacy mask. Blurs screen and intercepts all touch/keyboard input to prevent accidental keystroke leakage to terminals. |

---

## 4. Explicit First-Release Exceptions

The following features are explicitly excluded from the initial Android release based on user approval and technical constraints:

| Exception ID | Excluded Feature | Approved First-Release Treatment | Parity Classification |
|---|---|---|---|
| **B01** | Embedded interactive HTML/JS browser preview | HTML files open in the native code editor as plain source code. No embedded WebView, Chromium, or external browser bridge. | Approved Exception |
| **B02** | Mermaid diagram DOM/SVG rendering | Markdown files containing Mermaid code blocks display the raw fenced code with an inline notice: `[Mermaid rendering unavailable in Android native client]`. | Approved Exception |
| **B03** | Browser debug & extension bridge | No Android browser extension bridge or Chrome DevTools Protocol debugging interface. Existing web extension is untouched. | Product Boundary |
| **B04** | Local Android PTY / Git / agents / SSH forward | Android client executes no local shell or Git commands. All executions run on the remote Rust server. | Architecture Invariant |
| **B05** | Desktop host, Play Store, push service | No desktop build, Google Play Store assets, or Firebase Cloud Messaging background service. | Out of Scope |
| **B06** | Remote updater / user administration APIs | Client does not invent self-update endpoints, server daemon restart commands, or account role promotion tools. | Security Invariant |
| **B07** | IDE workspace shell & Runtime presentation | Only TERMINAL mode and Traditional terminal presentation are built. IDE dock layouts and Runtime execution views are omitted. | User Shell Restriction |
| **B08** | Floating buttons (FABs) & draggable launchers | All buttons are docked inline in the top navigation row or within active panel bodies. No floating action buttons anywhere. | User UI Restriction |
| **B09** | Secondary navigation rails, bars, or drawers | Exactly one single-line horizontally scrolling navigation row below the header. No bottom navigation, sidebar rail, or drawer. | User UI Restriction |

---

## 5. Wire Contracts & Protocol Specifications

### 5.1 Authentication (authProtocol v2)
- **Base paths:**
  - `POST /api/auth/register` — `{ "username": "...", "password": "..." }` → `{ "ok": true }` (Creates disabled account, auth_version = 0).
  - `POST /api/auth/login` — `{ "username": "...", "password": "..." }` → `{ "token": "..." }` OR `{ "mfaRequired": true, "ticket": "..." }` OR `{ "enrollmentRequired": true, "ticket": "..." }`.
  - `POST /api/auth/mfa/setup` — Generates TOTP setup secret.
  - `POST /api/auth/mfa/confirm` — `{ "ticket": "...", "code": "..." }` → `{ "token": "...", "backupCodes": [...] }`.
  - `POST /api/auth/mfa/verify` — `{ "ticket": "...", "code": "..." }` → `{ "token": "..." }`.
  - `POST /api/auth/mfa/challenge` — `{ "ticket": "..." }` → `{ "qrCodeUri": "...", "secret": "..." }`.
  - `GET /api/auth/status` — Returns `{ "authenticated": bool, "user": "...", "roles": [...], "dev_mode": bool }`.
  - `POST /api/auth/logout` — Revokes session.
- **REST Bearer Header:** `Authorization: Bearer <token>` for all protected `/api/*` endpoints.

### 5.2 WebSocket Protocol (workbenchProtocol v2)
- **Endpoint:** `/ws`
- **Native Handshake Admission:** Must supply token as query parameter: `GET /ws?token=<bearer_token>` (per `server/src/api/ws.rs:144-152, 262-274`). Header-based bearer extraction is not supported by server WS handler; Origin header must not be faked.
- **Envelope Structure:** Hard cut: all messages use strict `{"kind": "..."}` tagging.
*(Implementation note: The typed transport foundation is implemented in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/` via polymorphic `ClientMsg` and `ServerMsg` with `ServerMsgSerializer` fallback to `ServerMsg.Unknown`, atomic `SerializedWsWriter`, and bounded `WsRequestCorrelator`. Feature-specific consumer handling is implemented across owning domain phases).*
- **Client to Server Frames (`ClientMsg`):**
  - `terminal:write` — `{ "kind": "terminal:write", "id": "<session_id>", "data": "<utf8_string>" }`
  - `terminal:resize` — `{ "kind": "terminal:resize", "id": "<session_id>", "cols": <u16>, "rows": <u16> }`
  - `terminal:attach` — `{ "kind": "terminal:attach", "id": "<session_id>", "from_offset": <u64_optional> }`
  - `fs:subscribe_tree` — `{ "kind": "fs:subscribe_tree", "req_id": <u64>, "project": "...", "worktree_path": "..."?, "path": "...", "watchOnly": bool? }`
  - `fs:unsubscribe_tree` — `{ "kind": "fs:unsubscribe_tree", "sub_id": <u64> }`
  - `fs:read` — `{ "kind": "fs:read", "req_id": <u64>, "project": "...", "worktree_path": "..."?, "path": "...", "offset": <u64>?, "len": <u64>?, "readMode": "text"|"base64"? }`
  - `fs:write_begin` — `{ "kind": "fs:write_begin", "req_id": <u64>, "project": "...", "worktree_path": "..."?, "path": "...", "expected_mtime": <i64>, "size": <u64>, "encoding": "base64"|"binary"? }`
  - `fs:write_chunk` — `{ "kind": "fs:write_chunk", "write_id": <u64>, "seq": <u32>, "eof": bool, "data": "<base64_data>" }`
  - `fs:write_chunk_binary` — `{ "kind": "fs:write_chunk_binary", "write_id": <u64>, "seq": <u32> }` (followed immediately by raw binary WS frame)
  - `fs:write_commit` — `{ "kind": "fs:write_commit", "write_id": <u64> }`
  - `fs:op` — `{ "kind": "fs:op", "req_id": <u64>, "op": "create_file"|"create_dir"|"rename"|"delete"|"move", "project": "...", "worktree_path": "..."?, "path": "...", "new_path": "..."?, "force_git": bool? }`
  - `fs:upload_begin` — `{ "kind": "fs:upload_begin", "req_id": <u64>, "upload_id": "...", "project": "...", "worktree_path": "..."?, "dir": "...", "filename": "...", "len": <u64> }`
  - `fs:upload_chunk` — `{ "kind": "fs:upload_chunk", "upload_id": "...", "seq": <u64> }` (followed immediately by raw binary WS frame)
  - `fs:upload_commit` — `{ "kind": "fs:upload_commit", "req_id": <u64>, "upload_id": "..." }`
  - `auth:register_start` — `{ "kind": "auth:register_start", "req_id": <u64>, "identifier": "...", "data": "<base64_opaque_registration_request>" }`
  - `auth:register_finish` — `{ "kind": "auth:register_finish", "req_id": <u64>, "identifier": "...", "data": "<base64_opaque_registration_upload>", "overwrite": bool? }`
  - `auth:login_start` — `{ "kind": "auth:login_start", "req_id": <u64>, "identifier": "...", "data": "<base64_opaque_credential_request>" }`
  - `auth:login_finish` — `{ "kind": "auth:login_finish", "req_id": <u64>, "session_id": "...", "data": "<base64_opaque_credential_finalization>" }`
  - `auth:session_remove` — `{ "kind": "auth:session_remove", "session_id": "..." }`
  - `fs:put_begin` — `{ "kind": "fs:put_begin", "req_id": <u64>, "upload_id": "...", "session_id": "...", "project": "...", "worktree_path": "..."?, "dir": "...", "filename": "...", "len": <u64>, "expected_mtime": <i64>? }`
  - `fs:put_chunk` — `{ "kind": "fs:put_chunk", "upload_id": "...", "seq": <u64> }` (followed immediately by raw binary WS frame)
  - `fs:put_commit` — `{ "kind": "fs:put_commit", "req_id": <u64>, "upload_id": "..." }`
  - `fs:put_save` — `{ "kind": "fs:put_save", "req_id": <u64>, "session_id": "...", "project": "...", "worktree_path": "..."?, "path": "..." }` (followed immediately by raw binary WS frame)
- **Server to Client Frames (`ServerMsg`):**
  - `terminal:output` — `{ "kind": "terminal:output", "id": "<session_id>", "data": "<string>", "offset": <u64>, "incarnation": <u64> }`
  - `terminal:buffer` — `{ "kind": "terminal:buffer", "id": "<session_id>", "data": "<base64>", "offset": <u64>, "reset": bool, "truncated": bool, "incarnation": <u64> }`
  - `terminal:exit` — `{ "kind": "terminal:exit", "id": "<session_id>", "exitCode": <i32_optional>, "willRestart": bool, "restartIn": <u64>?, "restartCount": <u32>?, "incarnation": <u64>? }`
  - `terminal:lifecycle` — `{ "kind": "terminal:lifecycle", "id": "<session_id>", "lifecycle": "...", "generation": <u64>, "command": "..."? }`
  - `terminal:lagged` — `{ "kind": "terminal:lagged", "dropped": <u64> }`
  - `terminal:agentStatusChanged` — `{ "kind": "terminal:agentStatusChanged", "serverEpoch": <u64>, "revision": <u64>, "row": {...}, "attention": {...}? }`
  - `terminal:agentStatusRemoved` — `{ "kind": "terminal:agentStatusRemoved", "serverEpoch": <u64>, "revision": <u64>, "terminalId": "...", "incarnation": <u64> }`
  - `terminal:agentStatusInvalidated` — `{ "kind": "terminal:agentStatusInvalidated", "serverEpoch": <u64>, "revision": <u64> }`
  - `process:restarted` — `{ "kind": "process:restarted", "id": "...", "restartCount": <u32>, "previousExitCode": <i32>? }`
  - `fs:tree_snapshot` — `{ "kind": "fs:tree_snapshot", "req_id": <u64>, "sub_id": <u64>, "nodes": [...] }`
  - `fs:event` — `{ "kind": "fs:event", "sub_id": <u64>, "event": { "kind": "create"|"modify"|"delete"|"rename", "path": "...", "from": "..."?, "targetRelativePath": "..."?, "targetRelativeFrom": "..."? } }`
  - `fs:error` — `{ "kind": "fs:error", "req_id": <u64>, "code": "...", "message": "..." }`
  - `fs:overflow` — `{ "kind": "fs:overflow", "sub_id": <u64>, "message": "..." }`
  - `fs:read_result` — `{ "kind": "fs:read_result", "req_id": <u64>, "ok": bool, "mime": "..."?, "binary": bool, "mtime": <i64>?, "size": <u64>?, "data": "..."?, "code": "..."? }`
  - `fs:write_ack` — `{ "kind": "fs:write_ack", "req_id": <u64>, "write_id": <u64> }`
  - `fs:write_chunk_ack` — `{ "kind": "fs:write_chunk_ack", "write_id": <u64>, "seq": <u32> }`
  - `fs:write_result` — `{ "kind": "fs:write_result", "write_id": <u64>, "ok": bool, "new_mtime": <i64>?, "conflict": bool, "error": "..."? }`
  - `fs:op_result` — `{ "kind": "fs:op_result", "req_id": <u64>, "ok": bool, "error": "..."? }`
  - `fs:upload_begin_ok` — `{ "kind": "fs:upload_begin_ok", "req_id": <u64>, "upload_id": "..." }`
  - `fs:upload_chunk_ack` — `{ "kind": "fs:upload_chunk_ack", "upload_id": "...", "seq": <u64> }`
  - `fs:upload_result` — `{ "kind": "fs:upload_result", "req_id": <u64>, "upload_id": "...", "ok": bool, "new_mtime": <i64>?, "error": "..."? }`
  - `auth:register_start_response` — `{ "kind": "auth:register_start_response", "req_id": <u64>, "ok": bool, "data": "<base64_opaque_registration_response>"?, "error": "..."? }`
  - `auth:register_finish_response` — `{ "kind": "auth:register_finish_response", "req_id": <u64>, "ok": bool, "error": "..."? }`
  - `auth:login_start_response` — `{ "kind": "auth:login_start_response", "req_id": <u64>, "ok": bool, "session_id": "..."?, "data": "<base64_opaque_credential_response>"?, "error": "..."? }`
  - `auth:login_finish_response` — `{ "kind": "auth:login_finish_response", "req_id": <u64>, "ok": bool, "session_id": "..."?, "error": "..."? }`
  - `fs:put_begin_ok` — `{ "kind": "fs:put_begin_ok", "req_id": <u64>, "upload_id": "..." }`
  - `fs:put_chunk_ack` — `{ "kind": "fs:put_chunk_ack", "upload_id": "...", "seq": <u64> }`
  - `fs:put_result` — `{ "kind": "fs:put_result", "req_id": <u64>, "upload_id": "...", "ok": bool, "conflict": bool, "new_mtime": <i64>?, "error": "..."? }`
  - `fs:put_save_result` — `{ "kind": "fs:put_save_result", "req_id": <u64>, "ok": bool, "new_mtime": <i64>?, "error": "..."? }`
  - `tunnel:created` — `{ "kind": "tunnel:created", "id": "...", "port": <u16>, "label": "...", "driver": "...", "status": "...", "startedAt": <i64>, "reminderDue": bool }`
  - `tunnel:ready` — `{ "kind": "tunnel:ready", "id": "...", "url": "..." }`
  - `tunnel:failed` — `{ "kind": "tunnel:failed", "id": "...", "error": "..." }`
  - `tunnel:stopped` — `{ "kind": "tunnel:stopped", "id": "..." }`
  - `tunnel:reminder` — `{ "kind": "tunnel:reminder", "id": "..." }`
  - `port:discovered` — `{ "kind": "port:discovered", "port": <u16>, "session_id": "...", "incarnation": <u64>, "project": "..."?, "detected_via": "...", "state": "..." }`
  - `port:lost` — `{ "kind": "port:lost", "port": <u16>, "session_id": "...", "incarnation": <u64> }`
  - `host:uiConnection` — `{ "kind": "host:uiConnection", "version": <u32>, "connectionId": "...", "decisionCapability": "..." }`

### 5.3 Filesystem Search REST API
- **Endpoint:** `GET /api/fs/search`
- **Query parameters (`SearchParams`, camelCase):**
  - `project=<string>` — Required for default project scope; omitted for workspace scope.
  - `worktreePath=<string>?` — Optional worktree relative path (rejected if `scope="workspace"`).
  - `q=<string>` — Search term / regular expression.
  - `case=<bool>?` — Case sensitivity flag (defaults to `false`).
  - `max=<usize>?` — Maximum matches requested (defaults to 200, strictly capped at `ops::MAX_SEARCH_RESULTS` = 500).
  - `scope=<"project"|"workspace">` — Scope selector (defaults to `"project"`).
- **Response (`SearchResponse`):** `{ "query": "...", "matches": [{ "path": "...", "line": <usize>, "content": "..." }], "truncated": bool }`.
- **Path Search Endpoint:** `GET /api/fs/search-paths` with identical query parameters, returning `PathSearchResponse` `{ "query": "...", "matches": [{ "path": "...", "isDir": bool }], "truncated": bool }`.

### 5.4 Server-Sent Events (SSE) Stream
- **Path:** `GET /api/system/resources/v1/events`
- **Headers:** `Authorization: Bearer <token>`, `Accept: text/event-stream`.
- **Handshake & Parameters:** No query parameters required. On connect, stream immediately sends initial status control bytes followed by live resource snapshot and alert frames.
- **Admission Limits:** Server enforces strict capacity via middleware layers:
  - Global limit: 32 active concurrent subscriber streams. Exceeding returns HTTP 429 (`HOST_RESOURCE_STREAM_LIMIT`, Retry-After: 30).
  - Per-subject limit: 4 active concurrent subscriber streams per user subject. Exceeding returns HTTP 429 (`HOST_RESOURCE_STREAM_LIMIT`, Retry-After: 30).
  - Shutdown state: Returns HTTP 503 (`AUTH_UNAVAILABLE`).
- **Client Fallback:** If SSE connection fails or receives 429/503, native client gracefully falls back to periodic REST polling `GET /api/system/metrics` with on-demand `/api/system/resources/v1/alerts`.
*(Implementation note: The authenticated SSE event stream and bounded frame parsing are implemented in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/HostResourceSseClient.kt` with a 256 KiB data cap, 4 KiB status cap, strict status-data revision adjacency pairing, and connection generation fencing. Domain-level REST polling fallback and telemetry presentation belong to Phase 15).*

### 5.5 Media Session & Streaming Protocol
- **Issue Video Ticket:** `POST /api/fs/video/tickets` with `{ "project": "...", "worktreePath": "..."?, "path": "...", "purpose": "view"|"download", "mediaClientId": "..." }`.
- **Issue Image Ticket:** `POST /api/fs/image/tickets` with identical payload structure.
- **Ticket Response:** HTTP 201 Created with JSON `{ "ticket": "...", "streamPath": "/api/fs/<video|image>/stream/{ticket}", "expiresAt": <u128_epoch_ms>, "purpose": "view"|"download", "authorizationMode": "session-cookie-v2" }` and HTTP response header `Set-Cookie: damhopper-media-...`.
- **Cookie & Origin Authorization:**
  - Browser clients rely on same-origin cookie validation or configured CORS allowed-origins.
  - Native Android client manages the session cookie via its HTTP engine (e.g. OkHttp `CookieJar`) and supplies it on stream requests to `GET /api/fs/video/stream/{ticket}` and `GET /api/fs/image/stream/{ticket}`. Native client does not forge browser Origin headers.
- **Ticket & Session Revocation:**
  - Revoke single ticket: `DELETE /api/fs/video/tickets` or `DELETE /api/fs/image/tickets` with `{ "ticket": "...", "mediaClientId": "..." }`.
  - Revoke entire media session: `DELETE /api/fs/media-session` with `{ "mediaClientId": "..." }`.
- **Range Requests & Streaming:** Supports standard HTTP `Range: bytes=start-end` (`206 Partial Content`) for video seeking and chunked media playback.
- **General Large / Binary Files:** Non-media files exceeding 5 MiB tier boundary are accessed via chunked range reads (`fs:read` over WS or `GET /api/fs/read?offset=...&len=...`) with hex/raw representation in the native editor rather than media tickets.
---

## 6. Native Editor & Language Service Parity Plan

### 6.1 Feature Inventory (Monaco Baseline in Web)
The web client Monaco implementation (`packages/ui/src/components/organisms/MonacoHost.tsx`) provides:
1. Syntax highlighting for 40+ programming languages.
2. Code folding, minimap, line numbers, cursor position, and glyph margin / git gutters.
3. Multiple tabs with dirty buffer tracking, mtime timestamp checks on save, and reload/overwrite prompts.
4. Inline and side-by-side diff viewers (`DiffViewer.tsx`) with hunk revert.
5. Three-way merge conflict editor (`MergeConflictEditor.tsx`) resolving base, ours, and theirs blocks.
6. JSON Worker: Schema validation, error squigglies, auto-completion for `package.json`, `tsconfig.json`, `dam-hopper.toml`.
7. TypeScript Worker: In-editor syntax and semantic diagnostics for TypeScript/JavaScript.

### 6.2 Native Implementation Strategy & Hard Gates
- **Evaluation Candidate:** Sora Editor (`io.github.rosemoe.sora-editor`) or equivalent native Android text rendering engine.
- **Parity Requirements for Phase 05 Evaluation:**
  - Fast text rendering with custom glyph/gutter drawing for line numbers and Git status.
  - Native Android `InputConnection` integration for IME keyboards (Gboard, SwiftKey, Samsung Keyboard, Asian multi-stage composition).
  - Multi-tab dirty buffer model maintaining edits across panel switches.
- **Language Service Strategy:**
  - Fast local Tree-sitter or regex-based syntax tokenization on Android.
  - Native JSON schema validation using lightweight JVM/Kotlin libraries.
  - Hard Gate: If local TypeScript/JavaScript worker parity cannot be achieved on Android, this limitation is an architectural blocker in Phase 05 requiring an explicit user scope decision before proceeding; the server does not currently host an LSP daemon, and no backend LSP capabilities or silent parity reductions are assumed.

---

## 7. Device, OS, Performance & Security Matrix

### 7.1 Target Hardware & OS Matrix
- **Proposed Reference Physical Device:** Google Pixel 7 (SoC: Google Tensor G2, Arch: `arm64-v8a`, RAM: 8 GB). Android 14 / 15. *(Note: Physical device availability is a mandatory prerequisite for Phase 05 GATE-B native terminal, editor, IME, and crypto-bridge qualification, and Phase 18 full qualification; x86_64 AVD emulator qualification serves as interim companion).*
- **Primary Reference Emulator:** Android Virtual Device (AVD), Android 15 (API 35), `x86_64` architecture, Google APIs image.
- **Minimum OS Target:** Android 10 (API 29).
- **16 KiB Memory Page Size Target:** Specific Android 15 emulator configured with 16 KiB kernel page size to validate JNI libraries (`libcrypto_bridge.so`, `libvterm.so`) against Google's upcoming 16 KiB alignment mandate.

### 7.2 Performance Budgets
All measurements to be validated in Phase 18 on the reference target:
- **Cold App Startup:** < 1500 ms from launch icon tap to interactive terminal cursor.
- **Warm App Resume:** < 500 ms to restore active panel state.
- **Terminal Rendering:** Stable 60 fps (<= 16.6 ms per frame) during active PTY throughput; input-to-display latency < 50 ms.
- **Memory Footprint:** Baseline app memory < 120 MB RSS with 3 active PTY sessions and 5 open editor buffers.
- **UI Responsiveness:** Zero dropped frames (jank < 1%) during horizontal panel navigation row scrolling and file tree expansion.

### 7.3 Security & Cryptographic Custody
- **Keystore Isolation:** Android Keystore (`AndroidKeyStore`) stores AES-GCM wrapping keys for the user's Bearer token.
- **Zero Plaintext Credentials:** Passwords, TOTP seeds, and OPAQUE PAKE intermediate states are never written to disk, SharedPreferences, or unencrypted storage.
- **OPAQUE PAKE Protocol:**
  - Suite: `opaque-ke` v4, Ristretto255, TripleDH-SHA512.
  - Key derivation: HKDF-SHA256 with info string `dam-hopper-aes-256-gcm-v1` producing 32-byte AES-GCM encryption keys.
- **Keystore Custody:**
  - Development builds use standard local Android debug keystores (`~/.android/debug.keystore`).
  - Release APK signing key is held strictly offline by the repository owner/operator; private keys and credentials are never stored in version control or CI plain logs.

### 7.4 Licensing Compliance
- Permissive licenses (Apache 2.0, MIT, BSD 2/3-Clause) are approved for all runtime dependencies.
- LGPL 2.1 dependencies (e.g. Sora Editor): Consuming an AAR via Gradle embeds bytecode directly into APK DEX files and does not automatically satisfy LGPL 2.1 relinking/replacement obligations. A version-specific licensing audit covering copyright notices, corresponding source, and compliant relinking/replacement mechanisms is mandatory prior to approving any LGPL dependency in Phase 05.
- GPLv3 libraries are strictly prohibited from native client distribution binaries.

### 7.5 Phase 02 Toolchain & Security Baseline
- **Toolchain Pins (`native-app/gradle/libs.versions.toml`, `gradle-wrapper.properties`):**
  - Gradle: 8.11.1 (distribution SHA-256 `f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`).
  - Android Gradle Plugin (AGP): 8.7.3.
  - Kotlin: 2.1.10 (`multiplatform`, `serialization`, `compose`).
  - Compose Multiplatform: 1.7.3 (`org.jetbrains.compose`).
  - Kotlinx: Coroutines 1.10.1, Serialization 1.8.0, Datetime 0.6.1.
  - Ktor Client: 3.1.0 (OkHttp & Java engines staged).
  - SDK / Bytecode: minSdk 29, targetSdk 35, compileSdk 35, Java 17 target.
  - ABI targets: `arm64-v8a` and `x86_64`.
- **Security & Isolation Policies:**
  - Network Security: Release base config enforces `cleartextTrafficPermitted="false"` with system CA trust anchors. Debug config permits cleartext strictly for local loopback development (`10.0.2.2`, `127.0.0.1`, `localhost`) with user certificates.
  - Data Extraction & Backup: Manifest disables backup (`android:allowBackup="false"`, `android:fullBackupContent="false"`). Data extraction rules (`data_extraction_rules.xml`) exclude `.` from both `<cloud-backup>` and `<device-transfer>`.
  - IME Configuration: Manifest configures `android:windowSoftInputMode="adjustResize"` to request window resizing when the software keyboard opens (visual dock stability across virtual keyboards pending device testing).
  - Web Engine Exclusion: Prohibits WebView or Tauri dependencies (0 occurrences detected in `native-app/shared/src/` or `native-app/androidApp/src/main/` by static verification).

### 7.6 Phase 03 Contracts Ownership & Transport Baseline
- **Ownership & Lifecycle Models (`core/model/`):**
  - `ConnectionRef(profileId, generation)`: Immutable profile connection epoch identifier producing deterministic tuple keys `["profileId", generation]` compatible with TypeScript web client conventions.
  - `SocketInstanceRef(connection, socketId)`: Scopes socket attempt lifecycle within a `ConnectionRef`, producing tuple keys `["profileId", generation, "socketId"]`. Ensures socket-bound capabilities (e.g. `host:uiConnection`) are revoked on reconnect.
  - `ProjectTargetRef(profileId, project, worktreePath)`: Normalizes project target worktree paths and produces server-safe payloads via `toServerPayload()` without exposing client profile IDs.
  - `ConnectionOwnerError`: Standard typed error carrying explicit reasons (`STALE`, `UNAVAILABLE`, `OWNER_MISMATCH`, `AUTH_REQUIRED`).
- **Generation Fencing & In-Memory Watermarks (`core/ownership/ConnectionRegistry.kt`):**
  - Manages active generations per profile under coroutine `Mutex` synchronization.
  - Monotonic in-memory generation watermarks (`generationWatermarks`) persist across profile removal within the registry/process lifetime, preventing ABA generation collisions on profile re-creation during runtime.
  - Strict owner validation: `assertCurrentOwner` gates request initiation and completion across REST, WebSocket, and SSE.
  - Dispatches retirement events to registered listeners (`retirementListeners`) upon generation advance.
- **REST API Client (`core/transport/ApiClient.kt`):**
  - Scoped to an immutable `ConnectionRef` with base URL normalization.
  - Redirect following disabled (`followRedirects = false`) to prevent auth token leakage across cross-origin redirects.
  - Structured concurrency: immediately rethrows `CancellationException` before error wrapping.
  - Parses server error responses (`{ "code": "...", "error": "..." }`) and `Retry-After` headers into typed `ApiRequestError`.
- **URL & Diagnostic Sanitization (`core/transport/ApiErrors.kt`):**
  - `redactUrl()` sanitizes query parameters (`([?&]token=)[^&]+`) and user-info credentials (`((?:https?|wss?)://[^:/@]+:)[^@]+(@)`) across HTTP, HTTPS, WS, and WSS schemes.
  - Masks `decisionCapability=[REDACTED]` in `ServerMsg.UiConnection.toString()` and `UiConnectionReceipt.toString()`.
- **Live WebSocket Transport (`core/transport/WsConnection.kt`):**
  - Origin-less handshake URL: `GET /ws?token=<token>` avoids synthetic browser `Origin` headers.
  - Exact-socket receipts: `host:uiConnection` creates `UiConnectionReceipt` bound to `SocketInstanceRef`, revoked immediately on close, error, or reconnect.
  - Maps server close codes to typed `WsState`: `4403` (`MfaRequired`), `4401` (`LoginRequired`), `1013` (`AuthUnavailable`), `4001` (`Overflow`).
  - Socket-instance fencing: `handleCloseReason` and `handleSocketFailure` verify `activeSocketRef == socketRef` before modifying state or closing sessions.
- **Atomic Application Frame Writer (`core/transport/SerializedWsWriter.kt`):**
  - Mutex-guarded transmission prevents interleaving of text JSON headers and binary frames.
  - Atomic pairs (`sendAtomicPair`) for chunked binary uploads (`fs:write_chunk_binary`, `fs:upload_chunk`) abort the session with `CloseReason.Codes.PROTOCOL_ERROR` if partial failure occurs after header delivery.
- **Bounded Request Correlator (`core/transport/WsRequestCorrelator.kt`):**
  - Bounds concurrent in-flight requests (default `maxInFlight = 256`), throwing `UNAVAILABLE` on overflow.
  - Request timeout handling unregisters pending requests (`unregister(reqId)`) to eliminate capacity leaks.
  - Cancels all pending requests upon socket disconnect or replacement.
- **Bounded SSE Client (`core/transport/HostResourceSseClient.kt`):**
  - Enforces strict memory caps: 256 KiB for data events (`MAX_DATA_EVENT_BYTES`) and 4 KiB for control/status events (`MAX_CONTROL_EVENT_BYTES`).
  - Strict status-data adjacency: data frames require an immediately preceding status frame with identical `serverEpoch` and `revision`. Comments (`: ping`) clear preceding status to prevent stale pairing.
- **Android Platform Network Factory (`platform/network/AndroidHttpClientFactory.kt`):**
  - Pinned OkHttp engine configuration: 15s connect timeout, 30s read/write timeouts, 15s WebSocket ping interval, and disabled redirects (`followRedirects(false)`, `followSslRedirects(false)`).
  - Enforces Android `network_security_config.xml` TLS-only release policy.
---

## 8. Gate Approvals & Implementation Sequence

- **GATE-A1 (Scope & Contract Freeze):** **PASSED** in Phase 01. Complete feature inventory, panel registry, wire DTO schemas, and explicit exclusions frozen.
- **GATE-A2 (Foundation & Toolchain):** **FOUNDATION & SECURITY VERIFIED (Launch Qualification Open)** in Phase 02. Two-module Gradle KMP architecture (`:shared`, `:androidApp`), pinned toolchain catalog, 12-panel registry enum, Compose entry with `statusBarsPadding()`, manifest/network security policies, and root scripts (`pnpm native-app:test`, `pnpm native-app:test:android`, `pnpm native-app:assembleDebug`) implemented. Automated static verification script `tests/test-phase-02-foundation.sh` passes 47/47 static assertions. Physical ARM64 device and x86_64 emulator runtime launch qualification remain pending device attachment.
- **Phase 03 (Contracts Ownership & Live Transport Foundation):** **IMPLEMENTED (Qualification Open)** in Phase 03 (2026-10-15). Complete owner-bound networking layer implemented in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/` and `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/`. Verified by 48/48 static transport assertions in `tests/test-phase-03-transport.sh`, 28/28 shared JVM unit tests in `pnpm native-app:test`, and clean `pnpm native-app:assembleDebug`. Live Axum daemon lifecycle qualification and device runtime attachment remain open.
- **GATE-B (Native Terminal, Editor & Crypto Proof):** Pending Phase 05 (Real device proof of terminal input/replay, editor model, and OPAQUE JNI interop).
- **GATE-C (Integrated Qualification):** Pending Phase 18 (Real server tests, end-to-end user journeys, visual review).
- **GATE-D (Signed Release APK):** Pending Phase 19 (Production signed APK, upgrade testing, audit handoff).
