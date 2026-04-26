# WebSocket Protocol Guide

Real-time message envelope for terminal I/O, file watching, and file operations.

## Message Format

All messages use JSON with `kind` tag (not legacy `type`). Phase 02 hard-cut from old protocol.

```json
{ "kind": "command:action", ...payload }
```

**Direction:** Bidirectional (client↔server).

## Client→Server Messages

### Terminal

| Command | Payload | Response |
|---------|---------|----------|
| `terminal:spawn` | `project, profile, env_overrides?` | `terminal:spawned { id, ... }` |
| `terminal:write` | `id, data` | (no response; server queues) |
| `terminal:resize` | `id, cols, rows` | (ACK implicit) |
| `terminal:attach` | `id, from_offset?` | `terminal:buffer { id, data, offset }` (Phase 02+) |
| `terminal:kill` | `id` | (ACK implicit) |

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
  "offset": 5120
}
```

**Fields:**
- `id` — Echo of request session ID
- `data` — Base64-encoded buffer content (delta if `from_offset` provided; full otherwise). Lossy UTF-8 decoding used.
- `offset` — Current buffer byte offset. Client stores this for next attach.

**Error behavior:** If session not found, server logs warning and sends no response. Client should interpret timeout as session dead and create new session via `terminal:spawn`.

**Use Case:** On WebSocket reconnect, client sends `terminal:attach` with stored offset instead of re-requesting full buffer, reducing bandwidth ~90% in typical scenarios.

#### Frontend Reconnect UI (Phase 3)

**Attach Workflow:**
1. TerminalPanel mounts or WebSocket reconnects
2. Frontend queries `terminal:list` to check if session exists
3. If session found → call `terminalAttach()` without `from_offset` (initial attach) or with stored offset (delta attach)
4. Register `onTerminalBuffer()` listener BEFORE sending attach request
5. On buffer response → clear xterm display and write replayed content
6. Timeout fallback (3s): if no buffer response, create new session via `terminal:spawn`

**UI States:**
- `idle` — Ready for attach
- `attaching` — Waiting for buffer response; show spinner overlay with "Reconnecting…"
- `attached` — Buffer received/session created; hide overlay and resume output streaming
- `creating` — Creating new session (timeout fallback or no existing session)

**Overlay:**
- Rendered when `attachState === "attaching"`
- Semi-transparent dark backdrop (`bg-slate-900/50`) with blur
- Animated spinner with "Reconnecting…" text
- Auto-dismisses on buffer response or timeout

### File System — Subscribe (Phase 02+)

| Command | Payload | Response |
|---------|---------|----------|
| `fs:subscribe_tree` | `req_id, project, path` | `fs:tree_snapshot { req_id, sub_id, nodes }` |
| `fs:unsubscribe_tree` | `sub_id` | (no response) |

Afterward, server pushes: `fs:event { sub_id, event: { kind, path, from? } }` on change.

### File System — Read (Phase 04)

| Command | Payload | Response |
|---------|---------|----------|
| `fs:read` | `req_id, project, path, offset?, len?` | `fs:read_result { req_id, ok, binary, mime?, mtime?, size?, data?, code? }` |

- `offset, len` optional (range reads for large files)
- `data` is base64 (text or binary)
- If `ok=false`, check `code` (e.g., "NOT_FOUND", "TOO_LARGE")

### File System — Write (Phase 04/05)

Binary streaming support added for large file handling.

| Command | Payload | Response |
|---------|---------|----------|
| `fs:write_begin` | `req_id, project, path, expected_mtime, size, encoding?` | `fs:write_ack { req_id, write_id }` |
| `fs:write_chunk` | `write_id, seq, eof, data` | `fs:write_chunk_ack { write_id, seq }` |
| `fs:write_chunk_binary` | `write_id, seq, eof, size` (follows raw binary) | `fs:write_chunk_ack { write_id, seq }` |
| `fs:write_commit` | `write_id` | `fs:write_result { write_id, ok, new_mtime?, conflict, error? }` |

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

| Command | Payload | Response |
|---------|---------|----------|
| `auth:register_start` | `req_id, identifier, data` | `auth:register_start_response { req_id, ok, data?, error? }` |
| `auth:register_finish` | `req_id, identifier, data, overwrite?` | `auth:register_finish_response { req_id, ok, error? }` |

- `identifier` — alphanumeric + hyphens + underscores, max 128 chars
- `data` — base64-encoded OPAQUE bytes (`RegistrationRequest` then `RegistrationUpload`)
- `overwrite` — defaults to `false`; must be `true` to replace an existing registration

### OPAQUE Auth — Login (Phase Stealth-01)

| Command | Payload | Response |
|---------|---------|----------|
| `auth:login_start` | `req_id, identifier, data` | `auth:login_start_response { req_id, ok, session_id?, data?, error? }` |
| `auth:login_finish` | `req_id, session_id, data` | `auth:login_finish_response { req_id, ok, session_id?, error? }` |

- `session_id` — server-assigned UUID; client echoes it in `auth:login_finish` and subsequent `fs:put_*` calls
- After successful login the server holds a derived 32-byte AES-256-GCM key in per-connection state, keyed by `session_id`
- All OPAQUE ops run in `spawn_blocking`; per-connection cap: 16 concurrent login states + 16 active session keys

### Encrypted File Put — Binary Upload (Phase Stealth-01 stubs / Phase Stealth-04 full)

Chunked encrypted binary upload. Client AES-GCM encrypts before sending.

| Command | Payload | Response |
|---------|---------|----------|
| `fs:put_begin` | `req_id, upload_id, session_id, project, dir, filename, len` | `fs:put_begin_ok { req_id, upload_id }` |
| `fs:put_chunk` | `upload_id, seq` (JSON header, raw binary frame follows) | `fs:put_chunk_ack { upload_id, seq }` |
| `fs:put_commit` | `req_id, upload_id` | `fs:put_result { req_id, upload_id, ok, new_mtime?, error? }` |

### Encrypted File Put — Text Save (Phase Stealth-01 stubs / Phase Stealth-04 full)

Single-blob encrypted save for editor text content.

| Command | Payload | Response |
|---------|---------|----------|
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
  "offset": 5120
}
```

**Fields:**
- `id` — Session UUID
- `data` — Base64-encoded buffer content (delta or full depending on `from_offset`). Entire content is lossy UTF-8.
- `offset` — Current accumulated byte offset (monotonically increasing counter). Client stores for next attach to request delta only.

**Buffer Management:**
- Server maintains a ring buffer (scrollback) for each live session. 
- `offset` field points to total bytes written since session creation (survives buffer eviction).
- On attach with `from_offset` older than buffer start: fallback to full buffer.
- On attach with `from_offset` = current offset: returns empty `data` (no new content).

### Terminal Events

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
```json
{ "kind": "terminal:spawned", "id": "uuid", ... }
```

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
