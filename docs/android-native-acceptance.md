# Android Native Client — Scope Baseline and Acceptance Ledger

**Document status:** Phase 18 qualification ledger. The broader panel inventory below preserves the approved product scope; it does not describe the current root's reachable screens. `MainActivity` currently exposes Profile Login → Project List → Project Terminal; the distinct 12-panel shell is not mounted. Live-server and physical-device qualification remain open.

**GATE-A1 Scope Status:** Approved in Phase 01. **GATE-A2 Toolchain & Foundation:** Foundation and security verified in Phase 02 (47/47 static assertions). **Phase 03 Transport & Ownership Foundation:** Implemented and statically verified (Cycle 2 Review 8.8/10; 48/48 static assertions, 28/28 shared JVM tests). **Phase 04 Profiles, Auth & Vault:** Implemented and verified (57/57 static assertions, 60 unit tests). **GATE-B (Runtime Feasibility):** Contract/host prototype validated in Phase 05 (336 total automated checks passed; Android runtime feasibility, physical hardware execution, and TS engine decision open). **Phase 06 Traditional Shell, Projects & Config:** Implemented (Cycle 2 Review 9.4/10; 64/64 static assertions, 25 JVM/Android unit tests passing; physical hardware runtime qualification deferred to Phase 18). **Phase 07 Terminal Sessions, Replay, Input & Agents:** Host-contract implementation verified (Cycle 2 Review 8.8/10; 45/45 static assertions; recorded QA report notes 155 JVM/Android unit tests passing; live emulator canvas integration, physical terminal rendering, IME behavior, and server-backed replay remain open qualification gates deferred to Phase 18). **Phase 08 Filesystem Watchers, Search and Replace:** Implementation baseline recorded (Cycle 2 Review 6/10; 57/57 static source assertions in `tests/test-phase-08-filesystem-watchers.sh`; unblocks Phase 09). **Phase 09 Native Editor Language Services & Safe Saves:** Implemented and baseline recorded (Cycle 2 Review 6/10 user-approved with documented open limitations: candidate Compose TextField adapter, TypeScript semantic intelligence blocked pending runtime decision, encrypted save failing closed until Phase 11; 70 static assertions, 219 unit test executions). **Phase 10 Native Diff, Merge & Blame:** Implemented and verified (Cycle 5 Review 9/10 user-approved; 77 static assertions in `tests/test-phase-10-diff-merge-blame.sh`, 246 unit tests passing, 531 cumulative static assertions across Phases 02–10; unblocks Phase 11). **Phase 11 Encrypted Transfers, Media & Storage:** Implementation baseline recorded (Cycle 2 Review 5/10; scaffolding delivered with documented open integration/security limitations; 84 static assertions, 7 Rust crypto tests). **Phase 12 Complete Git & Safe History:** Implementation baseline recorded (score 6/10; 139 static assertions, 292 unit test runs). **Phase 13 Workflow & Plans:** Implemented and verified (100 static assertions, 274 unit tests). **Phase 14 Agent Store, Memory & Imports:** Implemented (score 7/10; 99 static assertions, 303 unit tests). **Phase 15 Host Resources & Usage:** Implemented (score 7/10; 81 static assertions, 398 unit tests). **Phase 16 Ports, Tunnels, Consent & Host Controls:** Implemented (score 7/10; 194 static assertions, 417 unit tests). **Phase 17 Preferences, Privacy & Lifecycle:** Implemented (score 6/10; 104 static assertions, 454 unit tests). **Phase 18 Device Qualification Tooling:** Tooling baseline recorded (score 6/10; 98 static assertions, 481 unit test executions, 13 security checks; GATE-C BLOCKED_PENDING_DEVICE).
**Baseline commit:** `d897a91f76a07ec819a50ffc2756cb69327b2fe3` (server v0.13.2, workbenchProtocol v2, authProtocol v2).  
**Working tree provenance:** Branch `feat/android-native-app`. Preserves pre-existing planning files and architecture documents.  
**Authority:** [User Decisions](../plans/261015-1647-android-native-app/research/decision-context.md), [Current Architecture](./architecture/android-native-client.md), [Validation Answers](../plans/261015-1647-android-native-app/validation-answers.md).
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
| **E01** | Native code editor | `components/organisms/MonacoHost.tsx`, `server/src/fs/` | 05, 09 | Open text files in native editor. Multi-tab management (`EditorTabsState`), in-memory session (`EditorSession`) with submitted-bytes baseline tracking and bounded undo/redo, text selection, find/replace, line numbers, JSON AST symbols/diagnostics, TS/JS delimiter/keyword scanner, Compose editor with Sora candidate metadata indicator (physical native canvas deferred to Phase 18). Verified by 70 static assertions in `tests/test-phase-09-editor-saves.sh`. |
| **E02** | Save conflict & mtime protection | `stores/editor-store.ts`, `server/src/api/ws_protocol.rs` | 09 | Attempt saving dirty buffer when remote mtime changed. Server rejects stale write; UI displays reload vs force-overwrite conflict dialog (`SaveConflictDialog`). Safe-save protocol: CAS mtime checking, atomic tab transforms, UnknownOutcome timeout handling, clean auto-reload vs dirty stale flags (`isStale = true`), `discardAndReloadTab`, and authoritative `isDirtyFile` wired to `ReplaceCoordinator`. Verified by 70 static assertions. |
| **E03** | Diff & three-way merge | `components/organisms/DiffViewer.tsx`, `components/organisms/MergeConflictEditor.tsx` | 10 | Inspect side-by-side (`DiffLayoutMode.SIDE_BY_SIDE`) and inline (`DiffLayoutMode.INLINE`) Git diffs via `DiffReviewScreen`. Revert mapped server hunks (`POST /api/git/{project}/discard-hunk`) with dirty buffer, local draft, and read-only guards. Save modified working-tree diffs with CAS `baselineMtime` protection (subject to documented limitations: saves write to `target` without `query.root` specialization, and post-save reload resets in-flight concurrent edits). Inspect historical commit diffs in read-only mode and return via `exitCommitDiff()`. Open merge conflict files in `MergeConflictScreen`, parse 2-way and 3-way/diff3 markers (`ConflictParser`), resolve individual or all blocks (ours, theirs, ancestor, both), validate absence of malformed or remaining markers, and submit resolutions (`POST /api/git/{project}/resolve`). Verified by 77 static assertions in `tests/test-phase-10-diff-merge-blame.sh`. |
| **E04** | Dirty-buffer Git blame | `components/organisms/GitBlameGutter.tsx`, `server/src/api/git_blame.rs` | 10 | Compute and render line-by-line Git blame annotations via `EditorBlameGutter` and `BlameRepository`. Enforce 5 MiB UTF-8 buffer threshold (`GIT_BLAME_MAX_BUFFER_BYTES`), 250ms keystroke debounce with per-file coroutine job cancellation, CRLF/LF line count metrics (`computeBufferLineCount`), and strict contiguous partition validation covering `[1..bufferLineCount]` (`BlameValidator`). Cache completed responses in bounded 64-entry / 32 MiB LRU cache (`BlameCache`) keyed by multi-dimensional identity and SHA-256 buffer fingerprint. Click attributed commits to inspect historical diffs in `DIFF` panel without discarding dirty editor buffers. Verified by 77 static assertions in `tests/test-phase-10-diff-merge-blame.sh`. |
| **X01** | OPAQUE encrypted transfer | `packages/ui/src/lib/crypto.ts`, `server/src/fs/encrypted_upload.rs` | 05, 11 | Perform zero-knowledge encrypted upload via OPAQUE PAKE key derivation. Server verifies chunks and checksums; client rejects tampering. |
| **M01** | Media & large-file viewer | `components/organisms/MediaViewer.tsx`, `server/src/api/media_session.rs` | 09, 11 | View images (PNG/JPEG/SVG/GIF/WEBP/ICO/BMP/AVIF) and video (MP4/WEBM/OGG/MKV/MOV/M4V) via preview card (`MediaPreviewCard`, preview-only). Exact size boundaries: < 1 MiB normal, ≥ 1 MiB and < 5 MiB degraded, ≥ 5 MiB large 64 KiB range pager (`loadLargeFileRange`), binary hex view (`BinaryHexView`). Markdown preview (`MarkdownPreviewView`) with Mermaid deferred banner. Ticketed media sessions deferred to Phase 11. Verified by 70 static assertions. |
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

### 6.3 Phase 09 Realization & Hard Gate Status
- **Native Text Editor Surface:** Implemented via Compose `TextField` with synchronized line number gutters and adapter candidate indicator in `NativeTextEditorView.kt`. Pinned candidate adapter metadata (`CandidateEditorAdapter`) evaluates Sora Editor 0.23.4 (`io.github.rosemoe.sora-editor:editor:0.23.4`, LGPL-2.1-or-later); physical native canvas embedding, custom glyph drawing, and relinking verification are deferred to Phase 18 device qualification.
- **Language Intelligence & Hard Gate Audit:**
  - `JsonLanguageService` provides offline non-browser JSON parsing (`kotlinx.serialization`), structural AST diagnostics (line/column syntax error mapping), property completion, and document symbol hierarchy.
  - `TsJsLanguageService` provides offline delimiter matching and keyword scanning with quote-before-comment precedence across `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`.
  - **Hard Gate Status:** Full semantic TypeScript/JavaScript diagnostics (type hover, compiler diagnostics, symbol definitions, auto-imports) remain formally BLOCKED per `TypeScriptLanguageServiceAudit` (`STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"`). The remote server hosts no LSP daemon and web-workers are excluded; achieving full semantic parity requires an embedded JavaScript runtime (QuickJS, Hermes, or V8 JNI) or server-side LSP routing.
  - `LanguageServiceCoordinator` enforces multi-dimensional request and response watermarks (`fileWatermarks`, `qualifiedWatermarks` scoped to `Triple<documentKey, sessionIncarnation, ownerProfileId>`), safely discarding out-of-order asynchronous responses.
- **Safe-Save Protocol & Size Tier Routing:** Delivered in `EditorTabSaveCoordinator`, `EditorSession`, `EditorRepository`, `EditorTabsState`, and `FileTierPolicy`, ensuring dirty buffers are never silently clobbered, CAS mtime conflicts are surfaced interactively, and large files are read in bounded 64 KiB chunks.
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
  - Network Security: Release base config enforces `cleartextTrafficPermitted="false"` with system CA trust anchors. Debug base config permits cleartext to any host and debug overrides trust system plus user-installed CAs. This is a debug-only transport allowance; authenticated Wi-Fi login should use HTTPS. Profile Login blocks password/MFA over HTTP and stored tokens over HTTP for non-development endpoints. Never expose `--no-auth` over Wi-Fi/LAN.
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

### 7.7 Phase 04 Profiles, Authentication, MFA & Credential Vault Baseline
- **Multi-Server Profile Lifecycle (`features/profiles/`):**
  - `ProfileRepository`: Manages multi-server profile instances (`ServerProfile`), active selection (`activeProfileId`), and status projection (`authStatuses`).
  - `ServerProfile`: Strict URL validation via `validateServerUrl` enforces HTTP/HTTPS scheme, rejects user credentials in URL authority, query parameters, and fragments, and maps Android emulator loopback addresses (`10.0.2.2`).
  - `ProfileMetadataStore` & `AndroidProfileMetadataStore`: Persists non-secret profile metadata in Android `SharedPreferences` under key `damhopper_server_profiles`.
- **Android Keystore Credential Custody (`platform/vault/AndroidCredentialVault.kt`):**
  - `CredentialVault` contract: Keyed by `token:${profileId}:${baseUrl}`. Restricts storage strictly to Bearer session tokens; passwords, challenge tokens, and TOTP setup secrets are never persisted.
  - Keystore-backed `EncryptedSharedPreferences`: Employs `MasterKey` (`AES256_GCM`) with `AES256_SIV` key encryption and `AES256_GCM` value encryption.
  - Fail-Closed Key Handling: Throws `VaultKeyInvalidatedException` on key invalidation or corruption; never falls back to unencrypted plaintext storage.
  - Data Extraction & Backup Exclusion: `data_extraction_rules.xml` excludes `sharedpref` domain from both `<cloud-backup>` and `<device-transfer>`, and manifest enforces `android:allowBackup="false"`.
- **Attempt Watermark Fencing (`features/profiles/AuthAttemptTracker.kt`):**
  - Fences asynchronous authentication calls against concurrent lifecycle modifications.
  - `AuthAttemptTracker.startAttempt(profileId)` generates monotonically increasing `AuthAttemptRef(profileId, attemptId)`.
  - `assertActive(attempt)` gates session token installation; late or outdated callbacks throw `AuthAttemptStaleException`.
  - Profile endpoint updates, deletions, and logouts call `attemptTracker.invalidate(profileId)` to retire pending attempt watermarks immediately.
- **Frozen Protocol v2 Authentication & TOTP MFA (`features/profiles/AuthRepository.kt`):**
  - Protocol Version Gates: `AuthResponseParser` and `AuthStatusParser` enforce frozen protocol constants (`authProtocol = 2`, `workbenchProtocol = 2`), rejecting mismatches with `INCOMPATIBLE_PROTOCOL`.
  - REST Authentication Stack: Connects to `/api/auth/register` (new accounts disabled pending operator approval), `/api/auth/login` (yields 5-minute login challenge or dev session), `/api/auth/mfa/setup` (transient TOTP secrets, never persisted), `/api/auth/mfa/confirm`, `/api/auth/mfa/verify`, `/api/auth/mfa/challenge` (step-up rotation), `/api/auth/status`, and `/api/auth/logout`.
  - Typed Error Mapping: Maps server codes for `ACCOUNT_DISABLED`, `MFA_REQUIRED`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `INCOMPATIBLE_PROTOCOL`, and `ATTEMPT_STALE`.
  - Sensitive Data Redaction: `AuthSession`, `LoginChallenge`, and `MfaSetupData` sanitize tokens and secrets in `toString()` diagnostics (`[REDACTED]`).
- **ConnectionRegistry Session Lifecycle Integration:**
  - Endpoint changes, credential rotation, and logouts call `retireProfileConnection()` which executes `ConnectionRegistry.retireConnection()`, invalidating active REST, WebSocket, and SSE instances for that generation.
  - Profiles are strictly isolated: invalidating or logging out one profile does not affect other registered profiles.
  - Monotonic generation watermarks (`generationWatermarks`) persist across profile deletion, preventing ABA generation reuse if the profile ID is recreated within the process lifetime.
- **UI & Presentation Invariants:**
  - `AuthDialog`: Tabbed login/register dialog with obscured password input (`PasswordVisualTransformation`) and operator approval notice for newly registered accounts.
  - `MfaChallengeContent`: Interactive TOTP setup and challenge verification with explicit disclosure of transient secret lifecycle.
  - Workbench Integration: Profile management hosted under `WorkbenchScreen` SETTINGS panel and header profile indicator, maintaining strict TERMINAL Traditional mode and zero floating buttons (FABs).

### 7.8 Phase 05 Native Terminal, Editor & Crypto Proof Gates Baseline
- **Terminal Surface Contracts & Candidate Pin (`platform/terminal/`):**
  - `AndroidTerminalSurface`: Decoupled terminal display surface. Remote Rust server owns PTY session lifecycle.
  - `TerminalSessionController`: Outlives Compose recomposition and tab navigation.
  - Input Isolation & Fencing: Input drops and IME isolation are enforced when `isPanelActive == false` or while `isReplayCompleted == false`, preventing keystroke leakage into hidden sessions or out-of-order execution during replay.
  - Terminal candidate pinned to ConnectBot termlib 0.3.13 (`org.connectbot:termlib:0.3.13`, `libvterm.so` JNI core; Apache-2.0 / MIT licenses).
  - VT100/ANSI modifier translation for Ctrl, Alt, Arrow keys, Esc, Tab, Home, End; bounded search and clipboard selection hooks.
- **Editor Surface Contracts & Candidate Pin (`platform/editor/`):**
  - `AndroidEditorSurface`: Code editor surface interface and Compose wrapper.
  - `EditorSession`: Tracks monotonic `modelVersion` on edits, `editEpoch`, `originalServerText`, `serverMtime`, and `isDirty`. Stale saves are rejected if connection generation is retired.
  - Line geometry & gutter decorations: Gutter decoration models for Git blame annotations, diagnostics, and commit reveal.
- Candidate pinned to Sora Editor 0.23.4 (`io.github.Rosemoe.sora-editor:editor:0.23.4` and `io.github.Rosemoe.sora-editor:language-java:0.23.4`, LGPL-2.1-or-later). License obligations identified; DEX packaging clarification and Section 6(a) user relinking/replacement runbook documented in `plans/261023-1429-native-editor-file-explorer/distribution-qualification.md` (packaging configuration includes `pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")`, full license text bundled in `assets/licenses/sora-editor.txt`, and ProGuard keep rules configured for `io.github.rosemoe.sora.**`). Formal binary distribution release remains gated pending demonstrated relinking verification on a packaged release artifact.
- **Language Service & Stale Request Fencing (`features/editor/`):**
  - `JsonLanguageService`: Non-browser offline JSON lexer delivering syntax validation, AST diagnostics, and symbol hierarchy.
  - `LanguageServiceCoordinator`: Fences stale asynchronous diagnostics via monotonic request watermarks (`fileWatermarks`).
  - `TypeScriptLanguageServiceAudit`: Documents the hard architectural blocker for TypeScript language services: remote server hosts no LSP daemon, WebView/browser workers prohibited, non-browser Kotlin/Java cannot run full TypeScript AST evaluation without an embedded JS engine (QuickJS, Hermes, or V8 JNI). Phase 09 TS semantic features remain hard-gated pending architectural decision.
- **OPAQUE Cryptographic Bridge & Fail-Closed Security (`crypto-bridge/` & `platform/crypto/`):**
  - Rust cdylib `native-app/crypto-bridge/`: Exact suite match with `server/src/crypto/opaque.rs` (`DamHopperOpaqueSuite`: `Ristretto255`, `TripleDh<Ristretto255, Sha512>`, `Identity`).
  - HKDF key derivation: SHA-256 with 32 zero bytes salt and info `b"dam-hopper-aes-256-gcm-v1"`, deriving 32-byte AES-256-GCM session keys; host Rust integration tests verify byte-for-byte session key derivation parity with simulated server output (live server end-to-end network interop remains an open qualification gate).
  - Fail-Closed Security: Elimination of simulated crypto fallback upon `UnsatisfiedLinkError`; operations strictly throw `OpaqueCryptoException`. Monotonic atomic handles (`AtomicI64`, capacity 64, zeroization on release, double-close safety).
  - Android NDK 16 KiB ELF alignment requirement (`-C link-arg=-Wl,-z,max-page-size=16384`); complete 16 KiB runtime qualification (APK zip alignment, prebuilt dependency `.so` validation, and execution on 16 KiB page size kernel) tracked under Phase 11/18.
- **Verification & Test Suite Results (per recorded QA report):**
  - Total Automated Checks Passed: 336/336 checks passed (100% pass rate).
    - 118 Unit Test Executions (92 unique test cases):
      - 61 shared JVM unit tests in `:shared:jvmTest` (`pnpm native-app:test`)
      - 26 Android debug unit tests in `:androidApp:testDebugUnitTest` (`pnpm native-app:test:android`)
      - 26 Android release unit test executions in `:androidApp:testReleaseUnitTest` (supplementary release variant execution)
      - 5 Rust crypto bridge integration tests in `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml`
    - 218 Invariant Assertions Passed across 4 shell regression scripts:
      - 66 assertions in `tests/test-phase-05-proof-gates.sh` (5 suites)
      - 57 assertions in `tests/test-phase-04-profiles-auth.sh` (5 suites)
      - 48 assertions in `tests/test-phase-03-transport.sh` (6 suites)
      - 47 assertions in `tests/test-phase-02-foundation.sh` (5 suites)
  - Debug APK Assembly: `./gradlew assembleDebug` (`pnpm native-app:assembleDebug`) succeeded cleanly (65 actionable tasks).
### 7.9 Phase 06 Shell Navigation, Workspaces & Remote Configuration Baseline
- **Required Invariants:**
  - Strict TERMINAL workspace mode (`workspaceMode = "terminal"`) and Traditional shell presentation (`terminalUsageMode = "traditional"`) across all screens.
  - Exactly one horizontal scrolling navigation row docked beneath the header; zero floating action buttons (FABs) or secondary navigation drawers.
  - Single active content area (`singleContentArea = true`); switching panels replaces the visible content area without split-screen docking.
  - Back-stack precedence: Dismisses active modal overlays via fixed precedence order (auth dialog -> destructive switch confirmation -> target picker -> workspace switcher -> profile list) before navigating from non-terminal panels back to TERMINAL; pressing back on TERMINAL with no overlays yields to platform exit.
  - Fail-closed target availability: Selecting an unverified or unavailable target presents an explicit unavailable state; silent redirection to project root is prohibited.
  - Non-destructive remote configuration: Updates preserve entire server JSON documents to prevent stripping unmodeled fields; dirty local drafts are preserved upon background refreshes and flagged with external conflict notices.
  - Explicit destructive workspace warnings: Switching workspaces disposes all remote PTY sessions and reinitializes sandboxes; confirmation requires explicit user acknowledgment.
- **Implemented Mechanisms:**
  - `PanelRegistry` (`ui/navigation/PanelRegistry.kt`): Authoritative metadata mapping for all 12 panels (`WorkbenchPanel.entries`) with labels, monospace short codes (`TERM`, `FS`, `EDIT`, `DIFF`, `MRG`, `GIT`, `FLOW`, `AGNT`, `RES`, `PORT`, `HOST`, `SET`), icon glyphs, and descriptions; throws `IllegalArgumentException` on unmodeled panels.
  - `PanelNavigationRow` (`ui/navigation/PanelNavigationRow.kt`): Single-row `horizontalScroll` with Compose `BringIntoViewRequester` auto-scrolling the selected button into view on panel activation; respects `adjustResize` window insets without layout overflow.
  - `PanelHost` (`ui/navigation/PanelHost.kt`): Single content host container dispatching active panel rendering across 12 branch slots (`terminalContent`, `filesContent`, `editorContent`, `diffContent`, `mergeContent`, `gitContent`, `workflowContent`, `agentsContent`, `resourcesContent`, `portsContent`, `sshHostContent`, `settingsContent`).
  - `WorkbenchNavigation` (`ui/navigation/WorkbenchNavigation.kt`): State machine coordinating active panel, active project, and modal dialogs with strict `handleBackPress()` precedence (auth -> workspace switch warning -> target picker -> workspace switcher -> profile list -> return to TERMINAL -> platform back).
  - `ProjectTargetStore` (`features/workspace/ProjectTargetStore.kt`): Reactive store tracking project targets (`root` vs `worktree`). Monotonic workspace revision (`invalidateWorkspace`) fences in-flight network requests. Fails closed when cached worktrees are unselectable or missing (`isSelectable = isAvailable && !isPrunable`).
  - `WorkspaceRepository` (`features/workspace/WorkspaceRepository.kt`): Wire client for `/api/workspace/status`, `/api/workspace`, `/api/projects`, `/api/git/{project}/worktrees`, `/api/workspace/known`, `/api/workspace/discover`, `/api/workspace/init`, and `/api/workspace/switch`.
  - `WorkspaceScreens` (`features/workspace/WorkspaceScreens.kt`): Modal dialogs including `ProjectTargetPickerModal` (project chips and worktree selection with cross-project target fencing), `WorkspaceSwitcherModal` (known/discovered workspace browser), and `WorkspaceSwitchWarningDialog` (explicit warning that switching disposes all server PTY sessions).
  - `RemoteConfigRepository` (`features/settings/RemoteConfigRepository.kt`) & `RemoteConfigEditor` (`features/settings/RemoteConfigEditor.kt`): Manages `/api/config`, `/api/config/projects/{name}`, and `/api/global-config/ui`. Retains raw JSON document fidelity (`baseConfigJson`, `draftConfigJson`), detects external server drift (`handleServerRefresh` setting `hasConflict = true` without clobbering dirty drafts), and supports granular `UiPreferences` updates.
- **Verified Acceptance Evidence & Open Qualification:**
  - 64 Invariant Assertions passing in `tests/test-phase-06-shell-workspace.sh` covering TERMINAL/Traditional shell invariants, 12-panel registry, navigation row auto-reveal, back precedence, wire DTO schemas, target store revision fencing, remote config conflict detection, and modal dialogs.
  - 25 JVM and Android unit tests passing (`WorkbenchShellPhase06Test`, `ProjectTargetStoreTest`, `RemoteConfigEditorTest`, `WorkbenchNavigationTest`).
  - Clean APK build: `./gradlew assembleDebug` (`pnpm native-app:assembleDebug`) succeeded with 65 tasks up to date.
  - Code review rating: Cycle 2 review scored 9.4/10 with all 3 critical issues (cross-project target contamination, unselectable worktree clickability, and workspace switch initiation fencing) verified resolved.
  - *Open Qualification Gates:* High-DPI button reveal scaling across physical Android displays and end-to-end device scrolling qualification pending in Phase 18.

### 7.10 Phase 07 Terminal Sessions, Stream Replay, Input & Agent Status Baseline
- **Required Invariants:**
  - Strict Traditional terminal presentation (`terminalUsageMode = "traditional"`): sessions operate in Traditional terminal presentation; IDE shell dock layout and Runtime terminal presentations are excluded.
  - Inline UI controls & zero FABs: terminal accessory buttons (Ctrl, Alt, Esc, Tab, arrows) and session switcher tabs are docked strictly inline within `TerminalPanelScreen`; agent jump-to-session actions are inline within `AgentsPanelScreen`. Zero floating action buttons across the entire UI.
  - Stream replay gate & byte reconciliation (`TerminalReplayGate`): live output is queued while historical replay buffer is in flight. Chunk reconciliation via `reconcileTerminalOutput` performs duplicate chunk discard (`endOffset <= currentOffset`), gap detection (`startOffset > currentOffset`), and partial overlap slicing (`startOffset < currentOffset < endOffset`).
  - Outbound query suppression & echo loop prevention: `activeReplayWrites` tracks in-flight replay writes across attach resets; `shouldForwardTerminalData()` returns false while replay writes are pending, preventing terminal device queries from leaking into live sessions.
  - Server-authoritative agent status observation (`AgentStatusReducer`): state reducer applies `serverEpoch` and monotonic `revision` ordering. Epoch mismatches trigger snapshot reload hoisted outside non-reentrant mutex. Deltas update unread attentions with bounded attention tracking (1,000-entry LRU cap) to suppress duplicate alerts.
  - Input isolation & keyboard bridging: keystrokes are dropped when `isPanelActive == false` or `isReplayCompleted == false`. Hardware modifiers (Ctrl, Alt, Shift) unlatch on `ACTION_UP`. Supplementary Unicode (> 0xFFFF) handled via surrogate pairs. Alt-special key prefixes escape (`0x1B`). Bracketed paste wrapping (`\u001b[200~... \u001b[201~`) applied to clipboard text.
  - Cross-profile session isolation: `WorkbenchScreen` closes and clears all registered `TerminalSessionController` instances upon active profile transitions to prevent cross-profile session and socket leakage.
- **Implemented Mechanisms:**
  - `TerminalModels` (`features/terminal/TerminalModels.kt`): Session metadata (`TerminalSessionMeta`, `TerminalSessionDetailed`), CRUD wire requests (`CreateSessionRequest`, `RenameSessionRequest`), agent status rows (`TerminalAgentStatusRow`), unread attention events (`AgentAttentionEvent`), and snapshot DTO (`AgentStatusSnapshotV1`).
  - `TerminalRepository` (`features/terminal/TerminalRepository.kt`): REST client wrapping `/api/terminal/sessions`, `/api/terminal/sessions/{id}`, `/api/terminal/sessions/{id}/rename`, `/api/terminal/sessions/{id}/kill`, `/api/terminal/sessions/{id}/remove`, `/api/terminal/sessions/{id}/buffer`, and `/api/agent-status/snapshot`.
  - `TerminalReplayGate` (`features/terminal/TerminalReplayGate.kt`): Gate coordinator tracking `hasAttachBufferBeenReceived`, `isReplayWriting`, `isLiveStreamReady`, bounded queuing (`maxQueuedChunks = 1024`, `maxQueuedBytes = 4 MiB`), overflow notifications, and exact offset reconciliation (`reconcileTerminalOutput`).
  - `AgentStatusReducer` (`features/terminal/AgentStatusReducer.kt`): Authoritative state reducer handling `applySnapshot`, `applyStatusChanged`, `applyStatusRemoved`, and `applyStatusInvalidated` with epoch/revision fencing and non-reentrant mutex deadlocks eliminated by hoisting snapshot reload.
  - `TerminalSessionController` (`features/terminal/TerminalSessionController.kt`): Retained session state controller decoupled from Compose lifecycle, managing PTY incarnation, offset tracking, replay gate lifecycle, raw input sink, ANSI arrow/navigation encoding, and bracketed paste wrapping.
  - `TerminalInputController` (`platform/terminal/TerminalInputController.kt`): Android platform bridge for hardware key events (`KeyEvent`), IME text commits (`onImeCommitText`), IME backspace (`onImeDeleteBackward`), and clipboard paste.
  - `AndroidTerminalSurface` (`platform/terminal/AndroidTerminalSurface.kt`): Native terminal surface contract implementation with in-memory buffer, bracketed paste wrapping, text selection, and search.
  - `TerminalScreens` (`features/terminal/TerminalScreens.kt`): Compose UI for `TerminalPanelScreen` (session tabs, inline accessory bar) and `AgentsPanelScreen` (agent filter chips, status roster, jump-to-session action).
  - `WorkbenchScreen` (`ui/screens/WorkbenchScreen.kt`): Host integration wiring `terminalContent` and `agentsContent` into `PanelHost`, centralized `getOrCreateController`, worktree target forwarding, and profile transition cleanup.
- **Verified Acceptance Evidence & Open Qualification:**
  - 45 Static Invariant Assertions passing in `tests/test-phase-07-terminal-agents.sh` verifying session CRUD contracts, stream reconciliation logic, agent status reducer fencing, input gating, zero FABs, and `adjustResize` window insets.
  - 327 Cumulative Invariant Assertions passing across all Phases 02–07 static test scripts (100% pass rate).
  - Recorded QA Report (`plans/reports/qa-261016-0200-reverify-phase-07-terminal-agents.md`) notes 155 passing unit tests: 103 shared JVM tests in `:shared:jvmTest` (`AgentStatusReducerTest`, `TerminalReplayGateTest`, `TerminalRepositoryTest`, `TerminalSessionControllerTest`) and 52 Android unit tests in `:androidApp:testDebugUnitTest` (`TerminalInputControllerTest`, `AndroidTerminalSurfaceTest`), plus 5 Rust crypto-bridge unit tests.
  - Clean debug APK build: `:androidApp:assembleDebug` succeeded (65 actionable tasks).
  - Code Review Score: 8.8 / 10 (Cycle 2 Review `plans/reports/code-review-261016-0205-phase-07-terminal-agents-cycle-2.md`) with Cycle 1 critical deadlock, cross-profile controller leak, attachment race, and worktree routing verified remediated on host.
  - *Open Qualification Gates:* Live emulator canvas integration in `TerminalScreens`, physical ConnectBot `libvterm.so` JNI binding, physical device IME candidate composition, window insets during soft keyboard transitions, and real server-backed WebSocket PTY streaming qualification deferred to Phase 18.

### 7.11 Phase 08 Filesystem Watchers, Search and Replace Baseline
- **Required Invariants:**
  - Target-qualified filesystem operations: File, directory, stat, read, and mutation operations forward the specified `ProjectTargetRef` without ambient profile fallbacks; operations do not independently validate `target.profileId` against captured connection generations in commonMain.
  - Chunked write serialization & CAS: `FsWriteCoordinator` serializes chunked frames under coroutine `Mutex` with monotonic `reqId` allocated by `WsConnection`. Expected mtime compare-and-swap (CAS) is passed in `fs:write_begin` (`expected_mtime`).
  - Live tree subscription & buffering: `TreeSubscriptionManager` buffers incoming `fs:event` and `fs:overflow` messages via an in-memory channel before the subscribe request completes, filtering events by `subId` and protecting unsubscriptions with generation fencing (current unbounded channel carries memory risks under high server event volumes).
  - Watcher scope boundary: Live directory watching is currently bounded to the root directory without automatic per-subfolder subscriptions. Rebind on reconnect triggers only when `activeSubscription == null`.
  - Inline UI presentation & zero FABs: `FilesPanelScreen` docks Explorer and Search & Replace subtabs within the single content area; inline `FilesTopBar`; modal dialogs in `FileModalsHost` preserve input on error with zero floating action buttons.
  - Bounded federated search: Search queries across connected profile bindings enforce an aggregate 500-match cap, isolate partial profile failures, and map workspace matches to their originating project targets.
  - Conservative replacement execution: Search-and-replace executes literal non-regex replacements using frozen search specifications; preview aggregates match counts per file; batch execution verifies match presence and applies read-to-write CAS; an authoritative dirty-buffer provider interface remains an open data-safety gate pending Phase 09.
- **Implemented Mechanisms:**
  - `FileModels` (`features/files/FileModels.kt`): `DirEntryDto`, `ListResponseDto`, `FileStatDto`, `FsFileReadResult`, `FileTreeNode`.
  - `FileRepository` (`features/files/FileRepository.kt`): REST `/api/fs/list` and `/api/fs/stat`, WebSocket `FsRead`, `FsWrite` via `FsWriteCoordinator`, `FsOp` via `executeFsOp`.
  - `FsWriteCoordinator` (`features/files/FsWriteCoordinator.kt`): Mutex-guarded chunked writes with monotonic `reqId` and expected mtime CAS.
  - `TreeSubscriptionManager` (`features/files/FileTreeSubscription.kt`): Early-buffered channel before subscribe response, subId filtering, generation fencing.
  - `FileTreeState` (`features/files/FileTreeState.kt`): Lazy folder expansion, virtualized rows (`FileTreeItemView`), hidden-file toggle, selection highlight, `fs:event` path mapping, `fs:overflow` recovery.
  - `FileMutationCoordinator` (`features/files/FileMutationCoordinator.kt`): Create file/dir, rename, delete.
  - `SearchRepository` (`features/files/SearchRepository.kt`): REST content/path search.
  - `FederatedSearchCoordinator` (`features/files/FederatedSearchCoordinator.kt`): Parallel search across profiles, 500-match cap, error isolation, workspace target mapping.
  - `ReplaceCoordinator` (`features/files/ReplaceCoordinator.kt`): Literal replacement, match count previews, sequential batch apply with read-to-write CAS.
  - `FilesPanelScreen` (`features/files/FileScreens.kt`), `FilesTopBar`, `SearchReplaceView`, `ReplacePreviewCard`, `FileActionDialogs`, `FileModalsHost`.
  - `WorkbenchScreen` (`ui/screens/WorkbenchScreen.kt`): Wiring `filesContent` in `PanelHost`, federated bindings effect, profile target forwarding.
- **Verified Acceptance Evidence & Open Qualification:**
  - 57 Static Source Assertions passing in `tests/test-phase-08-filesystem-watchers.sh` verifying models, REST/WS contracts, watcher lifecycle, search federation, replace coordinator, and zero FABs.
  - 384 Cumulative Static Assertions passing across all Phases 02–08 static test scripts (100% pass rate).
  - Automated verification evidence (dated QA report `plans/reports/qa-261016-0613-reverify-phase-08-filesystem-watchers.md`): 194 automated test executions passed across `:shared:jvmTest` (116) and `:androidApp` debug/release unit tests (39 debug + 39 release executions covering the same 39 test methods); clean `:androidApp:assembleDebug` (65 actionable tasks).
  - Cycle 2 review score 6/10 (`plans/reports/code-reviewer-261016-0617-phase-08-cycle-2-filesystem-watchers.md`): Cycle 1 critical race and modal crash closed; baseline accepted via user approval with recorded open limitations: lossy UTF-8 replace fallback, timeout-as-cancellation batch abort, root-only directory watcher without subfolder re-subscription, secondary-profile display-name target resolution, dirty-buffer provider unwired pending Phase 09 editor, and outcome UI detail. Physical device execution, real server-backed WebSocket integration, and open safety gates deferred to Phase 18.

### 7.12 Phase 09 Native Editor, Language Services & Safe Saves Baseline
- **Required Invariants:**
  - Exact file tier size boundaries (`FileTierPolicy`):
    - Normal tier: `< 1 MiB` (`NORMAL_MAX_BYTES = 1,048,576` bytes). Full in-memory text buffer editable with syntax intelligence and undo/redo.
    - Degraded tier: `>= 1 MiB` and `< 5 MiB` (`DEGRADED_MAX_BYTES = 5,242,880` bytes). Full in-memory text buffer editable; language service processing gated or optimized.
    - Large tier: `>= 5 MiB`. Read-only partial viewing via bounded 64 KiB (`LARGE_CHUNK_BYTES = 65,536` bytes) range paging (`loadLargeFileRange`, `LargeFileView`); full buffer loading prohibited.
    - Binary tier: Read-only raw binary hex inspection (`BinaryHexView`, Base64 payload decoding).
    - Image & Video tiers: Preview-only via `MediaPreviewCard`; excluded from text decoding or editor mutation paths (`isPreviewOnlyFile == true`).
    - Diff tier: Git diff view routed to diff viewer (retained for Phase 10).
    - Safe UTF-8 decoding: `decodeUtf8Safe` safely drops incomplete trailing multi-byte UTF-8 sequences (1–3 bytes) at 64 KiB chunk boundaries to prevent Unicode replacement character corruption (`\uFFFD`).
  - Safe-save protocol:
    - Submitted-bytes snapshot tracking: `EditorSession.beginSave()` captures an immutable text snapshot and records `submittedContent` and `submittedEpoch`. Upon save completion, `completeSave(savedMtime, submittedSnapshot)` updates `savedContent` and `serverMtime`, then authoritatively recalculates `isDirty = (getText() != savedContent)` so that intermediate user edits typed while the save was in flight are never lost. `abortSave()` clears submitted state.
    - Compare-and-swap (CAS) mtime protection: `EditorRepository.saveFile` supplies `expectedMtime` to `fileRepository.writeFile`. If remote mtime differs, the server rejects the write and yields `EditorSaveResult.Conflict`, prompting `SaveConflictDialog` (reload vs force-overwrite). Guarded force overwrite re-stats the file to obtain fresh mtime before saving.
    - Atomic tab transforms: `EditorTabSaveCoordinator` applies functional state transforms to the latest current tab state (`transformTab { current -> current.copy(...) }`) rather than stale captured snapshots, preventing race conditions with concurrent edits.
    - UnknownOutcome timeout handling: Timeouts occurring after commit transmission (`TimeoutCancellationException`) return `EditorSaveResult.UnknownOutcome` instead of retrying or failing silently, informing the user that server state must be verified before retrying.
    - Clean auto-reload vs dirty stale flags: On filesystem watcher modification events (`handleRemoteFileModified`), clean tabs (`!tab.isDirty`) automatically reload fresh server content; dirty tabs retain local modifications and are marked `isStale = true` with an inline conflict notice, preventing remote reads from clobbering unsaved edits.
    - Explicit discard: `discardAndReloadTab(key)` forces reloading from server and clears dirty/stale flags.
    - Authoritative dirty-buffer wiring: `EditorTabsState.isDirtyFile` is wired to `WorkbenchScreen` and injected into `ReplaceCoordinator`, preventing search-and-replace batch operations from clobbering unsaved buffers (`ReplaceFileOutcome.SkippedDirty`).
  - Solitary navigation & zero FABs: Single horizontal scrolling button row below header; all editor controls (tab row, action buttons, conflict dialogs) are docked inline within `EditorScreens` and `EditorTopBar`; zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`).
- **Implemented Mechanisms:**
  - `FileTierPolicy` (`features/editor/FileTierPolicy.kt`): Size constants (`1 MiB`, `5 MiB`, `64 KiB`), file extension classifiers, `determineTier`, `isPreviewOnlyFile`, `decodeUtf8Safe`.
  - `EditorModels` (`features/editor/EditorModels.kt`): `EditorTab`, `PersistedTabMetadata` (strictly excludes dirty text content), `TextPosition`, `TextRange`, `TextEdit`, `FindReplaceState`, `buildEditorTabKey`.
  - `EditorSession` (`features/editor/EditorSession.kt`): Retained document session managing text buffer, `serverMtime`, `savedContent`, `submittedContent`, monotonic `modelVersion`, `editEpoch`, `isDirty`, cursor/selection, and bounded undo/redo (`EditorUndoManager`).
  - `EditorRepository` (`features/editor/EditorRepository.kt`): Target-bound file loader, safe CAS save, guarded force-overwrite, and timeout handling yielding `EditorSaveResult.UnknownOutcome`. Encrypted save fail-closed check.
  - `EditorTabSaveCoordinator` (`features/editor/EditorTabSaveCoordinator.kt`): Orchestrates save and force-overwrite using atomic tab transforms.
  - `EditorTabsState` (`features/editor/EditorTabsState.kt`): Multi-tab management, active tab selection, clean-only auto-reload, dirty stale flag, `discardAndReloadTab`, 64 KiB `loadLargeFileRange`, and `isDirtyFile`.
  - `LanguageService` (`features/editor/LanguageService.kt`) & `TsJsLanguageService` (`features/editor/TsJsLanguageService.kt`): `JsonLanguageService` (AST diagnostics & symbols), `TsJsLanguageService` (delimiter matching and keyword scanning with quote-before-comment precedence), `TypeScriptLanguageServiceAudit` (formal audit record), `LanguageServiceCoordinator` (monotonic request/response watermarks).
  - `AndroidLanguageService` (`platform/editor/AndroidLanguageService.kt`): Android platform dispatcher mapping file extensions to language services.
  - UI Components (`features/editor/`): `EditorPanelScreen`, `EditorTopBar`, `LargeFileView`, `BinaryHexView`, `MarkdownPreviewView` (with Mermaid deferred banner), `MediaPreviewCard`, `SaveConflictDialog`, and `WorkbenchScreen` integration.
- **Documented Open Limitations:**
  1. Native Editor Canvas: Current live editor surface uses Compose `TextField` with candidate adapter metadata indicator; physical Sora Editor (`io.github.rosemoe.sora-editor`) native canvas binding and AAR relinking qualification are deferred to Phase 18 device qualification.
  2. TypeScript/JavaScript Semantic Intelligence: Formally BLOCKED per `TypeScriptLanguageServiceAudit` (`BLOCKED_PENDING_RUNTIME_DECISION`); remote server lacks LSP daemon and web-workers are excluded; native runtime requires embedded QuickJS/Hermes engine or server-side LSP routing. Delimiter/keyword syntax scanner active as interim heuristic.
  3. Encrypted File Save: Encrypted mode toggle fails closed with explicit error (`Encrypted save requires Phase 11 owner-bound crypto session`) until Phase 11 crypto session implementation; plaintext fallback is strictly prohibited.
- **Verified Acceptance Evidence & Open Qualification:**
  - 70 Static Invariant Assertions passing in `tests/test-phase-09-editor-saves.sh` covering tier boundaries, session models, safe saves, multi-tab state, language services, UI components, and zero FABs.
  - 454 Cumulative Invariant Assertions passing across all 8 static test scripts (Phases 02–09, 100% pass rate).
  - 219 Unit Test Executions passing (141 in `:shared:jvmTest`, 39 in `:androidApp:testDebugUnitTest`, 39 in `:androidApp:testReleaseUnitTest` across 180 unique test methods per QA report `plans/reports/qa-261016-0718-phase-09-editor-saves-cycle-3.md`), plus clean `:androidApp:assembleDebug` build (55 actionable tasks).
  - Code Review Score: 6/10 (Cycle 2 Review `plans/reports/code-reviewer-261016-0709-phase-09-editor-saves-cycle2.md`), accepted via user approval with documented open limitations. Physical device qualification, Sora native canvas, and live server WebSocket saves deferred to Phase 18.

### 7.13 Phase 10 Native Diff, Merge Conflict Resolution and Git Blame Baseline
- **Required Invariants:**
  - Native diff review & layout mode parity: Support both side-by-side (`DiffLayoutMode.SIDE_BY_SIDE`) and inline (`DiffLayoutMode.INLINE`) diff views. Bounded computation budget (`MAX_DIFF_LINES = 10_000`) prevents UI unresponsiveness on oversized inputs.
  - Server-correlated hunk mapping: Map local diff lines to server `HunkInfo` (`newStart`, `newLines`, `oldStart`, `oldLines`), assigning authoritative `hunkIndex` to corresponding diff rows.
  - Fail-closed hunk discard & safety guards: `DiffReviewController.discardHunk` resolves the mapped server hunk and dispatches `DiscardHunkRequest` to `POST /api/git/{project}/discard-hunk`. Discard is strictly rejected if:
    1. The diff is read-only (`isReadOnly = true`, applicable to commit diffs, deleted-only files, or binary files).
    2. Local unsaved diff modifications are present (`isModifiedDirty = true`).
    3. Active editor session contains unsaved in-memory buffer edits (`isDirtyBufferProvider(target, path) == true`).
  - Compare-and-swap (CAS) baseline mtime saves: Modifying working-tree diff drafts updates `modifiedDraft` and sets `isModifiedDirty = true`. Saving invokes `saveModified(fileRepo)` with expected mtime protection (`baselineMtime` captured via `/api/fs/stat` on current `loadDiffSeq`). Conflicts return explicit error without silent overwrite.
  - Commit diff navigation: Historical commits load in read-only mode (`commitHash != null`). `exitCommitDiff()` returns directly to working-tree diff view.
  - Robust 2-way and 3-way/diff3 conflict marker parsing: `ConflictParser` parses standard 2-way (`<<<<<<<`, `=======`, `>>>>>>>`) and 3-way/diff3 (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`) markers, preserving labels (`ourLabel`, `ancestorLabel`, `theirLabel`) and newline conventions (CRLF / LF).
  - Conflict resolution integrity:
    - Target-specific block resolution via `ConflictSide` (`OURS`, `THEIRS`, `ANCESTOR`, `BOTH_OURS_FIRST`, `BOTH_THEIRS_FIRST`) and batch resolution (`acceptAll`).
    - `hasMalformedConflicts` rejects malformed blocks (unmatched delimiters, missing separators, excess ancestors).
    - `hasRemainingConflicts` confirms no opening markers (`<<<<<<<`) remain before allowing resolution.
    - `markResolved()` strictly validates `allResolved && !isMalformed` before submitting `ResolveConflictRequest` to `POST /api/git/{project}/resolve`.
  - Buffer safety & line count metrics for blame: Enforce 5 MiB UTF-8 threshold (`GIT_BLAME_MAX_BUFFER_BYTES = 5 * 1024 * 1024`). `computeBufferLineCount` preserves CRLF and LF layout metrics for exact editor display alignment.
  - Keystroke debounce & coroutine job cancellation: `BlameRepository.requestBlameDebounced` applies 250 ms debounce (`GIT_BLAME_DEBOUNCE_MS`), cancelling prior in-flight coroutine jobs for the target file key (`"${target.project}:${target.worktreePath ?: ""}:$path"`). Visible gutter annotations are immediately wiped on buffer changes (`lineAttributions = null`).
  - Strict partition validation: `BlameValidator.validateBlameResponse` enforces integral bounds, echo matching (`snapshotId`, `modelVersion`), display line count matching, contiguous non-overlapping partition covering `[1..bufferLineCount]`, and valid commit index references with `null` indices designated as Uncommitted.
  - Bounded multi-dimensional LRU cache: `BlameCache` retains up to 64 completed blame responses within a 32 MiB memory budget. Cache keys (`BlameCacheKey`) incorporate profile ID, generation, project, worktree path, root ID, HEAD OID, repository epoch, relative path, and SHA-256 buffer fingerprint (`computeSha256`). Target epoch advancement (`advanceTargetEpoch`) and owner retirement (`retireOwner`) provide lifecycle invalidation capability interfaces.
  - Gutter presentation & commit inspection: `EditorBlameGutter` displays 6-character commit hashes and 8-character author names. Clicking an attributed commit triggers `onInspectCommit`, which routes to `diffController.loadDiff(project, target, path, commitHash)` and navigates to the `DIFF` panel without clobbering dirty editor buffers. Standalone `CommitRevealRequest` and `CommitRevealCoordinator` provide nonce-bound coordination models for cross-surface commit reveal; active `WorkbenchScreen` integration routes directly using navigation target snapshot.
  - Zero FABs & inline workbench integration: `DiffReviewScreen`, `MergeConflictScreen`, and `EditorPanelScreen` are docked inline within `WorkbenchScreen` and `PanelHost`. Zero floating action buttons across all review surfaces; navigation is driven exclusively via the single horizontally scrolling top navigation row (`PanelNavigationRow`). Platform metadata records are maintained in `NativeReviewSurfaces`.
- **Implemented Mechanisms:**
  - `DiffModels` (`features/git/DiffModels.kt`): `FileDiffContent`, `GitLineChange`, `HunkInfo`, `DiffLayoutMode`, `DiffLineType`, `DiffRow`, `DiscardHunkRequest`, `FileDiffQuery`.
  - `DiffCalculator` (`features/git/DiffCalculator.kt`) & `LcsDiffEngine` (`features/git/LcsDiffEngine.kt`): 10,000-line capped diff calculation, side-by-side and inline row builders, server hunk index mapping.
  - `DiffReviewController` (`features/git/DiffReviewController.kt`): Load diff, hunk discard mapping, dirty buffer/modified guards, CAS baseline mtime saves, commit diff inspection and `exitCommitDiff()`.
  - `MergeConflictModels` (`features/git/MergeConflictModels.kt`): `ConflictFile`, `ResolveConflictRequest`, `ConflictRegion`, `ConflictSide`.
  - `ConflictParser` (`features/git/ConflictParser.kt`): 2-way and 3-way/diff3 conflict marker parsing, `hasMalformedConflicts`, `hasRemainingConflicts`, `acceptConflict`, `acceptAll`.
  - `MergeConflictController` (`features/git/MergeConflictController.kt`): Load conflicts, select file, accept conflict blocks, dirty state tracking, and validated `markResolved()`.
  - `BlameModels` (`features/editor/BlameModels.kt`): `GitBlameInput`, `GitBlameCommit`, `GitBlameRange`, `GitBlameStatus`, `GitBlameResponse`, `BlameLineAttribution`, size and debounce constants.
  - `BlameValidator` (`features/editor/BlameValidator.kt`): `computeBufferLineCount`, `isBufferOverLimit`, `computeBufferFingerprint`, and `validateBlameResponse`.
  - `BlameCache` (`features/editor/BlameCache.kt`): Bounded 64-entry / 32 MiB LRU cache, `BlameCacheKey`, `advanceTargetEpoch`, `retireOwner`.
  - `Sha256Digest` (`core/crypto/Sha256Digest.kt`, JVM, Android): KMP expect/actual SHA-256 byte and string hashing.
  - `BlameRepository` (`features/editor/BlameRepository.kt`): Debounced blame requests, coroutine cancellation per file key, cache lookup, partition validation, and line attribution derivation.
  - `CommitRevealRequest` (`features/editor/CommitRevealRequest.kt`): `CommitRevealRequest`, `CommitRevealCoordinator` with owner and target validation.
  - UI Components: `DiffReviewScreen`, `DiffRowItem`, `MergeConflictScreen`, `EditorBlameGutter`, `EditorTopBar` blame toggle, `EditorScreens`, `NativeReviewSurfaces`, and `WorkbenchScreen` integration.
- **Documented Open Limitations (per recorded Cycle 5 Review):**
  1. Merge completion navigation race: `onResolved` in `WorkbenchScreen` checks `conflictFiles` snapshot after triggering asynchronous `loadConflicts`. If reload completes before check, navigation logic may evaluate modified list; resolution state is safe via `allResolved = false` reset.
  2. `loadConflicts` loading state: `finally` block clears `isLoading` while nested `selectFile` fetch is in flight, creating potential spinner flicker.
  3. Non-default root save & draft preservation: `saveModified` writes using `target` only without `query.root` specialization; `loadDiff` executed after save resets concurrent in-flight edits typed during save.
  4. Controller unit test coverage: `DiffReviewController` and `MergeConflictController` currently lack dedicated unit tests (Phase 10 verification script covers 77 structural/model assertions; unit tests cover `BlameValidator`, `BlameCache`, `Sha256Digest`, `LcsDiffEngine`, `DiffCalculator`, `ConflictParser`).
  5. Asynchronous row recomputation: `recomputeRows` dispatches to `Dispatchers.Default` without monotonic sequence ordering, risking out-of-order completion on rapid layout mode toggles.
  6. Swallowed stat error: Failure during `/api/fs/stat` leaves `baselineMtime` null, causing saves to report missing baseline mtime without pre-surfacing the underlying filesystem stat failure.
  7. Physical device qualification: Live emulator canvas integration, physical touch/scroll gestures, Sora native canvas relinking, and real server-backed WebSocket integration remain open qualification gates deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 77 Static Invariant Assertions verified in `tests/test-phase-10-diff-merge-blame.sh` covering wire models, diff calculation, hunk operations, conflict parsing, blame validation, cache bounds, reveal models, and zero FABs.
  - 531 Cumulative Invariant Assertions recorded across all 9 static test scripts (Phases 02–10, 100% pass rate).
  - 246 Automated Unit Tests passing across `:shared:jvmTest` and `:androidApp` test suites (per QA reports `qa-261016-0804-phase-10-diff-merge-blame.md` and `qa-261016-0917-phase-10-cycle-2-verification.md`).
  - Clean Kotlin compilation: `:shared:compileKotlinJvm` verified without errors (per Cycle 5 review).
  - Code Review Score: 9/10 (Cycle 5 Review `plans/reports/code-reviewer-261016-1030-phase-10-cycle-5.md`), accepted via user approval with documented open limitations.

### 7.14 Phase 11 Encrypted Transfers, Media Streaming and Android Storage Baseline
- **Required Invariants & Scaffolding Scope:**
  - OPAQUE envelope format & wire parity: `CryptoEnvelope` implements exact parity with server `decrypt_blob` (`iv(12) || ciphertext + tag(16)`), with `IV_LENGTH = 12`, `TAG_LENGTH = 16`, `METADATA_MAX_LENGTH = 4096`, packing metadata JSON (`FileBlobMetadata`/`TextBlobMetadata`), 0x00 delimiter, and content bytes.
  - Crypto session lifecycle & zeroization: `CryptoSession` holds the derived 32-byte AES-256-GCM key, implements `AutoCloseable`, and zeros key memory on `close()` (`keyBytes.fill(0)`), with documented JVM GC zeroization limitations. Generation validation via `assertValid(expectedOwner)`.
  - Fail-closed encrypted save: `EditorRepository.saveFile` and `forceOverwrite` enforce `if (encryptedRequested)` check without fallback to plaintext if crypto session is unavailable or fails. `EncryptedSaveCoordinator` coordinates conflict-aware `saveEncrypted` (using expected mtime CAS) and explicit single-blob `forceOverwriteEncrypted` (`fs:put_save` atomic pair).
  - Chunked binary transfer state machine: `TransferCoordinator` implements acknowledged binary header/chunk frames (`DEFAULT_CHUNK_SIZE = 64 KiB`, `MAX_FILE_SIZE = 100 MiB` enforced envelope/document limit where applicable) via `wsConnection.sendAtomicPair`. Ack listeners are registered before frame dispatch; `UnknownOutcome` is returned on in-flight commit timeout.
  - Android SAF document storage: `AndroidDocumentStorage` implements the `DocumentStorage` interface, operating on scoped content URIs without broad storage permissions; enforces `MAX_DOCUMENT_BYTES = 100 MiB`, filename sanitization (`sanitizeFilename`), and bounded streaming (`streamFromUri`, `streamToUri`).
  - Media client security boundaries & cookie isolation: `AndroidMediaClient` enforces UUIDv4 `mediaClientId`, namespaced session cookie (`damhopper-media-session-<uuidv4>`), strict same-origin checks (`assertSameOrigin`), redirect rejection (`followRedirects(false)`, `followSslRedirects(false)`), and purpose-scoped capabilities (`PLAYBACK` vs `DOWNLOAD`).
  - Native media presentation & zero FABs: `AndroidVideoSurface` utilizes `SurfaceView` and `MediaPlayer` backed by `LeaseMediaDataSource`; `MediaPreviewCard` renders file metadata and optional SAF download button; zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`).
- **Implemented Mechanisms:**
  - `CryptoEnvelope` & `CryptoSession` (`core/security/CryptoEnvelope.kt`, `CryptoSession.kt`).
  - `PlatformCrypto` expect/actual (`core/security/PlatformCrypto.kt`, `PlatformCrypto.jvm.kt`, `PlatformCrypto.android.kt`).
  - `OpaqueClientBridge` & Rust bridge (`platform/crypto/OpaqueClientBridge.kt`, `crypto-bridge/src/lib.rs`).
  - `TransferCoordinator` (`features/files/TransferCoordinator.kt`) and `FileRepository` integration (`features/files/FileRepository.kt`).
  - `EncryptedSaveCoordinator` (`features/editor/EncryptedSaveCoordinator.kt`) and `EditorRepository` wiring (`features/editor/EditorRepository.kt`).
  - `AndroidDocumentStorage` (`platform/storage/AndroidDocumentStorage.kt`).
  - `MediaModels` & `AndroidMediaClient` (`features/media/MediaModels.kt`, `platform/media/AndroidMediaClient.kt`).
  - `AndroidVideoSurface` & `MediaPreviewCard` (`platform/media/AndroidVideoSurface.kt`, `features/editor/MediaPreviewCard.kt`, `EditorScreens.kt`).
  - `WorkbenchScreen` host integration (`ui/screens/WorkbenchScreen.kt`).
- **Documented Open Limitations & Implementation Gaps (per Cycle 2 Review):**
  1. Encrypted save unreachable in production: OPAQUE login finish does not wire session into `CryptoSessionManager.setSession` (zero production callers); editor UI lacks encryption toggle; provider in `WorkbenchScreen` uses blocking call on commonMain thread.
  2. Media and SAF stack lack production consumers: `AndroidMediaClient`, `AndroidVideoSurface`, `LeaseMediaDataSource`, and `AndroidDocumentStorage` are declared but unwired from production UI/workflows (no SAF picker/ActivityResult, no ticket issue/revoke lifecycle, no image renderer; `MediaPreviewCard` renders descriptive placeholder text without media display).
  3. Cookie capture not fail-closed: `cookie.contains(name)` matching is permissive and allows null `cookieHeader` in `MediaLease` rather than throwing fail-closed `MediaException` at issue time; UUID validation checks version 4 but does not sanitize non-canonical representation.
  4. Unbounded `readRangeSync`: `response.body.bytes()` buffers the full response body into memory when the server returns 200 or 206 larger than requested, risking OOM on large media files.
  5. Partial generation fencing: Initial owner assertion occurs before transfer/encryption, but revalidation across subsequent asynchronous boundaries and full-operation fencing is not completed in all consumer paths.
  6. Envelope implementation duplication: Rust JNI exports (`nativeEncryptEnvelope`, `nativeDecryptEnvelope`) and Kotlin `CryptoEnvelope` maintain parallel implementations without single source of truth.
- **Verified Acceptance Evidence & Open Qualification:**
  - 84 Static Invariant Assertions passing in `tests/test-phase-11-encrypted-transfers-media.sh` verifying cryptographic models, transfer coordinator state machines, encrypted save wiring, SAF storage interface, media client security configuration, and zero FABs.
  - 615 Cumulative Static Assertions passing across all 10 static test scripts (Phases 02–11, 100% pass rate).
  - 7 Rust unit/parity tests passing in `native-app/crypto-bridge` (`cargo test --offline`).
  - Automated JVM/Android unit tests compiled and passing in `:shared:jvmTest` and `:androidApp:testDebugUnitTest`.
  - *Open Qualification Gates Deferred to Phase 18:* Physical ARM64 device qualification, 16 KiB kernel page size execution, real server-backed WebSocket chunked transfer interop, live server OPAQUE encrypted save roundtrip and tamper detection, media seek/playback with real device hardware decoders, and same-host two-profile media cookie isolation.
### 7.15 Phase 12 Complete Git and Safe History Workflows Baseline
- **Required Invariants & Scaffolding Scope:**
  - Multi-repository domain architecture: Target-qualified domain repositories split by concern (`GitQueryRepository`, `GitMutationRepository`, `GitBranchWorktreeRepository`, `GitHistoryMutationRepository`, `GitPublishRepository`) unified under `GitRepository` facade.
  - Operation scope & generation fencing: All operations execute within `GitOperationScope(profileId, generation, project, worktreePath)` to prevent cross-profile contamination and isolate stale generation responses.
  - Changes, staging, commit & discard: Working tree diff queries (`/diff`), per-target file staging (`/stage`, `/unstage`), file discard (`/discard`), and commits (`/commit`) with amend flag support via `GitChangesController`. Undo last commit requires user confirmation dialog and is blocked by active operations on the server.
  - Worktree mutation prechecks: `WorktreeMutationController` prechecks removal (`validateRemovalPrecheck`) ensuring no active terminal sessions (`hasActiveTerminal`) and no dirty editor buffers (`isTargetDirty` wired from `EditorTabsState.isDirtyTarget`).
  - Safe history rewrite eligibility: Distinguishes inactive local branch rewrites (`isViewingLocalBranch` = `refs/heads/*` and `!isRemote`) from active-only checkout-sensitive actions (`isViewingActiveBranch`). Commit message editing (`CommitMessageSnapshot` CAS) and contiguous squash producing `SquashReceipt` are permitted on inactive local branches. Destructive actions (`reset`, `drop`, `undoLastCommit`) and working-tree mutations (`cherryPick`, `revert`) are strictly restricted to the checked-out active branch via `GitHistoryActionController`.
  - Leased push publication gate: Local history rewrites never publish automatically. Publication is an explicit, separate user action via `LeasedPublishController` using exact expected remote OID (`PrepareLeasedPushRequest`, `PublishLeasedPushRequest`); stale remote tips abort with blocked status (`isStaleRemote`); explicit exact-OID leased publication with zero blind `--force` push fallback.
  - Native presentation & zero FABs: `GitPanelScreen` (docked Changes, History, Branches/Worktrees sections) and inline `GitModalsHost` dialogs; zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`).
- **Implemented Mechanisms:**
  - Repositories: `GitRepository`, `GitQueryRepository`, `GitMutationRepository`, `GitBranchWorktreeRepository`, `GitHistoryMutationRepository`, `GitPublishRepository` (`features/git/`).
  - Controllers: `GitChangesController`, `GitBranchController`, `GitHistoryController`, `GitHistoryActionController`, `GitRewriteActionController`, `WorktreeMutationController`, `LeasedPublishController`, `GitSyncController` (`features/git/`).
  - Models: `GitModels.kt`, `GitHistoryModels.kt`, `GitRewriteModels.kt`, `GitPublicationModels.kt`, `GitOperationScope.kt`.
  - Views & Modals: `GitPanelScreen.kt`, `GitChangesView.kt`, `GitHistoryView.kt`, `GitBranchesWorktreesView.kt`, `GitCommitRow.kt`, `GitModalsHost.kt`, `GitModalState.kt`, `GitCommitDetailsDialog.kt`, `GitCommitMessageEditDialog.kt`, `GitSquashDialog.kt`, `LeasedPushDialog.kt`, `WorktreeDialogs.kt`, `GitActionConfirmDialogs.kt`, `GitErrorDialog.kt`.
  - Host integration: `WorkbenchScreen.kt` (wiring all 8 controllers, target scope, and `EditorTabsState.isDirtyTarget`).
- **Documented Open Limitations & Implementation Defects (per Cycle 3 Review 6/10, NOT Accepted):**
  - 1. Branch checkout scope sync defect (H1): `GitBranchController.refreshBranches()` cancels in-flight reload; history entries not reloaded on checkout, leaving eligibility gated against old branch.
  - 2. Repeat identical failure suppression (H2): `GitModalsHost` fails to redisplay error dialog for repeated identical failures because `modalState.actionErrorResult` is not cleared on dismiss.
  - 3. Details dialog mutation invalidation bypass (H3): File-variant mutations in commit details dialog (cherry-pick-files, revert-files, drop-files) bypass invalidation hooks and error dialog handling.
  - 4. Premature discard invalidation (H4): Discard invalidation hook executes immediately before async request completes and fires on failure.
  - 5. Query parameter encoding corruption (H5): Default `encodeURLQueryComponent()` leaves `& + # =` raw, risking path corruption for special worktree paths.
  - 6. Live disposable repo verification: Real disposable multi-root/worktree repository qualification deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 139 Static Invariant Assertions verified in `tests/test-phase-12-git-history.sh` covering wire models, repositories, routing integrity, controllers, worktree prechecks, leased push safety, and zero FABs.
  - 754 Cumulative Static Assertions passing across all 11 static test scripts (Phases 02–12, 100% pass rate).
  - 292 Automated Unit Test executions passing across `:shared:jvmTest`, `:androidApp:testDebugUnitTest`, and `:androidApp:testReleaseUnitTest`.
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 6/10 (Cycle 3 Review `plans/reports/code-reviewer-261016-1222-phase-12-cycle-3-git-safe-history.md`), recorded as CHANGES REQUIRED / NOT ACCEPTED; user approved baseline with documented open implementation limitations (H1–H5 and Phase 18 deferred live qualification).

### 7.16 Phase 13 Workflow Tracking and Project Plans Baseline
- **Required Invariants & Scaffolding Scope:**
  - Multi-product workflow surface: Single authoritative panel host `WorkflowPanelScreen` under `WorkbenchPanel.WORKFLOW` with top segmented selector between manual workflow tracking (`WorkflowSubProduct.TRACKING`) and read-only project plans (`WorkflowSubProduct.PROJECT_PLANS`).
  - Workflow domain contracts (W01): `WorkflowModels.kt` declaring typed enums (`ItemKind`, `ItemStatus`, `SessionStatus`, `ResourceLinkType`, `ResourceObservedState`, `WorkflowSource`), DTOs (`ItemDto`, `SessionDto`, `LinkDto`, `NoteDto`, `EventDto` with nullable target, `WorkflowOverviewDto`, `WorkflowEventsDto`, `PurgeDto`), mutation requests with custom `PatchItemRequestSerializer`, and `WorkflowDomainHelpers` (hierarchy validation `isValidParentKind`, valid status transitions `isValidStatusTransition`, progress formatting `formatTrackedTasksProgress`).
  - Workflow repository & controller: `WorkflowRepository` executing protected REST operations (`/api/workflow/overview`, `/events`, items, sessions, notes, purge); RFC4122 v4 UUID request identity generation; HTTP 404 detection for profiles without workflow tracking enabled (`WorkflowOverviewResult.Unavailable`). `WorkflowController` enforcing multi-server profile and generation fencing via `updateContext`, optimistic CAS conflict preservation (`conflictWarning = "Item was modified remotely. Your draft was preserved."`), and explicit non-blocking manual lifecycle (terminal exit never auto-completes tasks).
  - Workspace history purge safety: History purge confirmation dialog (`PurgeHistoryDialog`) explicitly labelled workspace-wide ("Purge All Workspace History", deleting events across all workspace projects).
  - Project plans domain & repository (W02): `ProjectPlansRepository` querying `/api/plans/folders` and `/api/plans` (with camelCase `planPath` parameter); strict path traversal guards rejecting absolute paths, leading slashes, parent segments (`..`, `.`), and external URLs (`http://`, `https://`).
  - 64 KiB bounded reads: `PlanConstants.MAX_DOCUMENT_BYTES = 64 * 1024` document read ceiling via `FileRepository` with `maxBytes + 1` range requests, mapping excess sizes to `PlanDocumentReadResult.Oversize`.
  - Hierarchical plan navigation: `ProjectPlansController` folder browsing, auto-open on `PLAN` kind folder (`selectPlan(response.path)`), hierarchical back-stack navigation (`handleBack()`), target switching via `updateTarget`. System back integration in `WorkbenchScreen` delegates to `projectPlansController.handleBack()` when `activePanel == WORKFLOW && workflowActiveSubProduct == PROJECT_PLANS`.
  - Native UI presentation & zero FABs: `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`, and `WorkflowPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`) and zero WebViews (`WebView`).
  - Exception B02 compliance: Markdown documents rendered natively via `MarkdownPreviewView`. Mermaid diagrams display an explicit rendering-unavailable notice (`⚠ Mermaid rendering deferred for this release`) adhering to approved exception B02.
- **Implemented Mechanisms:**
  - Repositories: `WorkflowRepository`, `ProjectPlansRepository` (`features/workflow/`).
  - Controllers: `WorkflowController`, `ProjectPlansController` (`features/workflow/`).
  - Models: `WorkflowModels.kt`, `ProjectPlanModels.kt` (`features/workflow/`).
  - Views & Modals: `WorkflowPanelScreen.kt`, `WorkflowScreens.kt`, `WorkflowModals.kt`, `WorkflowSessionsAndEventsView.kt`, `ProjectPlanScreens.kt`.
  - Host integration: `WorkbenchScreen.kt` (wiring both controllers, target update, and `panelBackHandler`).
- **Documented Open Limitations & Implementation Gaps (per Review & Ledger):**
  - 1. Ephemeral client-side session links: Server overview returns no link collection endpoint; session links and observed states exist client-side only and clear on context update/refresh.
  - 2. Workspace-wide purge destructive scope: Server purge deletes events across all projects in the workspace; native UI reflects workspace-wide scope.
  - 3. Free-text terminal/agent link: Terminal and agent linking uses free-text ID entry rather than live terminal picker from active sessions.
  - 4. Live device & WebSocket qualification: End-to-end device execution, watcher installation/rebinding, and live server interop deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 100 Static Invariant Assertions verified in `tests/test-phase-13-workflow-plans.sh` across 5 suites (models, repository REST contracts, plan models/DTOs, bounded document reads, controllers, UI surfaces, and zero-FAB invariants).
  - 854 Cumulative Static Assertions passing across all 12 static test scripts (Phases 02–13, 100% pass rate).
  - 274 Automated Unit Test executions passing across `:shared:jvmTest` (224 tests) and `:androidApp:testDebugUnitTest` (50 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds (65 tasks up-to-date/passing).
  - Code Review Score: 5/10 in Cycle 2, with Cycle 3 remediations resolving plan auto-open loop and workspace purge scope; baseline recorded with documented open implementation limitations deferred to Phase 18.

### 7.17 Phase 14 Agent Store, Memory and Imports Baseline
- **Required Invariants & Scaffolding Scope:**
  - Multi-product agent workbench surface: Single authoritative panel host `AgentsUnifiedPanelScreen` under `WorkbenchPanel.AGENTS` with top segmented selector between Agent Store catalog/distribution (`AgentsSubProduct.STORE`), agent memory editing/templates (`AgentsSubProduct.MEMORY`), Git repo / server-local imports (`AgentsSubProduct.IMPORT`), and live terminal observation (`AgentsSubProduct.OBSERVATION`).
  - Agent Store domain wire contracts (S01, S02): `AgentStoreModels.kt` declaring typed enums (`AgentType`, `AgentItemCategory`, `DistributionMethod`), catalog and health DTOs (`AgentStoreItem`, `DistributionStatus`, `ShipResult`, `BrokenSymlink`, `OrphanedItem`, `HealthCheckResult`, `AgentPresence`, `ProjectAgentScanResult`), action requests (`ShipRequest`, `UnshipRequest`, `AbsorbRequest`, `BulkShipRequest`), memory DTOs (`MemoryTemplateInfo`, `ProjectMemoryAgentEntry`, `ProjectMemoryDetailResponse`, `UpdateMemoryRequest`, `ApplyTemplateRequest`, `ApplyTemplateResponse`), and import DTOs (`RepoScanItem`, `ScanRepoRequest`, `ScanRepoResponse`, `ScanLocalRequest`, `ScanLocalResponse`, `ImportConfirmRequest`, `ImportResult`).
  - Repositories: `AgentStoreRepository` (REST operations for `/api/agent-store`, item content, delete, ship, unship, absorb, bulk-ship, matrix, scan, health; HTTP 404 detection for unavailable store feature; path segment encoding), `AgentMemoryRepository` (REST operations for templates, project memory CRUD, and template application), `AgentImportRepository` (Git repository clone scan, server directory scan, confirm import).
  - Controllers & lifecycle isolation: Controller-instance ownership with explicit `retire()` clearing state on profile disconnect or reconnect. `AgentStoreController` with monotonic `requestSequence` and `contentRequestSequence`. `AgentMemoryController` with monotonic `readOpRevision`, `templateOpRevision`, and `saveOpRevision`, dirty draft protection (`isDirty`) with `pendingTargetSwitch` dialog on project switch, and safe saves tracking `initialSavedContent`. `AgentImportController` with monotonic `scanRevision` tracking on source switch and reset, safe cleanup derivation (`cleanup = source == ImportSource.REPO`), and deduplication keying.
  - Native UI presentation & zero FABs: `AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, and `AgentsUnifiedPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`), zero WebViews (`WebView`), and native markdown rendering via `MarkdownPreviewView`.
- **Implemented Mechanisms:**
  - Repositories: `AgentStoreRepository`, `AgentMemoryRepository`, `AgentImportRepository` (`features/agents/`).
  - Controllers: `AgentStoreController`, `AgentMemoryController`, `AgentImportController` (`features/agents/`).
  - Models: `AgentStoreModels.kt` (`features/agents/`).
  - Views & Modals: `AgentStoreScreens.kt`, `AgentDistributionMatrixView.kt`, `AgentStoreModals.kt`, `AgentMemoryScreens.kt`, `AgentImportScreens.kt`, `AgentsUnifiedPanelScreen.kt`.
  - Host integration: `WorkbenchScreen.kt` (wiring all three controllers and reducer under `agentsContent`).
- **Documented Open Limitations & Review Findings (Cycle 2 Review 7/10):**
  - 1. Save retry lockout (H1): Shared `error` field in `AgentMemoryState` locks out save retries after transient failure until target switch.
  - 2. Controller reconnect initialization (H2): Reconnect effect replacing controller without project list change can miss initial `setProjects` call.
  - 3. Stale import confirm race (H3): `confirmImport` lacks scan-revision fencing on late response application.
  - 4. Empty project list draft loss (M5): Switching to empty project list drops dirty memory drafts without a prompt.
  - 5. REPO partial-import cleanup (M3): Retaining captured scan on partial failure risks retry hitting deleted temp directory.
  - 6. Absorb action server semantics (M2): Server absorb moves project-local non-symlink items to the store; offering absorb on shipped matrix cells contradicts server distributor semantics.
  - 7. Unused repository methods: `getItem` and `listProjectMemory` lack UI callers.
  - 8. Live qualification (L1/L2): Physical Android device execution, symlink traversal across filesystems, and live temp dir deletion deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 99 Static Invariant Assertions verified in `tests/test-phase-14-agent-store-memory.sh` across 6 suites (wire models, store repo, memory repo, import repo, controllers/fencing, UI surfaces, and zero-FAB invariants).
  - 953 Cumulative Static Assertions passing across all 13 static test scripts (Phases 02–14, 100% pass rate).
  - Reported 303 Automated Unit Test executions passing across `:shared:jvmTest` (252 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (51 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 2 (CHANGES REQUESTED); baseline recorded with documented open implementation limitations deferred to Phase 18.

### 7.18 Phase 15 Host Resources Fleet and Usage Baseline
- **Required Invariants & Scaffolding Scope:**
  - Unified Resources surface: Single authoritative panel host `ResourcesUnifiedPanelScreen` under `WorkbenchPanel.RESOURCES` with top segmented switcher between Fleet Resources (`ResourcesSubProduct.FLEET`) and Usage Insights (`ResourcesSubProduct.USAGE`).
  - Host resources & alert models (H01): `HostResourceModels.kt`, `HostMetricsModels.kt`, `HostResourceAlertModels.kt` declaring typed enums (`AvailabilityState`, `AlertState`, `AlertSeverity`) and DTOs for snapshot v1, availability, memory pressure, cgroups, process inventory, CPU/disk metrics, alert summaries/incidents.
  - Streaming, coordination & atomic pairing (H01): `HostResourceSseClient` (authenticated OkHttp SSE with 256 KiB event cap), `ResourceStreamCoordinator` (per-owner subscriber counts, demand-driven visible stream vs 5s REST fallback, admission gating), `ResourceFrameCommitter` (atomic snapshot/metrics pairing, monotonic decimal revision checks, epoch restart tracking), `ResourceFailureHandler` (latching `AUTH_UNAVAILABLE` to AuthBlocked, `FRAME_TOO_LARGE` to RestOnly), and `ResourceStreamTimers` (10s initial data deadline, 45s byte idle timeout, 5 retries with backoff, 60s stable window).
  - Aggregate usage analytics & safe deletion (U01): `UsageModels.kt`, `UsageSettingsModels.kt`, `UsageRepository.kt`, and `UsageController.kt` isolating aggregate summaries from raw telemetry; managing opaque cursor pagination (omitting `from/to` on continuation pages when `cursor != null`); enforcing UTC midnight floored date-range calculations (`calculateUtcDayRange`); protecting deletion with re-entrancy/disposed guards and default confirmation token `"delete-usage-data"`; and bumping `summaryGeneration`/`sessionsGeneration` to fence stale loads.
  - Native UI presentation & zero FABs: `FleetScreens.kt`, `FleetDetailComponents.kt`, `UsageScreens.kt`, `UsageDialogs.kt`, `UsageSettingsSection.kt`, and `ResourcesUnifiedPanelScreen.kt` enforcing zero floating action buttons (`FloatingActionButton`, `ExtendedFloatingActionButton`), zero WebViews (`WebView`), single content host in `PanelHost`, and honest null indicators (`--`) without fabricating zero metrics.
- **Implemented Mechanisms:**
  - Repositories: `HostResourceRepository.kt`, `UsageRepository.kt` (`features/host/`).
  - Coordinators & Handlers: `ResourceStreamCoordinator.kt`, `ResourceFrameCommitter.kt`, `ResourceFailureHandler.kt`, `ResourceStreamTimers.kt` (`features/host/`).
  - Transport: `HostResourceSseClient.kt` (`core/transport/`).
  - Controllers: `HostResourceController.kt`, `UsageController.kt` (`features/host/`).
  - Models: `HostResourceModels.kt`, `HostMetricsModels.kt`, `HostResourceAlertModels.kt`, `ResourceStreamModels.kt`, `UsageModels.kt`, `UsageSettingsModels.kt`, `UsageUiState.kt` (`features/host/`).
  - Views & Modals: `FleetScreens.kt`, `FleetDetailComponents.kt`, `UsageScreens.kt`, `UsageDialogs.kt`, `UsageSettingsSection.kt`, `ResourcesUnifiedPanelScreen.kt` (`features/host/`).
  - Host integration: `WorkbenchScreen.kt` (wiring both controllers under `resourcesContent` and back handler).
- **Documented Open Limitations & Review Findings (Cycle 3 Review 7/10):**
  - 1. Range-delete today exclusion: Range deletion floors to UTC midnight with `to = todayUtc`, excluding today's events from day-count deletion (deferred semantics clarification/relabeling).
  - 2. Dialog epoch-ms display: Range delete dialog displays raw epoch-ms bounds instead of formatted UTC date strings.
  - 3. Incomplete settings controls: Only pause/resume is wired; enable, exporter, retention, and retry controls remain read-only.
  - 4. Hardcoded model filter chip: Hardcoded `"gpt-4"` filter chip instead of deriving model options dynamically from session summaries.
  - 5. Live qualification: Physical Android device execution, real SSE proxy buffering, and 32 global / 4 per-subject server admission limit qualification deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 81 Static Invariant Assertions verified in `tests/test-phase-15-host-resources-usage.sh` across 5 suites (host models/DTOs, usage models/DTOs, streaming/pairing/coordination, repositories/controllers, and UI/shell invariants).
  - 1034 Cumulative Static Assertions passing across all 14 static test scripts (Phases 02–15, 100% pass rate).
  - Reported 398 Automated Unit Test executions passing across `:shared:jvmTest` (272 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (126 tests).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 3 (user approved baseline with documented open implementation limitations deferred to Phase 18).

### 7.19 Phase 16 Ports, Tunnels, Idle Consent and Host Controls Baseline
- **Required Invariants & Scaffolding Scope:**
  - Ports and Cloudflared tunnels (P01): `PortRepository` and `TunnelRepository` (`features/host/`) providing REST `/api/ports`, `/api/tunnels`, `/api/tunnels/install`; WebSocket events `PortDiscovered`, `PortLost` with monotonic incarnation sequence checking (`msg.incarnation >= existing.incarnation`); `TunnelReady`, `TunnelFailed`, `TunnelStopped`, `TunnelReminder` (`reminderDue = true`). Authoritative single content host `PortsPanelScreen` docked under `WorkbenchPanel.PORTS` with zero FABs.
  - Idle suspend & live socket capability consent (H02): `IdleSuspendRepository` and `IdleConsentController` (`features/host/`) providing REST `/api/system/idle-suspend/v1/status`, `/timing`, `/force-suspend`, `/consent/decision`; fallback normalization `decodeIdleSuspendStatusV1`; WebSocket `host:uiConnection` live receipt capability gating rejecting consent decisions when absent; typed 409 conflict exceptions (`ActiveFleet`, `FleetChanged`, `Handoff`); ticking countdown banner `WorkbenchSleepConsentBanner` with zero-expiration button lockout.
  - Remote SSH keys, host controls & diagnostics (C03): `SshRepository`, `HostControlRepository`, `DiagnosticsRepository` (`features/host/`) providing REST `/api/ssh/keys`, `/api/ssh/agent`, `/api/ssh/keys/load` with `passphrase=[REDACTED]`, per-key credential maps and forget/load operations by key basename; host actions `/capabilities`, `/intents`, `/approve`, `/executions`, `/audit` (repository scaffolding; action execution flows lack UI callers); diagnostics export `/api/diagnostics/export` with privacy default `includeTerminalOutput = false` acknowledging server memory storage. Authoritative single content host `HostControlScreens` docked under `WorkbenchPanel.SSH_HOST` with zero FABs.
- **Documented Open Limitations & Review Findings (Cycle 2 Review 7/10 — Changes Required / Qualification Open):**
  - High-1 (Action error clearing): `refreshStatus()` clears `_actionError` before render; mutation failures in `submitConsent` / `requestForceSuspend` remain unrendered in banner and force dialog.
  - High-2 (Reconnect reconciliation): Missing status reconciliation on WebSocket reconnect or new receipt; consent becoming pending while WS is down is not pushed until subsequent hint or tab switch.
  - High-3 (Default forget check): Default credential forget ignores `success=false` / `forgotten=false` / `error`; silent agent/capabilities query failures.
  - Warnings W-A through W-I: WS handler coroutine launch on every message; mixed-owner profile window during initialization; tunnel/port snapshot replacement races vs live WS updates; device clock skew vs server `expiresAtMs`.
  - Static structural assertions (194/194) assert AST/source invariants (models, routes, wire mappings, 0 FABs, 0 WebViews, redactions) without establishing dynamic Compose interaction or behavioral execution.
  - Live qualification: Physical Android hardware, live server WebSocket integration, and credential keystore binding deferred to Phase 18.
- **Verified Acceptance Evidence & Open Qualification:**
  - 194 Static Invariant Assertions verified in `tests/test-phase-16-ports-tunnels-host-controls.sh` across 6 suites (port/tunnel models, repositories, idle suspend models, consent controller, SSH/diagnostics, UI/shell invariants).
  - 1228 Cumulative Static Assertions passing across all 15 static test scripts (Phases 02–16, 100% pass rate).
  - Dated QA report recorded 417 automated unit test executions across `:shared:jvmTest` (281 tests) and `:androidApp:testDebugUnitTest`/`:androidApp:testReleaseUnitTest` (136 tests); Cycle 2 review recorded 350 unique tests (282 shared + 68 debug).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 7/10 in Cycle 2 (changes required, qualification open with documented open implementation limitations deferred to Phase 18).

### 7.20 Phase 17 Preferences, Privacy, Notifications and Lifecycle Baseline
- **Required Invariants & Scaffolding Scope:**
  - Ephemeral Cognito privacy mode (V01): `PrivacyController` (ephemeral in-memory mask without disk/recents leakage), configurable keyboard chord trigger, emergency 800ms triple-tap touch dismissal, multi-layer defense-in-depth input blocking at `TerminalSessionController`, `TerminalInputController`, `EditorSession`, and `AndroidEditorSurface` dispatch boundaries. Full-viewport `CognitoOverlay` consuming pointer input and suppressing accessibility tree.
  - Settings & Preferences (C02): `SettingsModels.kt`, `SettingsRepository.kt`, `PreferencesStore.kt`, `AndroidPreferencesStore.kt` supporting multi-source preferences (`LOCAL_DEVICE`, `GLOBAL_REMOTE`, `WORKSPACE_REMOTE`), 1 MiB TOML config import ceiling (`MAX_CONFIG_IMPORT_BYTES`), bounds clamping for font sizes (10..32), tab sizes (2..8), and terminal scrollback (1,000..100,000).
  - Notification sink (N01): `NotificationSink.kt`, `AndroidNotificationSink.kt` declaring 4 private channels (`channel_terminal_attention`, `channel_transfers`, `channel_idle_suspend`, `channel_system_health`) with lockscreen privacy `VISIBILITY_PRIVATE`, redacted public generic payloads, and `FLAG_IMMUTABLE` deep-link intents carrying `EXTRA_TARGET_PROFILE_ID` and `EXTRA_TARGET_GENERATION`.
  - Lifecycle coordinator: `LifecycleCoordinator.kt`, `AndroidLifecycleCoordinator.kt` managing `FOREGROUND`, `BACKGROUND`, `DESTROYED` states and `onProfileRetired` teardown without leaks.
  - Native Compose UI: `SettingsScreens.kt` docked under `WorkbenchPanel.SETTINGS` with zero FABs, zero WebViews.
- **Verified Acceptance Evidence:**
  - 104 Static Invariant Assertions verified in `tests/test-phase-17-preferences-privacy-lifecycle.sh` across 6 suites (100% pass rate).
  - 1332 Cumulative Static Assertions passing across all 16 static test scripts (Phases 02–17).
  - 454 Automated Unit Test executions passing across shared JVM and Android variants.
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds.
  - Code Review Score: 6/10 in Cycle 2 (user approved baseline with documented open limitations deferred to Phase 18).

### 7.21 Phase 18 Integrated Device Security and Performance Qualification Baseline
- **Required Invariants & Scaffolding Scope:**
  - Core qualification suite: `OwnershipAndReplayTests.kt` in `native-app/shared/src/commonTest/` proving multi-server profile isolation, generation watermark rejection, UTF-8 chunk boundary splitting and multi-byte sequence preservation, terminal replay ordering/gap/overlap/duplicate handling, clean SSE stream EOF handling, 5s REST fallback interval verification, UTC date interval calculation and formatting, and fail-closed crypto envelope tamper rejection.
  - Workbench journeys: `WorkbenchJourneysUnitTest.kt` in `native-app/androidApp/src/test/` and `WorkbenchJourneys.kt` in `native-app/androidApp/src/androidTest/` validating in-memory model state, navigation stack unwinding, solitary top navigation row, zero FABs, zero WebViews, and Cognito privacy overlay input gating (on-device model/state smoke only; real-server UI/IME/PTY journeys remain open).
  - Device journey runner: `native-app/scripts/run-device-journeys.sh` configuring reverse port forwarding (4801) and executing Android instrumentation journeys; cleanly reports `BLOCKED_PENDING_DEVICE` (exit 2) when physical or emulator hardware is unavailable without falsifying verification evidence.
  - APK security & ABI audit: `native-app/scripts/audit-apk-security.sh` unpacking `androidApp-debug.apk` and validating manifest backup flags (`allowBackup="false"`, `fullBackupContent="false"`), data extraction rules, `windowSoftInputMode="adjustResize"`, TLS-only release network security, zero unredacted secret leaks, target ABIs (`arm64-v8a`, `x86_64`), and real 16 KiB ELF segment alignment checks on packaged libraries.
  - Cross-phase remediations delivered: Phase 15 clean EOF in `ResourceStreamCoordinator`, 5s REST fallback and `LifecycleAware` in `HostResourceController` registered in `WorkbenchScreen`, dynamic model filter derivation with `knownModels` accumulation in `UsageController`/`UsageScreens`, explicit UTC date bounds and completed-days interval labeling in `UsageDialogs`; Phase 16 action error preservation across refresh in `IdleConsentController`, SSH credential forget failure validation in `SshRepository`; Phase 17 runtime `WorkbenchTheme` in `NativeTheme`, font sizes wired into `TerminalPanelScreen` (header label), `EditorPanelScreen`, and `NativeTextEditorView`.
- **Documented Open Limitations & Deferred Items:**
  - L1 (Device Hardware & Runtime): Physical ARM64 device attachment, physical 16 KiB page size execution, and human visual review tracked for physical device testbed (GATE-C BLOCKED_PENDING_DEVICE).
  - L2 (Native Library Packaging): Native crypto bridge packaging: `libdamhopper_crypto_bridge.so` is built in `crypto-bridge` host crate but not yet packaged into Android APK `jniLibs` (tracked for Phase 19 release packaging).
  - L3 (Phase 15 Residuals): Live SSE proxy buffering, 32 global / 4 per-subject server admission limits, background dispatcher payload decoding, exporter toggle, and end-of-day boundary option open.
  - L4 (Phase 17 Residuals): Terminal scrollback preference consumption, runtime `POST_NOTIFICATIONS` permission launcher, and Android SAF file picker open.
  - L5 (Live Journeys, Performance & Licensing): Real-server UI/IME/PTY journeys, performance/soak profiling, and third-party license audit open.
- **Verified Acceptance Evidence & Gate Disposition:**
  - Static invariant test suite `tests/test-phase-18-device-qualification.sh` passing all 98 assertions (1,430 cumulative assertions across 17 test scripts).
  - 481 automated unit test executions passing (399 unique: 7 Rust + 310 shared JVM + 82 Android debug + 82 Android release).
  - Clean debug APK assembly: `pnpm native-app:assembleDebug` succeeds (55 tasks).
  - Security audit script `native-app/scripts/audit-apk-security.sh` passes 13/13 static manifest/TLS/secret checks.
  - Device journey script `native-app/scripts/run-device-journeys.sh` reports `BLOCKED_PENDING_DEVICE` (exit 2) when headless.
  - Disposition: **Tooling baseline recorded; automated unit tests (481 executions, 399 unique), 1,430 static invariant assertions, and clean assembleDebug APK passing; GATE-C qualification is BLOCKED_PENDING_DEVICE pending physical device hardware, live server journeys, 16 KiB runtime execution, and human visual signoff**.
---

## 8. Gate Approvals & Implementation Sequence

- **GATE-A1 (Scope & Contract Freeze):** **PASSED** in Phase 01. Complete feature inventory, panel registry, wire DTO schemas, and explicit exclusions frozen.
- **GATE-A2 (Foundation & Toolchain):** **FOUNDATION & SECURITY VERIFIED (Launch Qualification Open)** in Phase 02. Two-module Gradle KMP architecture (`:shared`, `:androidApp`), pinned toolchain catalog, 12-panel registry enum, Compose entry with `statusBarsPadding()`, manifest/network security policies, and root scripts (`pnpm native-app:test`, `pnpm native-app:test:android`, `pnpm native-app:assembleDebug`) implemented. Automated static verification script `tests/test-phase-02-foundation.sh` passes 47/47 static assertions. Physical ARM64 device and x86_64 emulator runtime launch qualification remain pending device attachment.
- **Phase 03 (Contracts Ownership & Live Transport Foundation):** **IMPLEMENTED (Qualification Open)** in Phase 03 (2026-10-15). Complete owner-bound networking layer implemented in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/` and `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/`. Verified by 48/48 static transport assertions in `tests/test-phase-03-transport.sh`, 28/28 shared JVM unit tests in `pnpm native-app:test`, and clean `pnpm native-app:assembleDebug`. Live Axum daemon lifecycle qualification and device runtime attachment remain open.
- **Phase 04 (Profiles Authentication, MFA & Credential Vault):** **IMPLEMENTED (Live Qualification Pending)** in Phase 04 (2026-10-15). Multi-server profile lifecycle, Android Keystore-backed AES-256-GCM `AndroidCredentialVault`, monotonic `AuthAttemptTracker` fencing, `ProfileMetadataStore` persistence, and frozen protocol version 2 authentication stack implemented in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/` and `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/`. Verified by 57/57 static assertions in `tests/test-phase-04-profiles-auth.sh`, 53/53 shared JVM unit tests in `pnpm native-app:test`, 7/7 Android debug unit tests in `pnpm native-app:test:android`, and clean `pnpm native-app:assembleDebug`. Live Axum daemon qualification and physical device Keystore evidence remain tracked under open qualification gates and Phase 18.
- **GATE-B (Native Terminal, Editor & Crypto Proof):** **CONTRACT/HOST PROTOTYPE VALIDATED (Android Runtime Feasibility Unproven)** in Phase 05 (2026-10-15). Contract prototypes, candidate pin records (ConnectBot termlib 0.3.13 / libvterm.so, Sora Editor 0.23.4), offline JSON language service, and exact OPAQUE DamHopperOpaqueSuite cryptographic bridge implemented and verified on host. Recorded automated checks passed 100% (336 total checks: 118 unit test executions [92 unique tests] + 218 static invariant assertions). Subgates for physical ARM64 device qualification, 16 KiB kernel page size execution, Sora/ConnectBot AAR UI rendering/relinking, live server OPAQUE handshake, and TypeScript non-browser engine/LSP decision remain explicitly open and tracked for downstream phases (Phases 07, 09, 11, 18).
- **Phase 06 (TERMINAL Traditional Shell, Projects & Config):** **IMPLEMENTED (Qualification Open)** in Phase 06 (2026-10-16). Authoritative 12-panel navigation row with `BringIntoViewRequester` auto-reveal, single content area `PanelHost`, back-stack state machine (`WorkbenchNavigation`), `ProjectTargetStore` with workspace revision fencing and fail-closed unavailable target handling (no silent redirects to root), destructive workspace switch lifecycle with PTY disposal warning dialog (`WorkspaceSwitchWarningDialog`), and conflict-aware `RemoteConfigEditor` preserving whole-document JSON fidelity. Verified by 64/64 static assertions in `tests/test-phase-06-shell-workspace.sh`, 25 JVM/Android unit tests in `:shared:jvmTest` and `:androidApp:testDebugUnitTest`, and clean `:androidApp:assembleDebug` (Cycle 2 Review 9.4/10). Physical hardware runtime qualification and device scrolling validation deferred to Phase 18.
- **Phase 07 (Terminal Sessions, Replay, Input, and Agent Status):** **HOST CONTRACTS IMPLEMENTED (Native Surface Integration & Device Qualification Open)** in Phase 07 (2026-10-16). Session CRUD operations, stream replay gate with byte-for-byte reconciliation (`TerminalReplayGate`), server-authoritative agent status reducer with epoch/revision fencing (`AgentStatusReducer`), retained session controller (`TerminalSessionController`), and platform input bridging (`TerminalInputController`) implemented and verified on host. Verified by 45/45 static assertions in `tests/test-phase-07-terminal-agents.sh`, with recorded QA report noting 155 JVM/Android unit tests passing and clean `:androidApp:assembleDebug` (Cycle 2 Review 8.8/10). Live emulator canvas integration in `TerminalScreens`, ConnectBot `libvterm.so` JNI binding, physical soft keyboard IME candidate composition, window insets under `adjustResize`, and live server WebSocket PTY streaming qualification remain open gates deferred to Phase 18.
- **Phase 08 (Filesystem Watchers, Search and Replace):** **IMPLEMENTATION BASELINE RECORDED (Live Qualification & Safety Gates Open)** in Phase 08 (2026-10-16). Target-qualified filesystem repository (`FileRepository`), file tree controller with lazy expansion and hidden-file toggle (`FileTreeState`), subscription manager with early-event buffering (`TreeSubscriptionManager`), federated search coordinator with 500-match cap (`FederatedSearchCoordinator`), and literal replace coordinator with read-to-write CAS (`ReplaceCoordinator`) implemented and integrated into `FilesPanelScreen` with zero FABs. Verified by 57 static source assertions in `tests/test-phase-08-filesystem-watchers.sh`, with dated QA report recording 194 unit test executions (covering 155 unique test definitions across JVM and Android debug/release) and clean `:androidApp:assembleDebug`. Cycle 2 review (6/10, CHANGES REQUESTED) baseline approved by user with recorded limitations (lossy UTF-8 fallback, timeout-as-cancellation batch abort, root-only watcher, secondary profile target, dirty gate pending Phase 09, outcome UI); unblocks Phase 09 development while safety gates remain open.
- **Phase 09 (Native Editor Language Services & Safe Saves):** **IMPLEMENTATION BASELINE RECORDED (User-Approved with Documented Open Limitations; Phase 10 Unblocked)** in Phase 09 (2026-10-16). Exact file tier policy (< 1 MiB normal, ≥ 1 MiB and < 5 MiB degraded, ≥ 5 MiB large 64 KiB range pager, binary hex view, media preview-only), in-memory session with submitted-bytes baseline tracking and bounded undo/redo (`EditorSession`), safe-save coordinator with atomic transforms (`EditorTabSaveCoordinator`), multi-tab controller with clean auto-reload, dirty stale flag, `discardAndReloadTab`, and authoritative `isDirtyFile` wiring into `ReplaceCoordinator` (`EditorTabsState`), offline `JsonLanguageService` and `TsJsLanguageService` delimiter scanner implemented. Documented open limitations: Sora native canvas binding deferred to Phase 18, TS/JS semantic analysis formally BLOCKED per `TypeScriptLanguageServiceAudit`, and encrypted save fail-closed until Phase 11. Traceable verification: dated QA report `plans/reports/qa-261016-0718-phase-09-editor-saves-cycle-3.md`, review report `plans/reports/code-reviewer-261016-0709-phase-09-editor-saves-cycle2.md`; 70 static assertions in `tests/test-phase-09-editor-saves.sh`, 454 cumulative static assertions across 8 test suites, 219 unit test executions (180 unique test methods), and clean `:androidApp:assembleDebug` build.
- **Phase 10 (Native Diff, Merge Conflict Resolution and Git Blame):** **IMPLEMENTATION BASELINE RECORDED (User-Approved 9/10; Phase 11 Unblocked)** in Phase 10 (2026-10-16 09:48:17 +07:00). Native diff review (side-by-side and inline layouts, 10,000 line computation cap, server hunk mapping, hunk discard with dirty buffer/read-only guards, CAS baselineMtime saves), 3-way merge conflict editor (2-way and 3-way/diff3 marker parsing, ours/theirs/ancestor/both resolution, malformed marker detection, server resolve submission), and Git blame attribution (5 MiB buffer cap, 250 ms keystroke debounce with per-file coroutine cancellation, strict contiguous partition validation, bounded 64-entry/32 MiB LRU cache with SHA-256 buffer fingerprinting, and gutter commit inspection) implemented and integrated into `WorkbenchScreen` with zero FABs. Verified by 77/77 static assertions in `tests/test-phase-10-diff-merge-blame.sh`, 531 cumulative assertions across Phases 02–10, 246 passing unit tests, and Cycle 5 review score 9/10 with documented open limitations.
- **Phase 11 (Encrypted Transfers, Media Streaming and Android Storage):** **IMPLEMENTATION BASELINE RECORDED (Scaffolding Delivered; Production Wiring, Security Remediation & Live Qualification Open)** in Phase 11 (2026-10-16). Crypto envelopes, session lifecycle models, WebSocket chunked transfer state machines, encrypted save coordinators, Android SAF document storage interfaces, origin-bound media client, and video surface components implemented. Verified by 84/84 static assertions in `tests/test-phase-11-encrypted-transfers-media.sh` (615 cumulative assertions across Phases 02–11) and 7/7 Rust crypto-bridge unit tests. Code review cycle 2 recorded score 5/10 (CHANGES REQUIRED) with documented open limitations: production wiring of crypto session and SAF picker, fail-closed cookie capture, range read buffer bounds, and live device/server qualification deferred to Phase 18.
- **Phase 12 (Complete Git and Safe History Workflows):** **IMPLEMENTATION BASELINE RECORDED (Code Review Score 6/10, Changes Required / Not Accepted; User Approved Baseline with Documented Open Limitations)** in Phase 12 (2026-10-16). Multi-repository facade (`GitRepository`), changes/staging controller (`GitChangesController`), branch/worktree mutations with prechecks (`GitBranchController`, `WorktreeMutationController`), safe history rewrites distinguishing inactive local from active branch actions (`GitRewriteActionController`, `GitHistoryActionController`), leased push publication safety gate (`LeasedPublishController`), and inline Compose presentation (`GitPanelScreen`, `GitModalsHost`) with zero FABs implemented. Verified by 139/139 static assertions in `tests/test-phase-12-git-history.sh` (754 cumulative static assertions across Phases 02–12) and 292 unit test executions. Cycle 3 review recorded score 6/10 with documented open limitations: branch checkout scope sync (H1), repeat failure suppression (H2), details dialog file-variant mutation invalidation (H3), premature discard invalidation (H4), query parameter encoding corruption (H5), and real disposable repo verification deferred to Phase 18.
- **Phase 13 (Workflow Tracking & Project Plans):** **IMPLEMENTATION BASELINE RECORDED (Cycle 3 Remediations Verified; Documented Open Limitations & Live Qualification Deferred to Phase 18)** in Phase 13 (2026-10-16). Manual workflow CRUD, sessions, notes, workspace-wide history purge, and CAS conflict preservation implemented in `WorkflowRepository` and `WorkflowController`. Read-only project plan folder browsing, camelCase `planPath`, 64 KiB bounded reads (`MAX_DOCUMENT_BYTES`), path traversal security, and hierarchical back-stack implemented in `ProjectPlansRepository` and `ProjectPlansController`. Single content host `WorkflowPanelScreen` under `WorkbenchPanel.WORKFLOW`, zero FABs, zero WebViews, conditional back handler in `WorkbenchScreen`, and native Markdown rendering with exception B02 Mermaid notice. Verified by 100/100 static assertions in `tests/test-phase-13-workflow-plans.sh`, 854 cumulative static assertions across 12 phase scripts, 274 automated unit tests, and clean `assembleDebug` APK. Open limitations documented (ephemeral session links, workspace-wide purge, free-text terminal link IDs; live device qualification deferred to Phase 18; unblocks Phase 14).
- **Phase 14 (Agent Store, Imports and Memory):** **IMPLEMENTATION BASELINE RECORDED (Cycle 2 Review Score 7/10; Documented Open Limitations & Live Qualification Deferred to Phase 18)** in Phase 14 (2026-10-16). Native Agent Store catalog distribution (`AgentStoreRepository`, `AgentStoreController`), agent memory editor with template markdown preview (`AgentMemoryRepository`, `AgentMemoryController`), and Git repository / server-local imports (`AgentImportRepository`, `AgentImportController`) implemented and integrated into authoritative single content host `AgentsUnifiedPanelScreen` under `WorkbenchPanel.AGENTS`. Supports 4 sub-products (Store, Memory, Import, Observation Engine), zero FABs, zero WebViews; verified by 99/99 static assertions in `tests/test-phase-14-agent-store-memory.sh`; implementation baseline recorded with documented open limitations (save retry lockout H1, controller reconnect initialization H2, stale import confirm race H3, empty project list draft loss M5, REPO partial cleanup M3, absorb action server semantics M2, and Phase 18 live device qualification).
- **Phase 15 (Host Resources Fleet and Usage):** **IMPLEMENTATION BASELINE RECORDED (Cycle 3 Review Score 7/10; Documented Open Limitations & Live Qualification Deferred to Phase 18)** in Phase 15 (2026-10-16). Non-browser host resources fleet streaming/fallback (`HostResourceSseClient`, `ResourceStreamCoordinator`, `ResourceFrameCommitter`, `HostResourceRepository`) and aggregate usage analytics (`UsageRepository`, `UsageController`) implemented and integrated into authoritative single content host `ResourcesUnifiedPanelScreen` under `WorkbenchPanel.RESOURCES`. Supports 2 sub-products (Fleet Resources, Usage Insights), zero FABs, zero WebViews; verified by 81/81 static assertions in `tests/test-phase-15-host-resources-usage.sh`, 398 automated unit tests across shared JVM and Android variants, and clean assembleDebug APK build; open limitations and live qualification deferred to Phase 18.
- **Phase 16 (Ports, Tunnels, Idle Consent and Host Controls):** **IMPLEMENTATION BASELINE RECORDED (Cycle 2 Review Score 7/10; Changes Required / Qualification Open with Documented Open Limitations & Live Qualification Deferred to Phase 18)** in Phase 16 (2026-10-16). Non-browser port discovery, Cloudflared quick tunnels with exposure reminders, idle suspend consent controller with live WebSocket capability receipt gating, remote SSH key custody with per-key basename semantics, host remediation action scaffolding, and diagnostics export implemented and integrated into authoritative single content hosts `PortsPanelScreen` (`WorkbenchPanel.PORTS`) and `HostControlScreens` (`WorkbenchPanel.SSH_HOST`) with `WorkbenchSleepConsentBanner`. Supports zero FABs, zero WebViews; verified by 194/194 static assertions in `tests/test-phase-16-ports-tunnels-host-controls.sh`, dated QA report recording 417 unit test executions, and clean assembleDebug.
- **Phase 17 (Preferences, Privacy, Notifications & Lifecycle):** **IMPLEMENTATION BASELINE RECORDED** in Phase 17 (2026-10-17). Ephemeral Cognito privacy mode, multi-source preferences with 1 MiB TOML import ceiling, 4 private notification channels with redaction, and lifecycle coordination implemented. Verified by 104 static assertions in `tests/test-phase-17-preferences-privacy-lifecycle.sh` and 454 automated unit test runs.
- **GATE-C (Integrated Qualification):** **QUALIFICATION TOOLING & SUITES DELIVERED (Device Signoff Pending / BLOCKED_PENDING_DEVICE)** in Phase 18 (2026-10-17). Comprehensive `OwnershipAndReplayTests`, `WorkbenchJourneysUnitTest`, `WorkbenchJourneys` device instrumentation, `audit-apk-security.sh`, `run-device-journeys.sh`, and cross-phase streaming/usage/preference remediations implemented and automated tests passing 100%. Physical ARM64 device attachment, physical 16 KiB page execution, live-server journeys, and human visual review tracked for physical device testbed.
- **GATE-D (Signed Release APK):** Pending Phase 19 (Production signed APK, upgrade testing, audit handoff).
