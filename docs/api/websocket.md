# WebSocket API

WebSocket route, protocol, and event contracts moved from the [API reference index](../api-reference.md).
## WebSocket Endpoint

**WebSocket /ws**

Auth: append `?token={bearer_token}` to URL.

Protocol: JSON frames. Client sends commands via `{kind:}` envelope, server broadcasts events.

**Message Format (all client→server or server→client):**

```json
{ "kind": "terminal:write", "id": "uuid", "data": "..." }
```

**Legacy WebSocket Terminal Messages (historical; new creation uses REST):**

- `{ kind: "terminal:spawn", project, profile, env_overrides? }` → server responds with `{ kind: "terminal:spawned", id, ... }`
- `{ kind: "terminal:write", id, data }` — send input
- `{ kind: "terminal:attach", id, from_offset? }` — request buffer replay; server responds with `{ kind: "terminal:buffer", id, data, offset, reset, truncated }`
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

The current browser terminal creation path is the REST `terminal:create`
channel documented above. Target-scoped command and profile IDs use stable
opaque target discriminators; target routing itself is server-validated and
represented by `worktreePath` session metadata.

**File Tree Subscription:**

- `{ kind: "fs:subscribe_tree", req_id, project, path, worktreePath?, watchOnly? }` — start watching a validated directory; server responds with `{ kind: "fs:tree_snapshot", sub_id, nodes: [...] }`. `watchOnly: true` skips the unused tree snapshot and uses strict rooted directory validation.
- `{ kind: "fs:unsubscribe_tree", sub_id }` — stop watching.
- `{ kind: "fs:event", sub_id, event: { kind, path, from?, targetRelativePath?, targetRelativeFrom? } }` — server pushes changes (`created|modified|removed|renamed`). `path` and `from` remain absolute. Watch-only subscriptions additionally include target-relative endpoints inside the captured validated project/worktree root; `"."` identifies the root itself, and outside-target endpoints are omitted. Generic subscriptions omit these additional fields.
- The plans client uses relative structural identity to rebind replaced directory/root handles even when the listing DTO is unchanged. Legacy events without relative identity conservatively rebind the emitting subtree.

**File Read:**

- `{ kind: "fs:read", req_id, project, path, offset?, len? }` — read file content with optional range
  - Supports large files via offset+len (range reads)
  - Server responds: `{ kind: "fs:read_result", req_id, ok, binary, mime?, mtime?, size?, data?, code? }`
  - `data` is base64-encoded content (text or binary), max 100MB
  - If `ok=false` and `code="TOO_LARGE"`: file exceeds cap; use range reads (LargeFileViewer)
  - `readMode: "plan-document"` selects a strict bounded Markdown snapshot (64 KiB), rejecting linked traversal and returning conflict when descriptor, named-entry, or ancestor identity changes during the read.

**File Write:**

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

