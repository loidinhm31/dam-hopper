# Phase 02 — Protocol Extension: `terminal:attach`

## Context
- Parent: [plan.md](./plan.md)
- Dependencies: Phase 1 (buffer offset tracking)

## Overview
- Date: 2026-04-17
- Description: Add `terminal:attach` inbound message and `terminal:buffer` outbound message to WS protocol.
- Priority: P2
- Implementation status: pending
- Effort: 4h

## Key Insights
- Current protocol has no way for client to request buffer replay.
- `terminal:attach` is the client's "I'm (re)connecting to session X, replay from offset Y".
- `terminal:buffer` is the server's response with buffer content + current offset.
- Offset enables delta replay on subsequent attaches (optional optimization).

## Requirements
- Add `TermAttach { id, from_offset }` to `ClientMsg` enum.
- Add `TermBuffer { id, data, offset }` to `ServerMsg` enum.
- Add `get_buffer_with_offset(id, from_offset)` to `PtySessionManager`.
- Handle `TermAttach` in WS handler — call manager, send response.
- Error case (session not found): log warning, no response (client should create new).

## Architecture

### Protocol Messages

```rust
// ClientMsg (ws_protocol.rs)
#[serde(rename = "terminal:attach")]
TermAttach { 
    id: String,
    /// Client's last received byte offset (optional, for delta replay)
    from_offset: Option<u64>,
}

// ServerMsg (ws_protocol.rs)
#[serde(rename = "terminal:buffer")]
TermBuffer {
    id: String,
    /// Base64-encoded buffer content (lossy UTF-8)
    data: String,
    /// Current buffer byte offset (client stores for next attach)
    offset: u64,
}
```

### Manager Method

```rust
// PtySessionManager
pub fn get_buffer_with_offset(
    &self, 
    id: &str, 
    from_offset: Option<u64>
) -> Result<(String, u64), AppError> {
    let inner = self.inner.lock().unwrap();
    let session = inner.live.get(id)
        .ok_or_else(|| AppError::SessionNotFound(id.to_string()))?;
    let buf = session.buffer.lock().unwrap();
    let (data, offset) = buf.read_from(from_offset);
    Ok((String::from_utf8_lossy(data).into_owned(), offset))
}
```

### WS Handler

```rust
// ws.rs handle_client_msg()
ClientMsg::TermAttach { id, from_offset } => {
    match state.pty_manager.get_buffer_with_offset(&id, from_offset) {
        Ok((data, offset)) => {
            let msg = ServerMsg::TermBuffer { id, data, offset };
            if let Err(e) = tx.send(msg.into()).await {
                warn!(error = %e, "Failed to send terminal:buffer");
            }
        }
        Err(e) => {
            warn!(id = %id, error = %e, "terminal:attach failed");
            // No response — client should detect via timeout and create new session
        }
    }
}
```

## Related Code Files
- `server/src/api/ws_protocol.rs` — add message types
- `server/src/api/ws.rs` — add handler branch
- `server/src/pty/manager.rs` — add `get_buffer_with_offset()`
- `packages/web/src/api/client.ts` — add message types (for Phase 3)

## Implementation Steps
1. Add `TermAttach` variant to `ClientMsg` in `ws_protocol.rs`.
2. Add `TermBuffer` variant to `ServerMsg` in `ws_protocol.rs`.
3. Add `get_buffer_with_offset()` to `PtySessionManager`.
4. Add handler branch in `ws.rs` for `ClientMsg::TermAttach`.
5. Add integration test: spawn session, attach, verify buffer content.

## Todo
- [ ] `ClientMsg::TermAttach` variant
- [ ] `ServerMsg::TermBuffer` variant
- [ ] `get_buffer_with_offset()` method
- [ ] WS handler branch
- [ ] Integration test

## Test Cases

| Scenario | Expected |
|----------|----------|
| Attach to live session | `terminal:buffer` with content |
| Attach to dead session | No response (error logged) |
| Attach with from_offset | Delta buffer returned |
| Attach with from_offset = 0 | Full buffer returned |

## Success Criteria
- `cargo test` passes.
- Manual test: use `websocat` to send `terminal:attach`, receive `terminal:buffer`.

## Risk Assessment
- Low. Additive protocol change. No breaking changes to existing messages.
- Race condition: session killed between attach request and response — handled by lock + error.

## Security Considerations
- Session ID must be validated (already done in manager lookup).
- Buffer content may contain sensitive data — same exposure as `terminal:output`.

## Next Steps
Phase 3 implements frontend handling.
