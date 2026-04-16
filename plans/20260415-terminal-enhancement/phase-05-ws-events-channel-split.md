# Phase 05 — WS Events + Bug Fix B (FS/PTY Channel Decoupling)

## Context
- Parent: [plan.md](./plan.md)
- Sources: [f01-feasibility-plan.md § Phase 4](./f01-feasibility-plan.md), [terminal-crash-debug.md § Failure Mode 3](./terminal-crash-debug.md)
- Dependencies: Phase 4 (supervisor emits events through sink).

## Overview
- Date: 2026-04-16
- Description: Enhance `terminal:exit` payload with restart fields, add `process:restarted` event. Separately, stop FS-event overflow from killing the WS connection.
- Priority: P1 (Bug Fix B is High severity)
- Implementation status: pending
- Review status: pending

## Key Insights
- Current `terminal:exit` is `{kind, id, exitCode}`. Add `willRestart`, `restartIn`, `restartCount` without breaking parser — all optional.
- FS pump uses `try_send` → overflow closes the whole connection (code 4001), dropping PTYs too. PTY pump uses `.await` → correct backpressure. Root cause: shared `mpsc::Sender<WireMsg>` with `CONN_CHAN_CAP=512`.
- **Decision: separate channels.** Two senders, two writer-tasks feeding the same `ws_tx`, OR one writer selecting across both. Justification: raising cap to 2048 only delays overflow under FS-event bursts (e.g., `git checkout` across huge tree) and still correlates failures. Separation contains the blast radius — FS drop only kills FS subscription, PTYs continue.
- Implementation: split `out_tx` into `pty_tx` (with `.await`) and `fs_tx` (with `try_send`, overflow drops the FS **subscription**, not the connection). Writer task `tokio::select!`s.

## Requirements
- Wire protocol: `terminal:exit` adds optional `willRestart: bool`, `restartIn?: number`, `restartCount?: number`.
- New event `process:restarted { kind, id, restartCount, previousExitCode }`.
- `EventSink` trait gains enhanced methods; both `NoopEventSink` + `BroadcastEventSink` updated.
- FS overflow closes only the FS subscription (with a `fs:overflow` notice) — PTYs, control messages, RPC replies continue.
- Existing clients that don't know new fields must still parse `terminal:exit`.

## Architecture
```
               ┌─────────────┐
PTY events ───▶│  pty_tx     │──┐
               └─────────────┘  │
                                ├─▶ tokio::select! ─▶ ws_tx ─▶ browser
               ┌─────────────┐  │
FS events ────▶│  fs_tx      │──┘
               │ (try_send,  │
               │  overflow = │
               │  drop fs sub)│
               └─────────────┘
```

## Related Code Files
- `server/src/pty/event_sink.rs` — trait + impls
- `server/src/api/ws_protocol.rs` — wire types
- `server/src/api/ws.rs` — channel split (L27 cap, L882–884 pty pump, L973–980 fs pump)
- `packages/web/src/api/ws-transport.ts` — parse new fields; handle `process:restarted` and `fs:overflow`
- `packages/web/src/api/client.ts` — event listener types

## Implementation Steps
1. Add `send_terminal_exit_enhanced(id, exit_code, will_restart, restart_in_ms, restart_count)` and `send_process_restarted(id, restart_count, prev_exit)` to `EventSink`.
2. Keep old `send_terminal_exit` as a thin wrapper for call sites not in the restart path (tests).
3. Extend wire enum in `ws_protocol.rs`; ensure serde `skip_serializing_if = "Option::is_none"`.
4. Supervisor (Phase 4) calls enhanced methods.
5. Split channels in `ws.rs`: introduce `PTY_CHAN_CAP=512` and `FS_CHAN_CAP=256`. Writer task uses `select!` over both receivers; both feed `ws_tx`.
6. FS pump: on `TrySendError::Full`, emit `fs:overflow` notice via pty_tx (low-volume) and unsubscribe FS watcher for that connection. Do NOT close the WS.
7. Transport: listen for `process:restarted`, surface via new `onProcessRestarted(id, cb)`. On `fs:overflow`, expose a status flag (UI can optionally re-subscribe).
8. Tests: unit test for wire payload shape; integration test that floods FS events and confirms PTY still streams.

## Todo
- [ ] `EventSink` trait additions
- [ ] Wire protocol fields
- [ ] `ws.rs` channel split
- [ ] FS-overflow degradation path (drop sub, not conn)
- [ ] `WsTransport.onProcessRestarted`
- [ ] Tests

## Success Criteria
- Old clients still receive functional `terminal:exit`.
- Flood `packages/web/dist` with renames → FS subscription drops with `fs:overflow` notice; PTY output uninterrupted.
- `process:restarted` visible in dev-tools WS tab during Phase 4 restart scenarios.

## Risk Assessment
- **Medium.** Channel split touches hot WS path.
- Regression risk: RPC replies must keep using the PTY (control) channel or a third channel — plan: reuse pty_tx for control since it's the one with proper backpressure.
- FS overflow previously crashed clients; now FS state may silently stop updating — expose a reconnect affordance in future.

## Security Considerations
- `fs:overflow` payload must not leak server internals.

## Next Steps
Phase 6 consumes new events for UI.
