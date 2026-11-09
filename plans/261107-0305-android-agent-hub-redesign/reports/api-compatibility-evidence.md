# API Compatibility Audit: 5 Post-261101 Plans

### 1. Plan-by-Plan Ledger & Cross-Plan Overlap
| Plan | Classification | Target / Wire Surface | Source Citations | Concrete Android Impact |
|---|---|---|---|---|
| **261103-1608** (Workspace Tree & Marks) | API + UI | `FilesystemTargetRef` REST/WS/Tickets; FileIdentity; Mark/Unmark | `server/src/workspace_target.rs:43`, `server/src/api/fs.rs:120`, `server/src/api/config.rs:220` | Android client MUST supply explicit `targetType` or nested `target`; must track `FileIdentity` for tabs/caching. |
| **261103-2016** (User Concerns Cutover) | API Strictness + UI | Single `config.toml` authority, `[workspace].root` only, no fallback | `server/src/config/parser.rs:45`, `server/src/api/config.rs:50` | Android must never expect implicit cwd/parent workspace fallback; missing workspace root returns 403 `UNCONFIGURED_WORKSPACE_ROOT`. |
| **261104-1529** (OS Session Lifetime) | API + UI | Guarded `POST /api/terminal/:id/terminate`; PTY epoch & termination headers; inventory `incarnationExact` | `server/src/api/terminal.rs:226,356,550`, `packages/ui/src/api/terminal-session-contract.ts:18` | Android MUST use guarded POST with exact string tuple `(serverEpoch, incarnationExact)`; never call legacy DELETE kill. |
| **261105-0711** (OS Desktop Polish) | API + UI | `POST /api/global-config/ui`; null shortcut `""` preservation; dock/cursor settings | `server/src/config/global.rs:140,245`, `server/src/api/config.rs:598` | Android Settings sync must preserve null as `""` for scalar shortcuts; unknown keys in UI config preserved round-trip. |
| **261106-0334** (Agent Hub Terminal-First) | UI-only | Client mount claims, attach gates, stuck-launch lifecycle; zero Rust server diff | `plans/261106-0334/plan.md:16`, `packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.ts:1` | Pure UI architecture. Android needs native equivalent of terminal attach gate / multi-view claiming if mounting terminals across panes. |

### 2. Nested FS Target Union (REST + WS + Encrypted/Media/Watch/Search)
- **Target Schema Wire Shape (`server/src/workspace_target.rs:43-51`):**
  - Workspace: `{"type": "workspace", "workspaceEpoch"?: number}`
  - Project: `{"type": "project", "project": "<string>", "worktreePath"?: "<string>"}`
- **REST (`server/src/api/fs.rs:120-155`):** `targetType=workspace` (rejects `project`/`worktreePath`) or `targetType=project&project=<name>[&worktreePath=<path>]`. Omitted `targetType` falls back to `project` if `project` query param is present.
- **WebSocket Protocol (`server/src/api/ws_protocol.rs:33,50,67,102,125,188,218`):** Inbound messages `fs:subscribe_tree`, `fs:read`, `fs:write_begin`, `fs:op`, `fs:upload_begin`, `fs:put_begin`, `fs:put_save` accept nested `target: Option<FilesystemTargetRef>`.
  - WS validation (`server/src/api/ws.rs:2272-2302`): Conflicting `target` vs legacy `project`/`worktree_path` yields `("INVALID_FS_TARGET", "conflicting target...")`.
- **Media Tickets (`server/src/api/fs_image.rs:36-80`, `server/src/api/fs_video.rs:36-80`):**
  - `POST /api/fs/image/tickets` and `POST /api/fs/video/tickets`: Request body accepts nested `target: Option<FilesystemTargetRef>` OR flat `(targetType, project, worktreePath)`. Providing both returns 400 `INVALID_FS_TARGET`.
- **Search & Watch (`server/src/api/fs.rs:486,555`, `server/src/api/ws.rs:3624`):**
  - Workspace search: traverses authorized root; project scope parameter on workspace target rejected (400).
  - Tree subscriptions generate distinct watcher keys for workspace vs project.

### 3. Workspace Authority, File Identity & Mark/Unmark
- **File Identity Wire Shape (`server/src/workspace_target.rs:136-147`):**
  `{"workspaceId": "<string>", "workspaceEpoch": <u64>, "canonicalPath": "<canonical-path-string>"}`
- **Read / Stat Emissions:**
  - `GET /api/fs/read` (`server/src/api/fs.rs:356`): Emits header `x-file-identity: {"workspaceId":"...","workspaceEpoch":1,"canonicalPath":"..."}`. Binary response body emits JSON `{"binary": true, "mime": "...", "fileIdentity": {...}}`.
  - `GET /api/fs/stat` (`server/src/api/fs.rs:383`): Body returns `FileStat` with field `fileIdentity: FileIdentity`.
- **Mark Project (`server/src/api/config.rs:220-410`):**
  - Route: `POST /api/config/projects`
  - Body: `{"name": "<name>", "target": <FilesystemTargetRef>, "path": "<rel_path>", "projectType"?: "<string>", "tags"?: ["<str>"]}`
  - Under `workspace_context_guard.write()`, re-checks containment within target root, rejects duplicate name or canonical root (distinct nested roots allowed).
  - Response: 200 `{"ok": true, "name": "<name>"}`.
- **Unmark Project (`server/src/api/config.rs:412-452`):**
  - Route: `DELETE /api/config/projects/:name`
  - Response: 200 `{"ok": true}` (fails 404 `UNKNOWN_PROJECT` if absent).

### 4. Root Config & Global Settings Preservation
- **Endpoints (`server/src/api/config.rs:482,598`, `server/src/api/settings.rs:1-306`):**
  - `GET /api/global-config` / `POST /api/global-config/ui`
  - `GET /api/settings/export/workspace.toml` / `POST /api/settings/import/workspace.toml`
- **Nullable Shortcut Preservation (`server/src/config/global.rs:140-157, 245-265`):**
  - `KNOWN_SCALAR_SHORTCUT_KEYS` (12 keys) and `app_shortcuts.*`: when JSON value is `null`, converted to TOML empty string `""` before generic null dropping.
  - Unknown keys in `ui` table are preserved verbatim (`other => other` in `normalize_ui_json_for_toml`).
  - Terminal agent notifications: `version` must be 1 or 2 (`server/src/config/global.rs:43`), migrated to 2; unparseable versions fail closed.

### 5. Terminal Inventory, Create Epoch & Guarded Termination
- **Terminal Creation (`server/src/api/terminal.rs:224-232`):**
  - `POST /api/terminal`
  - Response Headers: `x-damhopper-termination-version: 1`, `x-damhopper-pty-epoch: <UUID>`, `cache-control: no-store`.
  - Response Body: `SessionMeta` (`server/src/pty/session.rs:100`), where `incarnation` is serialized as numeric JSON `u64`.
- **Terminal Inventory (`server/src/api/terminal.rs:356-410`):**
  - `GET /api/terminal` and `GET /api/terminal/detailed`
  - Response Headers: `x-damhopper-termination-version: 1`, `x-damhopper-pty-epoch: <UUID>`.
  - Response Body (`TerminalInventoryRowDto`): Flattened `SessionMeta` + `incarnationExact: String` (exact decimal u64 string) + `terminationState: "live" | "terminationRequested" | "restartPending" | "restartCancelled" | "exited" | "unavailable"`.
  - Wire DTO (`packages/ui/src/api/terminal-session-contract.ts:79`): `incarnationExact` guarantees 64-bit precision over JSON numbers.
- **Guarded Terminate / Restart Cancel (`server/src/api/terminal.rs:550-650`):**
  - Route: `POST /api/terminal/:id/terminate` (max 512 bytes)
  - Request Body:
    `{"version": 1, "expectedServerEpoch": "<canonical-lowercase-uuid>", "expectedIncarnation": "<canonical-positive-u64-string>"}`
  - Outcomes:
    - 202 Accepted: `{"version": 1, "serverEpoch": "<uuid>", "terminalId": "<id>", "incarnation": "<inc>", "outcome": "terminationRequested"}`
    - 200 OK: `{"version": 1, "serverEpoch": "<uuid>", "terminalId": "<id>", "incarnation": "<inc>", "outcome": "restartCancelled"}`
    - 409 Conflict: `TERMINATION_EPOCH_MISMATCH`, `TERMINATION_INCARNATION_MISMATCH`, `TERMINATION_NOT_LIVE`, `TERMINATION_ALREADY_REQUESTED`, `TERMINATION_REPLACEMENT_PENDING`, `TERMINATION_MANAGER_CLOSING`.
- **Legacy Routes & Unsafe Fallbacks:**
  - `DELETE /api/terminal/:id` (`server/src/api/terminal.rs:718`): kills session unconditionally, returns 204.
  - `DELETE /api/terminal/:id/remove` (`server/src/api/terminal.rs:730`): kills and evicts unconditionally, returns 204.
  - **Unsafe fallback:** Legacy DELETE routes lack epoch/incarnation fences. An Android caller using them risks race-killing recycled or respawned sessions. Web UI explicitly retired ambient `remove/kill` fallback in 261106-0334 review.

### 6. Notifications & Agent Status Baselines
- **Snapshot (`server/src/api/agent_status.rs:380`, `server/src/agent_status/types.rs:340`):**
  - `GET /api/agent-status/v1/snapshot`
  - Body: `{"version": 1, "serverEpoch": <u64>, "revision": <u64>, "availability": "ready"|"unavailable"|"platform-unqualified", "terminals": [...]}`
- **WebSocket Broadcast (`server/src/api/ws.rs:3583`, `server/src/agent_status/types.rs:375`):**
  - Pushed as text frames: `terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, `terminal:agentStatusInvalidated`.
  - `AgentAttentionEvent` (`server/src/agent_status/types.rs:315`): Formats deterministic attention ID `"{serverEpoch}:{terminalId}:{incarnation}:{attentionRevision}"`.

### 7. Version Probes Possible Without Mutation
1. **PTY Guarded Protocol Probe:** `GET /api/terminal` (or `/detailed`). Inspect headers: `x-damhopper-termination-version == "1"` and presence of `x-damhopper-pty-epoch`. Probes termination capabilities without creating or killing any session.
2. **Workspace Target Support Probe:** `GET /api/fs/stat?targetType=workspace&path=.`. If supported & configured: 200 with `fileIdentity`. If not configured: 403 `UNCONFIGURED_WORKSPACE_ROOT`. If legacy server: 400 `INVALID_FS_TARGET`.
3. **Agent Status Protocol Probe:** `GET /api/agent-status/v1/snapshot`. Inspect `version == 1` and `availability`. Zero side-effects.
4. **Global Config / Notification Version Probe:** `GET /api/global-config`. Returns current `ui.terminalAgentNotifications.version`.
5. **Daemon Health Probe:** `GET /api/health`. Returns 200 `{"schemaVersion": 1, "status": "ok"}`.

### 8. API Docs Mismatches
1. `POST /api/terminal` returns `SessionMeta` with numeric `incarnation` (not string `incarnationExact`), but includes `x-damhopper-pty-epoch` in HTTP headers. Android must pair the creation header epoch with numeric/inventory incarnation.
2. Old OpenAPI/client docs show `DELETE /api/terminal/:id` as primary close mechanism. The canonical OS lifecycle requires `POST /api/terminal/:id/terminate` with guarded tuple; DELETE is legacy un-fenced fallback.

### Unresolved Questions
- None. All wire contracts, header names, status codes, and error codes match verified source implementations.

**Completion Signal:** complete.