# API Reference

Base URL: `http://localhost:4800`

## Authentication

All requests require Bearer token in Authorization header:

```
Authorization: Bearer {token}
```

Token stored at `~/.config/dam-hopper/server-token`.

### Dev Mode (--no-auth)

The server supports a `--no-auth` authentication bypass mode for local development (Phase 01). When enabled:

- All protected routes bypass authentication checks
- The `/ws` terminal/event stream accepts connections without a token
- Login endpoint returns dev tokens without credential verification
- Status endpoint returns `dev_mode: true`
- See [Phase 01: Server-Side Auth Bypass](../phase-01-server-auth-bypass/) for details

**Safety**: This mode fails immediately if `MONGODB_URI` is set or `RUST_ENV=production` is detected.

### Auth Endpoints

**POST /api/auth/login**
Authenticate and receive auth token.

Body (normal mode):

```json
{ "username": "user", "password": "pass" }
```

Body (--no-auth mode):

```json
{}
```

Response:

```json
{
  "ok": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "dev_mode": false
}
```

**GET /api/auth/status**
Check authentication status.

Response (authenticated):

```json
{
  "authenticated": true,
  "user": "username",
  "dev_mode": false
}
```

Response (--no-auth mode):

```json
{
  "authenticated": true,
  "user": "dev-user",
  "dev_mode": true
}
```

**POST /api/auth/logout**
Clear authentication session.

Response: `{ "ok": true }`

## Frontend Diagnostics Snapshot (Phase 01)

Phase 01 adds a client-side diagnostics ring for local troubleshooting. It is written by the browser host before app render and stored in `localStorage` only.

**Storage key:** `damhopper_diagnostics_frontend_v1`

**Captured signals:**

- shared logger entries delivered through logger sink fanout
- browser `error` events
- browser `unhandledrejection` events
- React error boundary failures
- route changes
- WebSocket transport status changes

**Retention / cap behavior:**

- entries are kept in a bounded ring buffer
- old entries are dropped by age first, then by count
- storage usage is capped at a small fixed budget
- if browser storage is unavailable or full, capture degrades to memory-only best effort

This phase does not expose a backend export endpoint yet.

## Browser Debug Artifacts (Phase 2; Phase 6 hardened)

Authenticated, ephemeral storage for a browser-debug selection and optional screenshot. Artifacts are scoped to a live PTY terminal; no read or list endpoint exists.

**POST /api/browser-debug/artifacts**

Bearer token required. JSON body is limited to 64 KiB and uses camelCase:

```json
{
  "terminalId": "pty-uuid",
  "selection": {
    "version": 1, "tag": "button", "role": "button",
    "accessibleName": "Save", "text": "Save",
    "attributes": { "data-testid": "save" },
    "locator": "button[data-testid=save]",
    "bounds": { "x": 10, "y": 20, "width": 80, "height": 32 }
  }
}
```

`terminalId` must identify a live PTY. Selection structure and bounded fields are validated. Response: `201` with `artifactId`, `terminalId`, `expiresAt`, generated `jsonPath`, `jsonSize`, and `jsonSha256`.

**PUT /api/browser-debug/artifacts/{id}/png**

Bearer token required; `Content-Type: image/png`; body limited to 4 MiB. Structural PNG checks and decoded-image verification must both pass. Response adds generated `pngPath`, `pngSize`, and `pngSha256`. One PNG upload per artifact.

**DELETE /api/browser-debug/artifacts/{id}**

Bearer token required. Deletes files and returns `204 No Content`.

Artifacts expire after 10 minutes, are swept every 60 seconds, and are removed during graceful shutdown. Paths are generated under a temporary browser-debug root; files are not readable through this API.

**POST /api/browser-debug/artifacts/{id}/handoff**

Bearer token required. The artifact must be unexpired, not already claimed,
and its original PTY must still be alive. The server writes one bounded,
control-free reference containing only its generated JSON/PNG paths to that
PTY and returns `{ "inserted": true }`. This endpoint is one-time and does
not append a carriage return or submit the shell command. A failed write
releases the claim for retry; a concurrent or completed handoff returns
`409 Conflict`. Expired, unknown, deleted, or dead-terminal artifacts return
the existing safe not-found response.

### Browser tool host policy (Phase 3)

The UI Browser tool embeds a development target directly and uses the
DamHopper Browser Debug extension for DOM selection; the target app does not
need to install a package or script. The target URL must use HTTP `localhost`,
`127.0.0.1`, or `[::1]`, or an origin belonging to a tunnel whose status is
currently `ready`. Paths, query strings, and hashes are allowed inside that
approved origin; workspace-origin targets, credentials, unready tunnels, and
stale tunnel URLs are rejected before navigation. `X-Frame-Options` or restrictive
`Content-Security-Policy: frame-ancestors` can still prevent embedding.

The host keeps one iframe alive while Browser is moved between IDE, Terminal,
and compact surfaces. Extension messages are accepted only when their source,
exact target origin, nonce, and request ID match the current handshake; a
redirected or opaque-origin frame is rejected. A failed or timed-out handshake
keeps the iframe visible and presents a client-browser extension setup action.
The extension accepts the first handshake only from loopback DamHopper parents
or exact parent origins compiled with
`VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`; the presence marker is not an
authorization signal.

The native Tauri host uses the same Browser UI contract through a labeled child
WebView rather than the browser extension flow. Rust owns its lifecycle and
main-only commands, restricts targets to loopback or ready HTTPS tunnel origins,
and rejects stale relays using the child label, committed origin, navigation
generation, nonce, request ID, bounded schema, and message size. Native profile
storage is isolated below application data using a hash of the opaque server
profile ID; URLs, credentials, tokens, and workspace paths are not used as
storage identifiers. The native path does not require `chrome://extensions`
setup.

Screen capture is optional and remains browser-local until handoff. It requires
an explicit user gesture, accepts only a browser-tab surface, and stops tracks
when Browser closes or selection changes. Permission denial, unsupported capture,
wrong-surface selection, coordinate changes, or crop failure preserve the
semantic selection and offer manual image input instead.

## Backend Diagnostics Export (Phase 04)

Protected local export for backend diagnostics. The endpoint reads from the local JSONL store and does not upload data anywhere. The UI entry point is Settings > Maintenance > Export Diagnostics.

Request and response payloads use camelCase on the wire. The request accepts `frontend` and also the legacy `frontendSnapshot` alias.

**POST /api/diagnostics/export**

Auth: Bearer token required.

Default request body used by the UI:

```json
{
  "windowMinutes": 60,
  "includeTerminalOutput": true,
  "terminalTailBytes": 65536,
  "frontend": {
    "manifest": { "schemaVersion": 1 },
    "logs": [],
    "browserErrors": [],
    "currentRoute": null,
    "profile": null,
    "transportStatus": null
  }
}
```

Request fields:

- `windowMinutes` - requested lookback window; UI defaults to 60 minutes and the server clamps to 60 minutes max
- `includeTerminalOutput` - request terminal data in export; UI defaults to `true`
- `terminalTailBytes` - requested tail size; UI defaults to `65536`
- `terminalIds` - optional terminal session filter; `terminals.sessions` and `terminals.tails` are scoped to these ids when present
- `frontend` - canonical frontend snapshot payload from the browser export path
- `frontendSnapshot` - legacy alias accepted by the server for compatibility

Response schema version: `1`

Top-level response sections:

- `diagnosticSchemaVersion`
- `generatedAt`
- `scope`
- `manifest`
- `frontend`
- `backend`
- `terminals`
- `system`

`scope` fields:

- `windowMinutes`
- `includeTerminalOutput`
- `terminalTailBytes`
- `terminalIds`

`manifest` fields:

- `backendEventCount`
- `terminalSessionCount`
- `retentionMinutes`
- `storage` = `localConfigJsonl`
- `droppedPersistEvents`
- `persistErrorCount`

Notes:

- backend events are redacted before persist and export
- retention is 60 minutes
- storage path is `~/.config/dam-hopper/diagnostics/backend-log.jsonl`
- `terminals.tails` contains capped per-session tails when `includeTerminalOutput=true`
- downloads use the filename pattern `dam-hopper-diagnostics-{timestamp}.json`
- bundles are generated locally and downloaded by the browser; there is no server-side bundle archive
- terminal tails can still contain sensitive local/dev output even after best-effort redaction; review before sharing the exported JSON
- when `terminalIds` is provided, backend events with `sessionId` are scoped to those ids while global events remain included
- **Phase 04:** `system` field contains host metrics sampled from the config directory (`~/.config/dam-hopper/` by default) for host-context only, not project sandboxes

## Terminal Usage Analytics

Protected aggregate-only analytics for the local telemetry store. All routes require
the same Bearer token as other `/api/*` routes; raw command, prompt, output, and event
rows are never returned. The UI calls these through `WsTransport` methods
`usage:summary`, `usage:health`, `usage:settings`, `usage:setupStatus`,
`usage:updateSettings`, `usage:configure`, and `usage:deleteAll`, which map to the
REST routes below.

### GET /api/usage/summary

Returns terminal aggregates, optional Codex token aggregates, coverage, and writer
health. Query parameters use camelCase: `from`/`to` (UTC milliseconds) or `window`
(`24h`, `7d`, `30d`), `bucket` (`hour` or `day`), plus optional `project`, `shell`
(`bash`, `zsh`, `fish`), `captureQuality`, `category`, `agent` (`codex`), and `model`.
Ranges must be positive, contain at most 1,000 buckets, and are capped at 90 days for
hour buckets or five years for day buckets. Detail queries cannot precede the configured
detail-retention boundary unless they are UTC-day aligned, unfiltered day queries; the
response identifies the requested range and whether coverage is detail-only.

### GET /api/usage/health

Returns availability, paused state, writer error count, rejected event count, and the
sampling timestamp. Collector health includes bounded malformed, rejected, queued, dropped,
duplicate, compatibility-drift, and last-accepted counters. Unavailable telemetry is reported as
unavailable rather than as zero-valued usage.

### GET/PATCH /api/usage/settings

Reads or updates `paused`, `detailRetentionDays`, `aggregateRetentionDays` (nullable),
`excludedProjects`, and collector settings. `codexExporter: true|false` explicitly manages the
local Codex exporter. `collectorSetup.codexExporter` is status-only (`notConfigured`, `managed`,
or `conflict`); bearer material is never returned. Ownership must match exactly before a file is
changed or disabled; foreign/malformed config is left untouched. Writes are atomic and the
secret file is owner-only (`0600`). Retention changes synchronously roll up and purge before the
new configuration is published.

Updates are live: the server applies the validated runtime transition before writing its
configuration file. Telemetry enable/disable affects only terminal runs created after the
transition; a PTY keeps the capture snapshot selected when it started. Collector changes
restart the loopback listener without a DamHopper server restart. Managing Codex config does not
restart the Codex process; restart it separately. If runtime application or the subsequent config
write fails, the previous live state and managed Codex file are restored and the update is rejected.

### GET/PATCH /api/usage/setup

Returns the compact setup status used by Settings > Usage insights: telemetry enabled/paused
state, collector enabled state, runtime/receiver health, and optional local Codex exporter
status. `PATCH` accepts setup fields including `enabled`, `codexExporter`, and `retryCollector`.
It returns status only; bearer material is never returned. The Settings flow uses this route for
live enable/disable, receiver retry, and explicit Codex exporter management.

### DELETE /api/usage

Destructive deletion requires the exact JSON confirmation string
`"delete-usage-data"`. Omitting `from` and `to` deletes all detail, rollups, and health
rows. To delete a range, provide both `from` and `to` as non-negative UTC milliseconds,
strictly increasing and aligned to UTC-day boundaries; ranges are limited to five years.
Capture is paused behind an ordered deletion barrier and resumes according to the saved
pause setting. The UI must present an explicit confirmation before calling this route.

Full-delete HMAC-key rotation and its coordinated destructive workflow are part of the
implementation. The key is rotated only after all usage rows are deleted; range deletion keeps
the key so retained fingerprints remain comparable.

## Session Persistence API (Phase 05)

Terminal session buffers and metadata are persisted to SQLite when the configured database can be opened. This supports live cross-device resume and DamHopper server-restart relaunch with recovered scrollback; it does not preserve exact shell/process memory across server or host restart.

### Configuration

```toml
[server]
session_db_path = "~/.config/dam-hopper/sessions.db"       # Database path (supports ~)
session_buffer_ttl_hours = 720                       # 30-day retention (default)
```

### How Persistence Works

1. **Automatic**: When session is created, it's recorded to SQLite along with environment
2. **Batched**: Buffer snapshots sent every 16KB during output (throttled)
3. **Final snapshots**: Session exit and graceful server shutdown persist the latest buffer, including output under 16KB
4. **Recoverable**: Up to 1 MB of retained scrollback is replayed on attach
5. **Relaunched**: Sessions alive before DamHopper server shutdown are relaunched on restart

### Affected Endpoints

**GET /api/terminal/list** — Returns:

```json
[
  {
    "id": "uuid",
    "project": "project-name",
    "command": "npm run dev",
    "cwd": "/path",
    "alive": true,
    "exit_code": null,
    "buffer_bytes": 1048576,
    "persisted": true, // Phase 05: new field
    "started_at": 1234567890
  }
]
```

### Storage Details

**Database Schema** (Phase 05):

- `sessions` table — session metadata (id, project, command, env, cols, rows, restart_max_retries, created_at)
- `session_buffers` table — binary buffer data (session_id, data BLOB, total_written, updated_at)

**Storage Efficiency**:

- Batching: Only latest buffer per session written (intermediates discarded)
- Throttling: Every 16KB, not every read (99% fewer allocations)
- Memory: 16MB/sec churn (vs. 256MB/sec unoptimized)

### Worker Thread Architecture

- **Dedicated thread**: `persist-worker` daemon (see logs)
- **Bounded queue**: 256 slots (64MB max capacity)
- **Non-blocking sends**: Failed sends safe to drop (batching semantics)
- **Graceful shutdown**: all pending buffers flushed before process exit

### Monitoring

Track persistence health via logs:

```bash
# Enabled on startup
info: Session persistence enabled (path: ~/.config/dam-hopper/sessions.db)
info: Persist worker thread spawned

# Queue full (rare, indicates slow worker)
warn: Persist queue full, dropping BufferUpdate

# On session exit
info: Flushing session buffer on exit

# On shutdown
info: Persist worker stopped
```

See [Phase 05: Persist Worker](../phase-05-persist-worker/) for detailed architecture and design rationale.

## Git API

Git routes are scoped to the configured project name and run inside the resolved
project path.

When a project is not a Git repository, Git routes that require repository
state return HTTP `409` with the standard error body
`{"error":"Git is not initialized for this project","code":"GIT_NOT_INITIALIZED"}`.
The client preserves this as `ApiRequestError(status, code)` and uses the code
to render an actionable unavailable state; callers should not treat it as an
empty branch list.

### Branches

**GET /api/git/{project}/branches**
Returns local and remote branches.

Optional query: `root=ID` to scope branch data to one VCS root.

If Git is unavailable, this endpoint returns the `GIT_NOT_INITIALIZED` 409
error described above.

```json
[
  {
    "name": "main",
    "isCurrent": true,
    "isRemote": false,
    "trackingBranch": "origin/main",
    "ahead": 0,
    "behind": 0,
    "lastCommit": "abc123..."
  }
]
```

**GET /api/git/{project}/roots**
Discover VCS roots inside the project. Returns the primary repo root, nested repositories, and submodule gitlinks.

An unavailable project returns the same `GIT_NOT_INITIALIZED` 409 response;
usable nested roots are returned as concrete `rootId` values and can be passed
to branch and diff requests.

Response shape:

```json
[
  {
    "rootId": ".",
    "path": ".",
    "absolutePath": "/abs/path/to/project",
    "kind": "primary",
    "status": { "...": "GitStatus" },
    "warnings": []
  },
  {
    "rootId": "modules/child",
    "path": "modules/child",
    "absolutePath": "/abs/path/to/project/modules/child",
    "kind": "submodule",
    "mappingState": "mapped",
    "gitlink": {
      "path": "modules/child",
      "objectId": "abc123...",
      "moduleName": "child",
      "url": "../child.git"
    },
    "status": { "...": "GitStatus" },
    "warnings": []
  }
]
```

Fields:

- `kind` is `primary`, `submodule`, or `nestedRepo`.
- `mappingState` is only present for submodules and can be `mapped`, `unmapped`, `missing`, or `uninitialized`.
- `gitlink` is only present for submodules.
- `warnings` may include invalid `.gitmodules` or missing/uninitialized gitlink notes.
- `status` reflects the root's own Git status snapshot.

**POST /api/git/{project}/branches**
Create a branch. Set `checkout` to switch to it after creation.

```json
{
  "name": "feature/git-flow",
  "startPoint": "main",
  "checkout": true,
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/checkout**
Checkout an existing branch, or create one when `create` is true. `strategy` is
`normal`, `stash`, or `force`.

```json
{
  "branch": "feature/git-flow",
  "startPoint": "origin/main",
  "create": false,
  "strategy": "normal",
  "root": "modules/child"
}
```

**POST /api/git/{project}/branches/update**
Update a branch from its tracking branch.

```json
{ "branch": "main", "root": "modules/child" }
```

### History Actions

**POST /api/git/{project}/cherry-pick**
Apply a commit to the current branch.

```json
{ "hash": "abc123def456" }
```

**POST /api/git/{project}/reset**
Reset to a commit. `mode` is `soft`, `mixed`, `hard`, or `keep`.

```json
{ "hash": "abc123def456", "mode": "mixed" }
```

**POST /api/git/{project}/commit/{hash}/drop**
Drop a local, unpushed commit from the current branch history. `HEAD` drops use
`git reset --hard <parent>` after preflight checks. Non-HEAD drops use
`git rebase --onto <parent> <hash> <branch>`. Pushed/shared commits are blocked
by default and should use revert. The server refuses to start a rewrite while
a merge, rebase, or cherry-pick is already in progress and returns `recovery`
metadata for the active operation.

**GET /api/git/{project}/commit/{hash}/message**
Return the complete commit message, including its body. Use the optional
`root` query parameter to target a nested VCS root.

```json
{ "message": "Subject\n\nDetailed body" }
```

**POST /api/git/{project}/commit/{hash}/message**
Edit the message of any unpushed commit reachable from the checked-out branch.
The JSON body accepts `message` and optional `root`. Empty messages, dirty
worktrees, detached HEAD, active Git operations, unreachable commits, and
pushed commits are rejected. Editing `HEAD` amends it in place; editing an
older commit, including a root commit, rewrites that commit and replays its
descendants with merge topology preserved.

```json
{ "message": "New subject\n\nNew body", "root": "modules/child" }
```

**POST /api/git/{project}/commit/{hash}/drop-files**
Drop selected file changes from an unpushed commit while preserving other files
from that commit. This is a local-history rewrite and is blocked for pushed
commits by default.

```json
{ "paths": ["src/main.rs"] }
```

**POST /api/git/{project}/commit/{hash}/revert**
Create a new inverse commit with `git revert <hash>`. This is the default safe
operation for pushed or shared history because it preserves existing commits.

**POST /api/git/{project}/commit/{hash}/revert-files**
Apply the inverse patch for selected files to the working tree without rewriting
history. The resulting file changes are left in the worktree for review and
commit.

```json
{ "paths": ["src/main.rs"] }
```

Branch create, branch checkout, cherry-pick, reset, drop, and revert return
`GitActionResult`:

```json
{
  "ok": true,
  "message": "Checked out feature/git-flow",
  "branch": "feature/git-flow",
  "hash": "abc123def456",
  "stashed": false,
  "conflict": false,
  "dirty": false,
  "destructive": false,
  "recovery": null,
  "blockedReason": null,
  "recommendation": null
}
```

Result flags:

| Field            | Meaning                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`             | `true` when the Git action completed; `false` when Git reported a recoverable state.                                                                  |
| `message`        | Human-readable operation summary or recovery hint.                                                                                                    |
| `branch`         | Branch affected by branch create or checkout actions.                                                                                                 |
| `hash`           | Commit hash affected by cherry-pick or reset actions.                                                                                                 |
| `stashed`        | Checkout used `strategy: "stash"` and created a stash before switching branches.                                                                      |
| `conflict`       | Cherry-pick or reset reached a Git conflict state.                                                                                                    |
| `dirty`          | The operation was blocked by local working tree changes.                                                                                              |
| `destructive`    | The selected mode can discard local state, such as force checkout or hard reset.                                                                      |
| `recovery`       | Active operation metadata when recovery commands are available.                                                                                       |
| `blockedReason`  | Machine-readable block reason such as `active-operation`, `dirty-worktree`, `detached-head`, `pushed-commit`, `unreachable-commit`, or `root-commit`. |
| `recommendation` | User-facing next action for blocked or recoverable operations.                                                                                        |

Recoverable dirty checkout example:

```json
{
  "ok": false,
  "message": "Working tree has local changes",
  "branch": "feature/git-flow",
  "stashed": false,
  "conflict": false,
  "dirty": true,
  "destructive": false
}
```

Blocked pushed-history drop example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

Recoverable rebase conflict example:

```json
{
  "ok": false,
  "message": "CONFLICT (content): Merge conflict in README.md",
  "hash": "abc123def456",
  "conflict": true,
  "dirty": true,
  "destructive": true,
  "recovery": {
    "operation": "rebase",
    "canAbort": true,
    "canContinue": true
  },
  "recommendation": "resolve rebase conflicts, then continue or abort"
}
```

Branch update returns `BranchUpdateResult`:

```json
{
  "branch": "feature/git-flow",
  "success": true,
  "reason": null
}
```

Checked-out branch update guard example:

```json
{
  "branch": "main",
  "success": false,
  "reason": "checked-out — use pull instead"
}
```

Invalid branch names, relative paths, and commit hashes are rejected before Git
execution. Rewrite operations preflight active merge/rebase/cherry-pick state,
dirty worktree state, commit reachability, root commits, and pushed/shared
history. Safe operations such as revert remain available for shared history,
while blocked or conflicted operations return structured result flags so clients
can show recovery choices instead of treating every non-clean operation as an
unclassified error. Validation failures use the standard API error shape with a
400 status for invalid input:

```json
{ "error": "Invalid input: invalid branch name" }
```

### Git History Safety Contract

DamHopper follows IntelliJ-style Git semantics: safe operations preserve shared
history, while rewrite operations are restricted to local commits that have not
been pushed upstream. Recovery states are surfaced explicitly so the UI can
offer continue/abort guidance instead of hiding active Git porcelain state.
DamHopper does not expose a published-history rewrite override through `drop`,
`drop-files`, `message`, or `undo-last-commit`. The dedicated push flow only
publishes an already-rewritten branch intentionally: `POST /api/git/push` with
`force: true` updates the configured upstream branch, but it does not relax the
pushed/shared history guards on those local rewrite endpoints.

| Operation          | History effect       | Shared-history behavior                                  |
| ------------------ | -------------------- | -------------------------------------------------------- |
| `revert`           | Adds inverse commit  | Allowed and recommended                                  |
| `revert-files`     | Worktree inverse     | Allowed; selected changes stay uncommitted for review    |
| `drop`             | Rewrites branch      | Blocked for pushed/shared commits; use revert instead    |
| `drop-files`       | Rewrites branch      | Blocked for pushed/shared commits; use revert instead    |
| `message`          | Rewrites commit      | Blocked for pushed/shared commits                        |
| `undo-last-commit` | Rewrites local HEAD  | Blocked for pushed/shared commits; use revert instead    |
| `reset --hard`     | Rewrites local state | Allowed only after explicit request and preflight checks |

Manual verification checklist for browser integrations:

- Modify an open file and discard it from the Git panel; the browser must not
  reload, and the affected editor tab should reconcile with disk.
- Drop a selected file change from an old local commit; branch history and the
  affected file diff should refresh without a full app reset.
- Drop a local non-HEAD commit with descendants; descendants should replay or
  produce a recoverable rebase state.
- Revert a pushed commit in a clone/remote test repo; the UI should route users
  to revert instead of enabling drop.
- Start a conflicting rebase or cherry-pick, then attempt a rewrite; the API
  should return `blockedReason: "active-operation"` and recovery metadata.
- Verify the recovery banner copy in the UI by triggering an active-operation
  block; the banner should mention the active operation and tell the user to
  resolve, continue, or abort.

### Commit

**POST /api/git/{project}/commit**
Create a commit from the index. Set `amend` to replace the current `HEAD`
commit.

```json
{ "message": "Update git controls", "amend": false }
```

Response:

```json
{ "ok": true, "hash": "abc123def456" }
```

### Undo Last Commit

**POST /api/git/{project}/undo-last-commit**
Undo the most recent local commit with `git reset --mixed HEAD~1`. The backend
blocks pushed/shared commits and returns a revert recommendation instead of
rewriting public history. Changes from the undone commit remain as unstaged
local changes.

Response shape follows `GitActionResult`:

```json
{
  "ok": true,
  "message": "Undid last commit abc123d",
  "hash": "abc123def456",
  "conflict": false,
  "dirty": true,
  "destructive": true,
  "recommendation": "changes from the undone commit are now unstaged"
}
```

Blocked pushed-history example:

```json
{
  "ok": false,
  "message": "commit abc123def456 is already reachable from upstream",
  "hash": "abc123def456",
  "conflict": false,
  "destructive": false,
  "blockedReason": "pushed-commit",
  "recommendation": "use revert for pushed/shared history"
}
```

## Reconnection Flow (Phase A feature)

**Location:** `packages/web/src/api/transport.ts`

The `Transport` interface abstracts WebSocket and REST communication. All frontend modules use `getTransport()` to access the singleton instance.

### Core Methods

**invoke<T>(channel: string, data?: unknown): Promise<T>**
Request/response messaging mapped to REST endpoints.

Example:

```ts
const sessions = await transport.invoke<Array<{ id: string }>>("terminal:list");
const newSession = await transport.invoke<{ id: string }>("terminal:create", {
  project: "api-server",
  command: "npm run dev",
  cols: 80,
  rows: 24,
});
```

### Terminal Subscriptions

**onTerminalData(id: string, cb: (data: string) => void): () => void**
Subscribe to PTY output stream. Callback receives chunks of terminal data (plain text or ANSI codes).

Returns unsubscribe function.

**onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void**
Subscribe to basic PTY exit event.

Returns unsubscribe function.

**onTerminalExitEnhanced?(id: string, cb: (exit: {...}) => void): () => void** (Optional, Phase 5+)
Subscribe to enhanced exit event with restart metadata.

Callback receives:

```ts
{
  exitCode: number | null;
  willRestart: boolean;
  restartIn?: number;       // milliseconds
  restartCount?: number;
}
```

Returns unsubscribe function.

**onProcessRestarted?(id: string, cb: (restart: {...}) => void): () => void** (Optional, Phase 5+)
Subscribe to process restart event.

Callback receives:

```ts
{
  restartCount: number;
  previousExitCode: number | null;
}
```

Returns unsubscribe function.

### Session Attachment (Phase 3)

**terminalAttach?(id: string, fromOffset?: number): void** (Optional)
Fire-and-forget message to request buffer replay from server.

- `id` — Session UUID
- `fromOffset` — Optional byte offset for delta sync (omit for full buffer)

Must call `onTerminalBuffer()` listener BEFORE sending attach request to receive response.

Example:

```ts
// Setup listener first
transport.onTerminalBuffer(sessionId, ({ data, offset }) => {
  term.write(data); // Replay buffered content
  storeOffset(offset); // Save offset for next attach
});

// Then send attach
transport.terminalAttach(sessionId, lastKnownOffset);
```

**onTerminalBuffer?(id: string, cb: (buffer: {data: string; offset: number}) => void): () => void** (Optional, Phase 3+)
Subscribe to buffer replay response from `terminal:attach` request.

Callback receives:

```ts
{
  data: string; // Base64-encoded terminal content
  offset: number; // Current byte offset (incremental counter)
}
```

Use case: On reconnect, request buffered terminal output to show user previous session content.

Returns unsubscribe function.

### Terminal Control

**terminalWrite(id: string, data: string): void**
Fire-and-forget message to send input to PTY stdin.

**terminalResize(id: string, cols: number, rows: number): void**
Fire-and-forget message to resize PTY dimensions.

### Event Subscriptions

**onEvent(channel: string, cb: (payload: unknown) => void): () => void**
Subscribe to push events (git:progress, workspace:changed, etc.).

Returns unsubscribe function.

**onStatusChange?(cb: (status: string) => void): () => void** (Optional)
Subscribe to WebSocket connection status changes.

Status values: `"connecting"`, `"connected"`, `"disconnected"`, `"error"`

Returns unsubscribe function.

## REST Endpoints

### Projects

**GET /api/projects**
List all projects in workspace.

Response: `{ projects: [ { name, path, type } ] }`

### Terminals

**POST /api/pty/spawn**
Create new PTY session (idempotent as of Phase 07).

Body: `{ project, profile, env_overrides? }`

Response: `{ sessionId: uuid }`

**Idempotency Guarantees (Phase 07):**

- Calling create with the same `sessionId` during restart backoff will immediately spawn a fresh session
- Any pending supervisor respawn for that ID is automatically cancelled (killed set flag)
- Dead session tombstones are cleaned up automatically
- No need for client-side alive status filtering—safe to retry without state checks
- Lock released before slow I/O (openpty, spawn), reacquired with TOCTOU guard to detect concurrent creates

**GET /api/pty/:sessionId**
Stream PTY output (Server-Sent Events).

**POST /api/pty/:sessionId/send**
Send input to running PTY.

Body: `{ input: string }`

**GET /api/pty/:sessionId/resize**
Resize terminal.

Body: `{ cols: number, rows: number }`

**POST /api/pty/:sessionId/kill**
Gracefully terminate session (SIGTERM, then SIGKILL if needed).

Response: `{ ok: true }`

**POST /api/pty/:sessionId/remove**
Immediately evict session without restart (cancels pending auto-restart).

Response: `{ ok: true }`

### Git Operations

**GET /api/git/:project/status**
Repository status.

Response: `{ branch, ahead, behind, modified: [], untracked: [] }`

**POST /api/git/:project/clone**
Clone a repository.

Body: `{ url: string, recursive?: bool }`

**POST /api/git/push**
Push commits.

Route: `/api/git/push`

Body: `{ project: string, root?: string, force?: boolean }`

Client behavior:

- Project-level pushes now use a root-aware contract in the UI. The project root still calls `api.git.push(project)`, while a selected child root calls `api.git.push(project, root)`.
- ProjectInfoPanel, WorkspaceGitPanel, and GitPage each expose both `Push` and `Force Push` actions. The destructive button confirms first, then sends the same root-aware payload with `force: true`.
- The shared SSH retry flow normalizes a single Git result or an array of results before checking for auth failures, so push retries follow the same path as fetch and pull.
- Successful push operations now surface a shared status banner as well, so plain push, force push, and push-after-passphrase-retry all confirm completion in the UI.
- Non-auth push failures now surface through the same shared status banner path, so non-fast-forward rejections are visible instead of disappearing behind an HTTP 200 response.
- Successful pushes now invalidate the broader Git cache set on the client: branches, git log, project status, diff, conflicts, file-tree, and project list data refresh together instead of only the push caller.
- The Git page now uses the same root-aware push path for single-project views, so a selected root is preserved consistently across page-level and sidebar-level push actions.
- The SSH passphrase retry dialog can retry immediately or save the passphrase for later when the server and OS keyring support it.
- Retry status messages are rendered through a shared frontend status model, so push/fetch/pull retries report the same wording and state handling.
- The backend push path uses libgit2 `Remote::push(...)` with the same credential callback order as fetch/pull: loaded key, SSH agent, credential helper, then default credentials.
- Push scope is intentionally narrow: the checked-out branch is pushed to its configured upstream only. If `branch.<name>.remote` or `branch.<name>.merge` is missing, the route returns a clear push error instead of inferring a destination. Setting `force: true` changes only the refspec mode; it does not broaden destination inference.
- See `ProjectInfoPanel.test.ts` and `use-git-with-ssh-retry.test.ts` for the root-selection and retry normalization coverage added in this phase.

### SSH Credential APIs

**POST /api/ssh/keys/load**
Load an SSH private key into the current DamHopper server session.

Body: `{ keyPath?: string, passphrase?: string, saveForLater?: bool }`

Response: `{ success: bool, saved: bool, keyPath?: string, error?: string }`

Notes:

- `saveForLater=true` attempts to persist the passphrase in the host OS credential store.
- `saved=true` means a saved credential is available for that workspace/key after the call completes. It can mean the current request persisted it, or that one already existed when the key was loaded session-only.
- Validation happens before persistence, so a wrong passphrase does not create or update a saved credential.
- When persistence is unavailable, the key still loads for the current server session and `error` explains why the save step was skipped.
- Responses never include the passphrase.
- The loaded credential feeds the shared libgit2 fetch/pull/push callback path; it is not passed to a CLI askpass helper.

**GET /api/ssh/credentials**
Return saved-credential metadata for one SSH key.

Query: `keyPath=basename`

Response: `{ saved: bool, keyPath?: string, error?: string }`

**DELETE /api/ssh/credentials**
Forget the saved credential for one SSH key and clear the in-memory session credential when it matches.

Query: `keyPath=basename`

Response: `{ success: bool, forgotten: bool, error?: string }`

**GET /api/git/:project/branches**
List local and remote branches.

**POST /api/git/:project/branches**
Create a branch.

Body: `{ name: string, startPoint?: string, checkout?: bool }`

**POST /api/git/:project/branches/checkout**
Checkout a branch.

Body: `{ branch: string, startPoint?: string, create?: bool, strategy?: "normal"|"stash"|"force" }`

**POST /api/git/:project/branches/update**
Update a branch from its remote tracking branch.

Body: `{ branch?: string }`

**POST /api/git/:project/cherry-pick**
Cherry-pick a commit.

Body: `{ hash: string }`

**POST /api/git/:project/reset**
Reset the current branch to a commit.

Body: `{ hash: string, mode: "soft"|"mixed"|"hard"|"keep" }`

### Git Diff & Change Management (Phase 01)

**GET /api/git/:project/diff**
List changed files (staged + unstaged).

Optional query: `root=ID` to scope results to one VCS root. When no root is
supplied, the backend resolves the deepest matching root for the requested
paths and rejects mixed-root operations.

Use `root=*` for the read-only aggregate local-changes view. Aggregate entries
include `rootId` and `rootPath`; mutation endpoints reject aggregate roots and
must be called with one concrete root.

Response:

```json
{
  "entries": [
    {
      "path": "src/main.rs",
      "status": "modified|added|deleted|renamed|copied|conflicted",
      "staged": false,
      "additions": 5,
      "deletions": 2,
      "oldPath": "src/old.rs",
      "rootId": ".",
      "rootPath": ".",
      "submodule": {
        "path": "modules/child",
        "objectId": "abc123...",
        "moduleName": "child",
        "url": "../child.git"
      }
    }
  ]
}
```

The typed client result is either a normal response with `gitAvailable: true`
or an unavailable result:

```json
{
  "gitAvailable": false,
  "code": "GIT_NOT_INITIALIZED",
  "entries": [],
  "untrackedTruncated": false,
  "untrackedTotal": 0
}
```

This preserves a successful, typed empty state for the local-changes panel
while branch/root requests continue to surface the 409 error for shared
unavailable-state handling.

`rootId`, `rootPath`, and `submodule` are omitted when the entry is not tied to
an explicit VCS root or submodule gitlink.

**GET /api/git/:project/diff/file?path=REL**
File diff content with hunks (HEAD vs working directory).

Optional query: `root=ID` for root-scoped file diff resolution.

Response:

```json
{
  "path": "src/main.rs",
  "original": "...",
  "modified": "...",
  "language": "rust",
  "hunks": [
    {
      "index": 0,
      "oldStart": 10,
      "oldLines": 5,
      "newStart": 10,
      "newLines": 7,
      "header": "@@ -10,5 +10,7 @@"
    }
  ],
  "isBinary": false
}
```

**POST /api/git/:project/stage**
Stage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file.

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID` for root-scoped conflict discovery.

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`

**POST /api/git/:project/commit**
Create a commit from staged files.

Body: `{ message: string, amend?: bool, root?: string }`

## Client-Side Profile Management (Phase 2)

Profile management lives entirely in the browser via **localStorage** — no server endpoints required.

### Data Model

```typescript
export interface ServerProfile {
  id: string; // UUID v4
  name: string; // "Local Dev", "Production", etc.
  url: string; // "http://localhost:4800"
  authType: "basic" | "none"; // Authentication method
  username?: string; // For basic auth display (password never stored)
  createdAt: number; // Unix timestamp
}
```

### API Functions

All functions in `packages/web/src/api/server-config.ts`.

**Profile Getters:**

- `getProfiles(): ServerProfile[]` — fetch all profiles
- `getActiveProfileId(): string | null` — currently selected profile ID
- `getActiveProfile(): ServerProfile | null` — currently selected profile object

**Profile Management:**

- `createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile` — add new profile, auto-generates UUID and timestamp
- `updateProfile(id: string, data: Partial<...>): void` — modify profile fields
- `deleteProfile(id: string): void` — remove profile (clears active if deleted)
- `setActiveProfile(id: string): void` — switch active profile

**Persistence:**

- `getProfiles() / saveProfiles(profiles: ServerProfile[]): void` — localStorage key: `damhopper_server_profiles`
- Active profile ID stored in `damhopper_active_profile_id`

**Migration:**

- `migrateToProfiles(): void` — (called in `App.tsx`) converts legacy single-server config to profile system on first app load
  - if profiles already exist → no-op
  - if legacy `damhopper_server_url` exists → creates "Default Server" profile and sets active

### Storage Breakdown

| Key                           | Storage        | Scope             | Persistence            |
| ----------------------------- | -------------- | ----------------- | ---------------------- |
| `damhopper_server_profiles`   | localStorage   | Shared (all tabs) | Survives browser close |
| `damhopper_active_profile_id` | localStorage   | Shared (all tabs) | Survives browser close |
| `damhopper_auth_token`        | sessionStorage | Per-tab           | Cleared on tab close   |
| `damhopper_auth_username`     | sessionStorage | Per-tab           | Cleared on tab close   |

**POST /api/git/:project/stage**
Stage files for commit.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/unstage**
Unstage files.

Body: `{ paths: string[], root?: string }`

**POST /api/git/:project/discard**
Discard changes to file (restore from HEAD).

Body: `{ path: string, root?: string }`

**POST /api/git/:project/discard-hunk**
Discard single hunk from file.

Body: `{ path: string, hunkIndex: number, root?: string }`

**GET /api/git/:project/conflicts**
List conflicted files with 3-way merge content.

Optional query: `root=ID`.

Response:

```json
{
  "conflicts": [
    {
      "path": "src/conflict.rs",
      "ancestor": "...",
      "ours": "...",
      "theirs": "..."
    }
  ]
}
```

**POST /api/git/:project/resolve**
Resolve merge conflict.

Body: `{ path: string, content: string, root?: string }`

### IDE File Explorer

**GET /api/fs/list?project=NAME&path=REL**
List directory contents.

Response:

```json
{
  "entries": [
    {
      "name": "file.ts",
      "kind": "file",
      "size": 1024,
      "mtime": 1712577600,
      "isSymlink": false
    }
  ]
}
```

**GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]**
Read file content (text or binary detection).

- Text: returns body with Content-Type: text/\*
- Binary: returns `{ binary: true, mime: "..." }`
- Max 10MB per read

**GET /api/fs/stat?project=NAME&path=REL**
File metadata.

Response:

```json
{
  "kind": "file",
  "size": 1024,
  "mtime": 1712577600,
  "mime": "text/typescript",
  "isBinary": false
}
```

**Error Responses:**

- 400: Invalid path (outside sandbox)
- 404: Project/path not found

### Agent Store

**GET /api/agent-store/distribution**
Shows which projects have which skills/commands.

**POST /api/agent-store/import**
Import `.claude/` items from remote repo.

Body: `{ repoUrl: string }`

**POST /api/agent-store/ship**
Create symlinks to distribute items.

Body: `{ items: string[], projects: string[] }`

### Workspace Management

**GET /api/workspace/status**
Current workspace status. Returns `configPath` (authoritative registry file location) and `path` (legacy config directory).

Response:

```json
{
  "ready": true,
  "path": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "name": "my-workspace",
  "projectCount": 5
}
```

**GET /api/workspace**
Detailed workspace info. Returns both `root` (legacy display field) and `configPath` (authoritative registry location).

Response:

```json
{
  "name": "my-workspace",
  "root": "/home/user/.config/dam-hopper",
  "configPath": "/home/user/.config/dam-hopper/dam-hopper.toml",
  "projectCount": 5
}
```

**POST /api/workspace/switch**
Change active workspace. Accepts either a directory path or a direct path to a `dam-hopper.toml` file.

Request body:

```json
{ "path": "/path/to/workspace-dir-or-config.toml" }
```

On switch:
- Configuration is reloaded from the specified path
- File API sandbox is reinitialized from project roots in the new config
- All PTY sessions are disposed
- Event: `workspace:changed` is broadcast to all clients

Response: `{ "ok": true }`

**POST /api/workspace/init**
Initialize a workspace in a directory. Discovers projects or creates an empty config.

Request body:

```json
{ "path": "/path/to/new-workspace" }
```

Response: `{ "ok": true }`

### Settings & Health

**GET /api/health** (public, no auth required)
Server health + feature flags.

Response:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "features": {}
}
```

## WebSocket Endpoint

**WebSocket /ws**

Auth: append `?token={bearer_token}` to URL.

Protocol: JSON frames. Client sends commands via `{kind:}` envelope, server broadcasts events.

**Message Format (all client→server or server→client):**

```json
{ "kind": "terminal:write", "id": "uuid", "data": "..." }
```

**Terminal Messages:**

- `{ kind: "terminal:spawn", project, profile, env_overrides? }` → server responds with `{ kind: "terminal:spawned", id, ... }`
- `{ kind: "terminal:write", id, data }` — send input
- `{ kind: "terminal:attach", id, from_offset? }` — request buffer replay (Phase 02+); server responds with `{ kind: "terminal:buffer", id, data, offset, reset, truncated }`
  - `from_offset` (optional) — client's last received byte offset for delta sync
  - Server sends full buffer with `reset=true` if `from_offset` is omitted
  - Server sends full buffer with `reset=true` and `truncated=true` if `from_offset` is too old (evicted)
  - Server sends a delta with `reset=false` when the requested offset is retained
  - Server sends empty `data` if `from_offset` equals current offset (no new content)
  - Error case: session not found → no response; client should timeout and create new session
- `{ kind: "terminal:kill", id }` — terminate session
- `{ kind: "terminal:output", id, chunk }` — server pushes PTY output
- `{ kind: "terminal:buffer", id, data, offset, reset, truncated }` — server response to `terminal:attach` with buffer content, current offset, and replay instructions
- `{ kind: "terminal:exited", id, code }` — session ended

**File Tree Subscription (Phase 03):**

- `{ kind: "fs:subscribe_tree", req_id, project, path }` — start watching directory tree; server responds with `{ kind: "fs:tree_snapshot", sub_id, nodes: [...] }`
- `{ kind: "fs:unsubscribe_tree", sub_id }` — stop watching
- `{ kind: "fs:event", sub_id, event: { kind, path, from? } }` — server pushes FS changes (created|modified|deleted|renamed)

**File Read (Phase 04):**

- `{ kind: "fs:read", req_id, project, path, offset?, len? }` — read file content with optional range
  - Supports large files via offset+len (range reads)
  - Server responds: `{ kind: "fs:read_result", req_id, ok, binary, mime?, mtime?, size?, data?, code? }`
  - `data` is base64-encoded content (text or binary), max 100MB
  - If `ok=false` and `code="TOO_LARGE"`: file exceeds cap; use range reads (LargeFileViewer)

**File Write (Phase 04):**

- `{ kind: "fs:write_begin", req_id, project, path, expected_mtime, size }` — initiate write
  - Server responds: `{ kind: "fs:write_ack", req_id, write_id }`
  - `expected_mtime` (Unix seconds) guards against concurrent modification; server rejects if stale
- `{ kind: "fs:write_chunk", write_id, seq, eof, data }` — send base64 chunk
  - Server acks each: `{ kind: "fs:write_chunk_ack", write_id, seq }`
- `{ kind: "fs:write_commit", write_id }` — finalize write
  - Server responds: `{ kind: "fs:write_result", write_id, ok, new_mtime?, conflict, error? }`
  - `conflict=true` if server detected mtime mismatch; client shows ConflictDialog (overwrite or reload)
  - `new_mtime` sent on success for next save guard

**Git Events:**

- Server broadcasts `{ kind: "git:progress", project, step, percent }` during clone/push/pull

All responses include context fields matching the request (e.g., `req_id` echoed back for fs:subscribe_tree).
