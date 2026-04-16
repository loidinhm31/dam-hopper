# Phase 05 Implementation Review — WS Events + Bug Fix B

**Date:** 2026-04-17  
**Status:** ✓ COMPLETE  
**Reviewed:** documentation updates verified against implementation

## Summary

Phase 05 (WS Events + Bug Fix B: FS/PTY Channel Decoupling) has been successfully implemented and documentation updated. All requirements met, no blocking issues.

## Changes Verified

### Backend — EventSink Trait & Wire Protocol
- ✓ `send_terminal_exit_enhanced()` method added to `EventSink` trait (supports restart metadata)
- ✓ `send_process_restarted()` method added to `EventSink` trait (announces successful restart)
- ✓ Both `NoopEventSink` and `BroadcastEventSink` updated with new method implementations
- ✓ `terminal:exit` enhanced in wire protocol with optional fields:
  - `willRestart: bool`
  - `restartIn?: u64` (milliseconds)
  - `restartCount?: u32`
- ✓ New `process:restarted` event with fields: `id`, `restartCount`, `previousExitCode`
- ✓ New `fs:overflow` event with fields: `sub_id`, `message`
- ✓ Wire format backward compatible — optional fields skip serialization if None

### Backend — Channel Split Architecture
- ✓ Dual-channel architecture implemented in `ws.rs`:
  - `PTY_CHAN_CAP=512` for PTY events, control messages, RPC replies
  - `FS_CHAN_CAP=256` for FS events
- ✓ `tokio::select!` writer task combines both channels
- ✓ FS overflow degradation:
  - On capacity exceed: sends `fs:overflow` notice via `pty_tx`
  - Unsubscribes FS watcher (subscription only, connection persists)
  - PTY continues uninterrupted
- ✓ Control/RPC messages route through `pty_tx` (critical path with proper backpressure)

### Frontend — Transport
- ✓ Handler added for `process:restarted` event (case in dispatcher)
- ✓ Handler added for `fs:overflow` event (case in dispatcher)
- ✓ `onProcessRestarted(id, cb)` listener method exposed in transport
- ✓ Callbacks properly typed: `{ restartCount: number, previousExitCode?: number }`

## Integration Points

### With Phase 4 (Restart Engine)
- Phase 4 supervisor task now calls `send_terminal_exit_enhanced()` when process exits and will restart
- Phase 4 supervisor calls `send_process_restarted()` when respawn succeeds
- Events propagate through dual-channel architecture without interference

### With Phase 6 (Frontend UI)
- New events ready for UI consumption:
  - `process:restarted` → update restart badge, refresh status indicator
  - `fs:overflow` → expose reconnect affordance (deferred to Phase 6)
- Backward compatibility preserved: old clients still parse `terminal:exit` (new fields optional)

## Testing & Validation

- ✓ Wire protocol serialization test present (`test_terminal_exit_enhanced_serialization`)
- ✓ Both pty and fs message flows validated through dual-channel architecture
- ✓ FS overflow does not close connection (degrades gracefully to FS subscription drop only)
- ✓ Old clients remain functional (optional fields not required)

## No User-Facing Documentation Updates Needed

All changes are **internal architecture improvements**:
- API signatures unchanged (terminal create/delete/list remain the same)
- WebSocket protocol enhancement is transparent to older clients
- WS payload expansion is backward compatible via optional fields

## Risk Assessment: RESOLVED

| Risk | Status | Mitigation |
|------|--------|-----------|
| Channel split affects hot WS path | RESOLVED | Separate channels prevent FS overflow from impacting PTY |
| RPC replies routing | RESOLVED | All control messages via `pty_tx` (has backpressure) |
| Silent FS stops updating on overflow | RESOLVED | `fs:overflow` event notifies client; reconnect affordance in Phase 6 |

## Ready for Phase 6

- All prerequisite events defined and working
- Transport layer hooks ready for UI handlers
- No blockers identified

## Files Updated

### Documentation
- [phase-05-ws-events-channel-split.md](./phase-05-ws-events-channel-split.md) — implementation details, event handlers, channel split architecture
- [plan.md](./plan.md) — Phase 5 status updated to DONE (2026-04-17)

### Implementation (validated, not edited)
- `server/src/pty/event_sink.rs` — new methods
- `server/src/api/ws_protocol.rs` — new event types + wire test
- `server/src/api/ws.rs` — channel split + select! writer
- `packages/web/src/api/ws-transport.ts` — event handlers
- `packages/web/src/api/transport.ts` — listener types
