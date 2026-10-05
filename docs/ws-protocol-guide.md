# WebSocket Protocol Guide

Real-time message envelope for terminal I/O, file watching, and file operations.

## Message Format

All messages use JSON with the `kind` tag. The legacy `type` envelope is not supported.

```json
{ "kind": "command:action", ...payload }
```

**Direction:** Bidirectional (client↔server).

## Retired plugin epoch protocol

The historical D03 trusted-plugin platform used socket epochs and messages such
as `plugin:get_epoch` and `plugin:epoch`. That platform is retired: current
WebSocket and REST transports do not support plugin epochs, plugin context
leases, or plugin routes. Do not build integrations against the old protocol.

See the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md)
for historical design notes and the [API reference retirement notice](./api-reference.md#retired-plugin-api-anchors).

## Project target context

REST requests that operate on project files, Git state, editor/diff data, or
media carry the explicit `ProjectTargetRef` fields documented in the [API
reference](./api-reference.md#project-worktree-targets). The browser
stores one selected target per project; the server does not keep a global
active target. A missing or prunable worktree is unavailable for new target
operations and must be refreshed or reconnected before it can be selected
again.

The current application creates terminals through the REST transport channel
`terminal:create` (`POST /api/terminal`). It accepts an optional
`worktreePath`; the server resolves that path against a fresh registered
worktree snapshot, validates the cwd inside the resolved target, and records
the canonical target in returned and persisted session metadata. Build, run,
custom-command, and profile session IDs use a stable opaque target
discriminator, while the canonical path remains in session metadata. Older
WebSocket terminal messages below are still project/session scoped; legacy
sessions without target metadata use their `project` and `cwd` for orphan
detection.
For target-scoped sessions, the immutable server-validated `worktreePath`
marker is authoritative; cwd containment is a legacy fallback only.

### Current terminal REST transport

```json
{
  "project": "demo",
  "cwd": ".",
  "worktreePath": "/worktrees/demo-feature",
  "command": "npm run dev",
  "cols": 80,
  "rows": 24
}
```

`worktreePath` is optional and must identify a registered, available worktree
for the project. A relative `cwd` is resolved beneath that target; an absolute
cwd must remain inside it. Removal and terminal creation share the server's
workspace lifecycle guard, so a target cannot be removed while a target-scoped
terminal is being created or is live.

## Client→Server Messages

### Terminal messages

| Command           | Payload                            | Response                                                 |
| ----------------- | ---------------------------------- | -------------------------------------------------------- |
| `terminal:write`  | `id, data`                         | (no response; server queues)                             |
| `terminal:resize` | `id, cols, rows`                   | (ACK implicit)                                           |
| `terminal:attach` | `id, from_offset?`                 | `terminal:buffer { id, data, offset, reset, truncated }` |

#### Terminal Attach

Request buffer replay from a session (for reconnection or delta sync):

**Request:**

```json
{
  "kind": "terminal:attach",
  "id": "uuid",
  "from_offset": 4096
}
```

**Fields:**

- `id` — Session UUID to attach to
- `from_offset` — Optional. Client's last received byte offset. If omitted or greater than current offset, returns full buffer. If older than buffer start (evicted), returns full buffer as fallback.

**Response on success:**

```json
{
  "kind": "terminal:buffer",
  "id": "uuid",
  "data": "terminal output text",
  "offset": 5120,
  "incarnation": 12345,
  "reset": false,
  "truncated": false
}
```

**Fields:**

- `id` — Echo of request session ID
- `incarnation` — PTY instance identity. Offsets are comparable only within the same incarnation; a newer incarnation requires a full attach and emulator reset. Ignore stale-incarnation output and replay.
- `data` — UTF-8 terminal text, not base64. Delta when `reset=false`; retained history when `reset=true`.
- `offset` — Authoritative end byte position in the decoded, lifecycle-filtered UTF-8 stream. Incomplete UTF-8 scalars are held before retention and broadcast; offsets restart at zero for a replacement PTY.
- `reset` — Drain pending parser writes, reset the terminal emulator, then write `data` when true. Preserve emulator state for a contiguous delta when false.
- `truncated` — Older history was evicted from the retained 1 MiB tail. Full attaches also report truncation; the tail is not a complete terminal-state snapshot.

**Error behavior:** If session not found, server logs warning and sends no response. A missing response is not itself proof that a session is dead: the client checks `terminal:listDetailed` before creating a replacement.

On reconnect, request a delta from the last accepted authoritative offset. Replay parsing must not send historical terminal-query responses to the live PTY. A truncated raw tail cannot reconstruct missing screen, cursor, or mode state; applications may need a fresh redraw.

#### Frontend Reconnect UI

**Attach Workflow:**

1. TerminalPanel mounts or WebSocket reconnects
2. Frontend queries `terminal:list` to check if session exists
3. If session found → call `terminalAttach()` without `from_offset` (initial attach) or with stored offset (delta attach)
4. Register `onTerminalBuffer()` listener BEFORE sending attach request
5. On buffer response → clear xterm only when `reset=true`; otherwise append the delta
6. If no buffer response arrives within 3 seconds, check `terminal:listDetailed`:
   - an alive session is retried by the same panel, one attach at a time, using capped exponential backoff;
   - a missing/dead session is created once, then attached again.
7. The panel cancels pending retries when it receives a buffer, disconnects, or unmounts.

**TerminalPanel xterm integration:**

- Terminal output/activity observation remains frontend-only and does not define semantic agent state. DamHopper's Codex OSC 9 parser, notification handler, and terminal attach callbacks are removed.
- Agent status and attention arrive separately through the protected snapshot and authenticated `terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, and `terminal:agentStatusInvalidated` events; see the [agent-status architecture](./architecture/agent-status.md).

**UI States:**

- `idle` — Ready for attach
- `attaching` — Waiting for buffer response; show spinner overlay with "Reconnecting…"
- `attached` — Buffer received/session created; hide overlay and resume output streaming
- `creating` — Creating a replacement only after the session is confirmed missing/dead, or when no existing session was found during initialization

**Overlay:**

- Rendered when `attachState === "attaching"`
- Semi-transparent dark backdrop (`bg-slate-900/50`) with blur
- Animated spinner with "Reconnecting…" text
- Auto-dismisses on buffer response; transient timeouts stay in recovery and retry without creating duplicate sessions

### File System — Subscribe

| Command               | Payload                 | Response                                     |
| --------------------- | ----------------------- | -------------------------------------------- |
| `fs:subscribe_tree`   | `req_id, project, path` | `fs:tree_snapshot { req_id, sub_id, nodes }` |
| `fs:unsubscribe_tree` | `sub_id`                | (no response)                                |

Afterward, server pushes: `fs:event { sub_id, event: { kind, path, from? } }` on change.

### File System — Read

| Command   | Payload                                | Response                                                                    |
| --------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `fs:read` | `req_id, project, path, offset?, len?` | `fs:read_result { req_id, ok, binary, mime?, mtime?, size?, data?, code? }` |

- `offset, len` optional (range reads for large files)
- `data` is base64 (text or binary)
- If `ok=false`, check `code` (e.g., "NOT_FOUND", "TOO_LARGE")

### File System — Write

Binary streaming support added for large file handling.

| Command                 | Payload                                                  | Response                                                         |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `fs:write_begin`        | `req_id, project, path, expected_mtime, size, encoding?` | `fs:write_ack { req_id, write_id }`                              |
| `fs:write_chunk`        | `write_id, seq, eof, data`                               | `fs:write_chunk_ack { write_id, seq }`                           |
| `fs:write_chunk_binary` | `write_id, seq, eof, size` (follows raw binary)          | `fs:write_chunk_ack { write_id, seq }`                           |
| `fs:write_commit`       | `write_id`                                               | `fs:write_result { write_id, ok, new_mtime?, conflict, error? }` |

**Protocol Flow:**

1. `fs:write_begin`: Initializes session. `encoding` ("base64" | "binary") defaults to base64.
2. **Chunking**:
   - If `encoding="base64"`: Send `fs:write_chunk` with base64-encoded `data`.
   - If `encoding="binary"`: Send `fs:write_chunk_binary` header, followed by the raw binary frame.
3. `fs:write_commit`: Finalizes.

**Key details:**

- `expected_mtime`: Guards against concurrent modifications (Optimistic Concurrency Control).
- `size`: Total bytes declared; must match exactly at commit time.
- On conflict: `conflict=true`, client must retry with fresh mtime.
- Orphaned writes cleaned up after timeout.

### OPAQUE Auth — Registration

Zero-knowledge passphrase registration via OPAQUE PAKE. Kind names are intentionally neutral.

| Command                | Payload                                | Response                                                     |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `auth:register_start`  | `req_id, identifier, data`             | `auth:register_start_response { req_id, ok, data?, error? }` |
| `auth:register_finish` | `req_id, identifier, data, overwrite?` | `auth:register_finish_response { req_id, ok, error? }`       |

- `identifier` — alphanumeric + hyphens + underscores, max 128 chars
- `data` — base64-encoded OPAQUE bytes (`RegistrationRequest` then `RegistrationUpload`)
- `overwrite` — defaults to `false`; must be `true` to replace an existing registration

### OPAQUE Auth — Login

| Command             | Payload                    | Response                                                               |
| ------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `auth:login_start`  | `req_id, identifier, data` | `auth:login_start_response { req_id, ok, session_id?, data?, error? }` |
| `auth:login_finish` | `req_id, session_id, data` | `auth:login_finish_response { req_id, ok, session_id?, error? }`       |

- `session_id` — server-assigned UUID; client echoes it in `auth:login_finish` and subsequent `fs:put_*` calls
- After successful login the server holds a derived 32-byte AES-256-GCM key in per-connection state, keyed by `session_id`
- All OPAQUE ops run in `spawn_blocking`; per-connection cap: 16 concurrent login states + 16 active session keys

### Encrypted File Put — Binary Upload

Chunked encrypted binary upload. Client AES-GCM encrypts before sending.

| Command         | Payload                                                      | Response                                                      |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `fs:put_begin`  | `req_id, upload_id, session_id, project, dir, filename, len` | `fs:put_begin_ok { req_id, upload_id }`                       |
| `fs:put_chunk`  | `upload_id, seq` (JSON header, raw binary frame follows)     | `fs:put_chunk_ack { upload_id, seq }`                         |
| `fs:put_commit` | `req_id, upload_id`                                          | `fs:put_result { req_id, upload_id, ok, new_mtime?, error? }` |

### Encrypted File Put — Text Save

Single-blob encrypted save for editor text content.

| Command       | Payload                                                    | Response                                                |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `fs:put_save` | `req_id, session_id, project, path` (binary frame follows) | `fs:put_save_result { req_id, ok, new_mtime?, error? }` |

## Server→Client Messages

### Terminal Output

```json
{
  "kind": "terminal:output",
  "id": "uuid",
  "data": "...",
  "offset": 5123,
  "incarnation": 12345
}
```

`offset` is the exclusive end position in the same incarnation's byte stream as
replay. Drop chunks already covered by the replay watermark; trim only the
overlapping prefix of partially covered chunks. A start position beyond the
accepted watermark is a gap: stop rendering that stream and attach from the last
accepted offset. A newer `incarnation` starts a fresh full attach, including manual
replacement under the same session ID; older-incarnation frames are ignored.

Broadcast lag sends `{ "kind": "terminal:lagged", "dropped": 2 }`. Clients reattach
their mounted terminal streams even if no later output arrives. Client and server
must be deployed together: output or replay without the required stream metadata is invalid.

### Terminal Buffer Replay

Response to `terminal:attach` request. Contains accumulated buffer content for reconnection/delta sync:

```json
{
  "kind": "terminal:buffer",
  "id": "uuid",
  "data": "terminal output text",
  "offset": 5120,
  "incarnation": 12345,
  "reset": true,
  "truncated": false
}
```

**Fields:**

- `id` — Session UUID.
- `data` — Decoded terminal text, delta or retained history depending on `reset`; not base64.
- `offset` — Authoritative end byte position. Store it for the next attach; do not recount duplicated live chunks.
- `incarnation` — PTY instance identity; never reuse another incarnation's offset or emulator state.
- `reset` — Reset emulator state before full replacement replay; append contiguous deltas without resetting.
- `truncated` — Older history was evicted. Missing screen/parser state is not restored by replaying the surviving tail.

**Buffer Management:**

- Server maintains a bounded 1 MiB scrollback buffer per live session, evicting complete UTF-8 scalars at its head.
- `offset` counts decoded output bytes since this PTY incarnation started and survives buffer eviction.
- On attach with `from_offset` older than buffer start: fallback to full buffer with `reset=true`, `truncated=true`.
- On attach with `from_offset` = current offset: returns empty `data` (no new content).

### Terminal Events

#### Shell Lifecycle Event

```json
{
  "kind": "terminal:lifecycle",
  "id": "uuid",
  "lifecycle": "submitted",
  "generation": 12,
  "command": "git status"
}
```

This server-to-client event is emitted only for supported local interactive `zsh`, `fish`,
and Bash sessions after bounded OSC 633-compatible marker validation. `lifecycle` is one
of `editing`, `submitted`, `opaque`, or `unverified`; `command` is present only for a
validated `submitted` event. `generation` is an opaque per-PTY-incarnation ordering
value. The secret marker nonce is never sent, persisted, or logged.

Visible terminal output is delivered before a pending `editing` event. Bash disables its
adapter when an existing `DEBUG` trap or ambiguous command syntax prevents exact capture.
Attach/replay,
respawn, malformed or out-of-order markers, and alternate-buffer entry reset lifecycle
trust to `unverified`. Clients must treat every unsupported or reset state as unavailable
for automatic suggestions; terminal input remains normal `terminal:write` data.

#### Enhanced Exit Event

With restart metadata:

```json
{
  "kind": "terminal:exit",
  "id": "uuid",
  "exitCode": 1,
  "willRestart": true,
  "restartIn": 2000,
  "restartCount": 1,
  "incarnation": 4
}
```

**Fields:**

- `exitCode` — Process exit code (number)
- `willRestart` — (optional) If true, process will restart after backoff
- `restartIn` — (optional) Milliseconds until restart attempt
- `restartCount` — (optional) Cumulative restart counter
- `incarnation` — (optional) Nonnegative safe integer identifying the PTY incarnation

**Backward Compatibility:** Old clients may ignore the optional `incarnation` field and
continue handling the event by its public session ID. When that ID is reused for a new
PTY, clients that track incarnations may reject delayed events from an older incarnation.

#### Process Restarted Event

```json
{
  "kind": "process:restarted",
  "id": "uuid",
  "restartCount": 2,
  "previousExitCode": 1
}
```

**Usage:** Frontend listens for this to update restart badge and write restart banner.

#### Target Unavailable Event

When a target-scoped terminal cannot be respawned because its registered
worktree disappeared or became unavailable, the server sends:

```json
{
  "kind": "terminal:target-unavailable",
  "payload": {
    "project": "demo",
    "worktreePath": "/worktrees/demo-feature",
    "sessionId": "terminal:demo:dev:1",
    "incarnation": 4,
    "targetUnavailable": true,
    "willRestart": false
  }
}
```

The browser records the exact target as unavailable, preserves the session's
original target metadata, and falls back to the configured project root for
new operations. A `terminal:changed` event follows so terminal listings can
refresh.

#### Filesystem Overflow Event

```json
{
  "kind": "fs:overflow",
  "sub_id": 456,
  "message": "file system event queue full — subscription paused"
}
```

**Usage:** Indicates that FS subscription has overflowed. PTY connection remains active. Frontend can optionally re-subscribe after condition clears.

#### Other Terminal Events

Terminal creation and deletion use REST, not `terminal:spawn`, `terminal:spawned`,
or `terminal:kill` WebSocket messages. A
target-unavailable event is emitted for a create or respawn failure only after
fresh target validation confirms that the registered target was lost; ordinary
PTY or cwd failures remain ordinary request/recovery errors.

### Agent Status Push Events

Server-owned semantic agent status updates are broadcast to authenticated clients on `/ws`.

#### `terminal:agentStatusChanged`

Emitted when a terminal's agent-status row changes, including first reporter
admission and subsequent status/session updates. Optional `attention` appears
only when the transition warrants user attention:

```json
{
  "kind": "terminal:agentStatusChanged",
  "serverEpoch": 4305114706658182,
  "revision": 2,
  "row": {
    "id": "term-1",
    "incarnation": 1833568411063296,
    "agentKind": "omp",
    "agentSessionId": "sess-1",
    "reporterEpoch": 1,
    "state": "working",
    "turnId": "turn-100",
    "attentionRevision": 0
  }
}
```

When a blocker arises (e.g. tool approval requested) or turn ends with attention:

```json
{
  "kind": "terminal:agentStatusChanged",
  "serverEpoch": 4305114706658182,
  "revision": 3,
  "row": {
    "id": "term-1",
    "incarnation": 1833568411063296,
    "agentKind": "omp",
    "agentSessionId": "sess-1",
    "reporterEpoch": 1,
    "state": "blocked",
    "reason": "approval",
    "turnId": "turn-100",
    "attentionRevision": 1
  },
  "attention": {
    "id": "4305114706658182:term-1:1833568411063296:1",
    "kind": "needs-attention",
    "terminalId": "term-1",
    "incarnation": 1833568411063296,
    "agentKind": "omp",
    "agentSessionId": "sess-1",
    "turnId": "turn-100",
    "reason": "approval",
    "attentionRevision": 1,
    "timestampMs": 1790594288000
  }
}
```

#### `terminal:agentStatusRemoved`

Emitted when a terminal session is killed, disposed, or retired:

```json
{
  "kind": "terminal:agentStatusRemoved",
  "serverEpoch": 4305114706658182,
  "revision": 4,
  "terminalId": "term-1",
  "incarnation": 1833568411063296
}
```

#### `terminal:agentStatusInvalidated`

Emitted when the bounded server-side status broadcast drops events for this
client; the client must re-synchronize from a fresh snapshot.

```json
{
  "kind": "terminal:agentStatusInvalidated",
  "serverEpoch": 4305114706658182,
  "revision": 0
}
```

The lag marker uses `revision: 0`; clients reconcile from the snapshot revision
rather than treating it as a resume cursor.

Clients fetch a fresh snapshot via `GET /api/agent-status/v1/snapshot` upon receiving this event; see the [Agent Status API](./api-reference.md).

### File System — Tree Events

```json
{ "kind": "fs:tree_snapshot", "req_id": 123, "sub_id": 456, "nodes": [...] }
{ "kind": "fs:event", "sub_id": 456, "event": { "kind": "created", "path": "...", "from": null } }
```

Event kinds: `created`, `modified`, `deleted`, `renamed` (rename has `from` field).

### File System — Read Result

```json
{
  "kind": "fs:read_result",
  "req_id": 123,
  "ok": true,
  "binary": false,
  "mime": "text/typescript",
  "mtime": 1712577600,
  "size": 2048,
  "data": "base64_encoded_content"
}
```

On error (`ok=false`):

```json
{
  "kind": "fs:read_result",
  "req_id": 123,
  "ok": false,
  "binary": false,
  "code": "NOT_FOUND",
  "size": null
}
```

Possible codes: `NOT_FOUND`, `TOO_LARGE`, `PATH_ESCAPE`, `PERMISSION_DENIED`, `UNAVAILABLE`.

### File System — Write Results

```json
{ "kind": "fs:write_ack", "req_id": 123, "write_id": 456 }
{ "kind": "fs:write_chunk_ack", "write_id": 456, "seq": 0 }
{
  "kind": "fs:write_result",
  "write_id": 456,
  "ok": true,
  "new_mtime": 1712577700,
  "conflict": false
}
```

On conflict:

```json
{
  "kind": "fs:write_result",
  "write_id": 456,
  "ok": false,
  "conflict": true,
  "error": "file modified since read"
}
```

### Errors

```json
{
  "kind": "fs:error",
  "req_id": 123,
  "code": "INVALID_PATH",
  "message": "path escapes sandbox"
}
```

## Implementation Notes

**Request/Response Pairing:**

- Client generates `req_id` (increments per request)
- Server echoes `req_id` in response
- Timeouts: 30s default (FS_REQ_TIMEOUT_MS)

**Write Session Tracking:**

- `write_id` issued per `fs:write_begin`
- Client tracks active writes (Map<write_id, chunks>)
- Orphaned writes cleaned up after timeout

**Broadcast Events:**

- fs:event, terminal:output fan-out to all subscribed clients
- No ACK required by receiver

- Authenticated handshakes validate the V2 session policy from the query token
  or auth cookie, subject to the configured origin checks. Legacy or stale
  sessions are rejected before upgrade.
- Open sockets check the effective auth deadline on inbound frames and before
  outbound writes; a five-second watcher rechecks persisted session state with
  a two-second lookup timeout. Close codes: `4403` MFA required, `4401` full
  login required, `1013` auth state unavailable; `4001` remains queue overflow.
  Auth close is a WebSocket close frame, not a JSON `kind` message.
- Revocation observed by the watcher can take up to seven seconds to close an
  existing socket. Inbound dispatch/commit checks the local session lease/
  deadline, not MongoDB per frame; the watcher covers persisted revocation.
