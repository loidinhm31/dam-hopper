# WebSocket Protocol Guide

Real-time message envelope for terminal I/O, file watching, and file operations.

## Message Format

All messages use JSON with `kind` tag (not legacy `type`). Phase 02 hard-cut from old protocol.

```json
{ "kind": "command:action", ...payload }
```

**Direction:** Bidirectional (client↔server).

## Project target context

REST requests that operate on project files, Git state, editor/diff data, or
media carry the explicit `ProjectTargetRef` fields documented in the [API
reference](./api-reference.md#project-worktree-targets-phases-17). The browser
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

### Legacy WebSocket terminal messages

| Command           | Payload                            | Response                                                 |
| ----------------- | ---------------------------------- | -------------------------------------------------------- |
| `terminal:spawn`  | `project, profile, env_overrides?` | `terminal:spawned { id, ... }`                           |
| `terminal:write`  | `id, data`                         | (no response; server queues)                             |
| `terminal:resize` | `id, cols, rows`                   | (ACK implicit)                                           |
| `terminal:attach` | `id, from_offset?`                 | `terminal:buffer { id, data, offset, reset, truncated }` |
| `terminal:kill`   | `id`                               | (ACK implicit)                                           |

#### Terminal Attach (Phase 02+)

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
  "data": "base64_encoded_content",
  "offset": 5120,
  "reset": false,
  "truncated": false
}
```

**Fields:**

- `id` — Echo of request session ID
- `data` — Buffer content (delta if `reset=false`; full snapshot if `reset=true`). Lossy UTF-8 decoding used.
- `offset` — Current buffer byte offset. Client stores this for next attach.
- `reset` — Clear the terminal before writing `data` when true; append `data` when false.
- `truncated` — Requested offset was older than the retained 1 MB tail, so the response is the newest available full snapshot.

**Error behavior:** If session not found, server logs warning and sends no response. A missing response is not itself proof that a session is dead: the client checks `terminal:listDetailed` before creating a replacement.

**Use Case:** On WebSocket reconnect, client sends `terminal:attach` with stored offset instead of re-requesting full buffer, reducing bandwidth ~90% in typical scenarios.

#### Frontend Reconnect UI (Phase 3)

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

- xterm BEL and OSC 9/777/99 handlers stay frontend-only and feed `AgentActivityTracker`.
- Tracker input includes submitted commands, output, user input, and enhanced exit state.
- `willRestart` suppresses the finished notification so restart flows do not emit a false terminal-exit alert.
- Cleanup removes signal handlers and timers on unmount, reconnect, or session swap.

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

### File System — Subscribe (Phase 02+)

| Command               | Payload                 | Response                                     |
| --------------------- | ----------------------- | -------------------------------------------- |
| `fs:subscribe_tree`   | `req_id, project, path` | `fs:tree_snapshot { req_id, sub_id, nodes }` |
| `fs:unsubscribe_tree` | `sub_id`                | (no response)                                |

Afterward, server pushes: `fs:event { sub_id, event: { kind, path, from? } }` on change.

### File System — Read (Phase 04)

| Command   | Payload                                | Response                                                                    |
| --------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `fs:read` | `req_id, project, path, offset?, len?` | `fs:read_result { req_id, ok, binary, mime?, mtime?, size?, data?, code? }` |

- `offset, len` optional (range reads for large files)
- `data` is base64 (text or binary)
- If `ok=false`, check `code` (e.g., "NOT_FOUND", "TOO_LARGE")

### File System — Write (Phase 04/05)

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

### OPAQUE Auth — Registration (Phase Stealth-01)

Zero-knowledge passphrase registration via OPAQUE PAKE. Kind names are intentionally neutral.

| Command                | Payload                                | Response                                                     |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `auth:register_start`  | `req_id, identifier, data`             | `auth:register_start_response { req_id, ok, data?, error? }` |
| `auth:register_finish` | `req_id, identifier, data, overwrite?` | `auth:register_finish_response { req_id, ok, error? }`       |

- `identifier` — alphanumeric + hyphens + underscores, max 128 chars
- `data` — base64-encoded OPAQUE bytes (`RegistrationRequest` then `RegistrationUpload`)
- `overwrite` — defaults to `false`; must be `true` to replace an existing registration

### OPAQUE Auth — Login (Phase Stealth-01)

| Command             | Payload                    | Response                                                               |
| ------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `auth:login_start`  | `req_id, identifier, data` | `auth:login_start_response { req_id, ok, session_id?, data?, error? }` |
| `auth:login_finish` | `req_id, session_id, data` | `auth:login_finish_response { req_id, ok, session_id?, error? }`       |

- `session_id` — server-assigned UUID; client echoes it in `auth:login_finish` and subsequent `fs:put_*` calls
- After successful login the server holds a derived 32-byte AES-256-GCM key in per-connection state, keyed by `session_id`
- All OPAQUE ops run in `spawn_blocking`; per-connection cap: 16 concurrent login states + 16 active session keys

### Encrypted File Put — Binary Upload (Phase Stealth-01 stubs / Phase Stealth-04 full)

Chunked encrypted binary upload. Client AES-GCM encrypts before sending.

| Command         | Payload                                                      | Response                                                      |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `fs:put_begin`  | `req_id, upload_id, session_id, project, dir, filename, len` | `fs:put_begin_ok { req_id, upload_id }`                       |
| `fs:put_chunk`  | `upload_id, seq` (JSON header, raw binary frame follows)     | `fs:put_chunk_ack { upload_id, seq }`                         |
| `fs:put_commit` | `req_id, upload_id`                                          | `fs:put_result { req_id, upload_id, ok, new_mtime?, error? }` |

### Encrypted File Put — Text Save (Phase Stealth-01 stubs / Phase Stealth-04 full)

Single-blob encrypted save for editor text content.

| Command       | Payload                                                    | Response                                                |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `fs:put_save` | `req_id, session_id, project, path` (binary frame follows) | `fs:put_save_result { req_id, ok, new_mtime?, error? }` |

## Server→Client Messages

### Terminal Output

```json
{ "kind": "terminal:output", "id": "uuid", "data": "..." }
```

### Terminal Buffer Replay (Phase 02+)

Response to `terminal:attach` request. Contains accumulated buffer content for reconnection/delta sync:

```json
{
  "kind": "terminal:buffer",
  "id": "uuid",
  "data": "base64_encoded_buffer_content",
  "offset": 5120,
  "reset": true,
  "truncated": false
}
```

**Fields:**

- `id` — Session UUID
- `data` — Buffer content (delta or full depending on `reset`). Entire content is lossy UTF-8.
- `offset` — Current accumulated byte offset (monotonically increasing counter). Client stores for next attach to request delta only.
- `reset` — Clear terminal before writing when true; append when false.
- `truncated` — True when the requested offset has been evicted from the retained 1 MB scrollback.

**Buffer Management:**

- Server maintains a ring buffer (scrollback) for each live session.
- `offset` field points to total bytes written since session creation (survives buffer eviction).
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

#### Basic Exit Event (Legacy)

```json
{ "kind": "terminal:exited", "id": "uuid", "code": 0 }
```

#### Enhanced Exit Event (Phase 5+)

With restart metadata:

```json
{
  "kind": "terminal:exit",
  "id": "uuid",
  "exitCode": 1,
  "willRestart": true,
  "restartInMs": 2000,
  "restartCount": 1
}
```

**Fields:**

- `exitCode` — Process exit code (number)
- `willRestart` — (optional) If true, process will restart after backoff
- `restartInMs` — (optional) Milliseconds until restart attempt
- `restartCount` — (optional) Cumulative restart counter

**Backward Compatibility:** Old clients receive functional event; new optional fields ignored if not understood.

#### Process Restarted Event (Phase 5+)

```json
{
  "kind": "process:restarted",
  "id": "uuid",
  "restartCount": 2,
  "previousExitCode": 1
}
```

**Usage:** Frontend listens for this to update restart badge and write restart banner.

#### Target Unavailable Event (Phase 07)

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

#### Filesystem Overflow Event (Phase 5+)

```json
{
  "kind": "fs:overflow",
  "sub_id": 456,
  "message": "file system event queue full — subscription paused"
}
```

**Usage:** Indicates that FS subscription has overflowed. PTY connection remains active. Frontend can optionally re-subscribe after condition clears.

#### Other Terminal Events

The historical `terminal:spawned` event is retained only for older clients;
current browser creation uses the REST `terminal:create` channel above. A
target-unavailable event is emitted for a create or respawn failure only after
fresh target validation confirms that the registered target was lost; ordinary
PTY or cwd failures remain ordinary request/recovery errors.

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

**Connection Lifecycle:**

- Auth: append `?token={bearer_token}` to WS URL
- Server validates token before accepting messages
- Graceful close on auth failure or idle timeout
