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
| `terminal:kill` | `id` | (ACK implicit) |

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

### File System — Write (Phase 04)

Three messages in sequence:

| Command | Payload | Response |
|---------|---------|----------|
| `fs:write_begin` | `req_id, project, path, expected_mtime, size` | `fs:write_ack { req_id, write_id }` |
| `fs:write_chunk` | `write_id, seq, eof, data` | `fs:write_chunk_ack { write_id, seq }` |
| `fs:write_commit` | `write_id` | `fs:write_result { write_id, ok, new_mtime?, conflict, error? }` |

**Key details:**
- `expected_mtime` on begin guards against concurrent modification (mtime must match)
- `size` is total bytes being written (server cap check)
- Chunks are base64-encoded; empty files send single chunk with `data=""`, `eof=true`
- On conflict: `conflict=true`, client retries with fresh mtime or reloads

## Server→Client Messages

### Terminal Output

```json
{ "kind": "terminal:output", "id": "uuid", "data": "..." }
```

### Terminal Events

```json
{ "kind": "terminal:spawned", "id": "uuid", ... }
{ "kind": "terminal:exited", "id": "uuid", "code": 0 }
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
