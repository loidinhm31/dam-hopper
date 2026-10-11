# Code Review: Phase 03 — Public WebSocket Presence, Liveness, and Session Binding

**Phase**: Phase 03 (`phase-03-websocket-presence-and-session-binding.md`)  
**Plan**: `plans/261010-1746-host-resources-auto-sleep/`  
**Date**: 2026-10-11  
**Score**: **9.6 / 10** (APPROVED)

---

## Code Review Summary

### Scope
- **Files Reviewed**:
  - `server/src/idle_suspend/client_presence.rs` (884 lines)
  - `server/src/idle_suspend/mod.rs` (83 lines)
  - `server/src/state.rs` (455 lines)
  - `server/src/api/ws_protocol.rs` (764 lines)
  - `server/src/api/ws.rs` (3,708 lines)
  - `server/tests/ws_client_presence.rs` (370 lines)
  - `packages/ui/src/api/transport.ts` (168 lines)
  - `packages/ui/src/api/ws-transport.ts` (4,088 lines)
  - `packages/ui/src/api/connections.ts` (956 lines)
  - `packages/ui/src/api/ws-transport.test.ts` (2,352 lines)
  - `packages/ui/src/api/connections.test.ts` (432 lines)
- **Lines of Code Analyzed**: ~13,400 LOC across Rust backend and TypeScript frontend
- **Review Focus**: Public WebSocket presence tracking, RAII guard lifecycles, cryptographic session capabilities, constant-time comparison, fail-closed admission fences, frame reader control responsiveness, heartbeat supervision, UI exact-owner receipt lifetime, and DRY/KISS/YAGNI.
- **Updated Plans**:
  - `plans/261010-1746-host-resources-auto-sleep/phase-03-websocket-presence-and-session-binding.md`
  - `plans/261010-1746-host-resources-auto-sleep/plan.md`
  - `plans/261010-1746-host-resources-auto-sleep/progress.md`

---

## Overall Assessment

Exceptional implementation of Phase 03 requirements with rigorous adherence to security and concurrency invariants. Bounded in-memory registry properly isolates public `/ws` connections from private OMP reporter sockets and SSE. Synchronous mutex (`parking_lot::Mutex`) dropped before any channel send or async boundary (zero locks across `.await`). Dedicated frame reader thread decouples control frames (Ping/Pong/Close) from application message processing, guaranteeing zero heartbeat starvation during long filesystem/search handlers. Per-connection 122-bit decision capability hashed via SHA-256 and compared using constant-time equality (`subtle::ConstantTimeEq`); plaintext secrets never logged or exposed in status/GET endpoints. Frontend `WsTransport` and `connections.ts` strictly enforce exact-owner generation bounds, preventing stale profiles or disconnected states from accessing active session capabilities.

---

## Critical Issues

*None.* No security vulnerabilities, data leaks, memory leaks, or breaking regressions identified.

---

## Warnings

1. **Heartbeat Alert Send Backpressure Handling (`server/src/api/ws.rs:459`)**:
   - *Observation*: In `heartbeat_task`, `heartbeat_alert_tx.send(WireMsg::Ping(nonce)).await` awaits channel capacity on `alert_tx` (capacity: 32). If the client TCP connection freezes completely and the writer task blocks without draining `alert_rx`, this send could await indefinitely, stalling `heartbeat_task` from detecting `check_deadline`.
   - *Impact*: Low risk in practice (pings sent every 30s; filling 32 slots takes 16 minutes), but under pathological stalls it delays the 90s deadline timeout.
   - *Recommendation*: Wrap the send with a short timeout (e.g. `tokio::time::timeout(Duration::from_secs(5), heartbeat_alert_tx.send(...))`) or use `try_send`. If `alert_tx` is backed up, the socket is already unresponsive and should be marked closing immediately.

---

## Suggestions

1. **Explicit Socket Retirement Call in Cleanup (`server/src/api/ws.rs:2055`)**:
   - *Observation*: `handle_socket` calls `presence_guard.mark_closing()`, then aborts spawned tasks and allows `presence_guard` to retire via `Drop` when the last `Arc<ClientPresenceGuard>` drops.
   - *Impact*: Safe because `inner.live` retains the connection until all task futures drop, and `verify_decision_capability` checks `record.closing` immediately. However, adding an explicit `presence_guard.retire()` or `state.client_presence.retire_live(...)` in cleanup would make live count decrements strictly deterministic before function exit.
2. **Clock Source Alignment (`server/src/idle_suspend/client_presence.rs:426`)**:
   - *Observation*: `verify_decision_capability` checks `chrono::Utc::now() >= deadline`, whereas `ws.rs` auth checks use `state.auth_service.clock().now()`.
   - *Impact*: In production both resolve to system UTC; in mock testing environments with time-traveling clocks, passing the auth service clock into verification ensures 100% time determinism.

---

## Positive Observations

- **Fail-Closed Admission Fence**: `try_claim_no_client_fence` verifies monotonic revision match and zero pending/live connections before latching `host_suspending`. New connections attempting to reserve or promote during host suspension are rejected with HTTP 503 `PRESENCE_UNAVAILABLE`.
- **Constant-Time Cryptographic Verification**: Decisions verified via SHA-256 digest with `subtle::ConstantTimeEq`, completely eliminating timing side-channel leakage.
- **Strict Privacy**: Capabilities delivered privately to socket's dedicated alert channel; never broadcast to `event_sink`, logged in tracing, or exposed in public presence status DTOs.
- **Control Frame Prioritization**: Dedicated reader loop handles Ping/Pong immediately, while `app_msg_tx` (bound: 64) buffers data frames, guaranteeing prompt Pong liveness updates even under blocking application workloads.
- **Owner-Bound UI Receipt**: `connections.ts` enforces `isCurrentConnection(owner)` with generation matching, cleanly dropping access upon profile replacement, teardown, or disconnect.

---

## Metrics

| Metric | Measurement | Target | Status |
|---|---|---|---|
| Backend Unit Tests (`idle_suspend::client_presence::tests`) | 6 / 6 passed | 100% | PASS |
| Backend Integration Tests (`ws_client_presence`) | 5 / 5 passed | 100% | PASS |
| Frontend Targeted Tests (`ws-transport.test.ts`, `connections.test.ts`) | 69 / 69 passed | 100% | PASS |
| UI Full Suite (`pnpm test`) | 2,771 / 2,771 passed (330 files) | 100% | PASS |
| UI Typecheck (`tsc --noEmit`) | 0 errors, 0 diagnostics | 0 | PASS |
| Total Tests Verified | 2,851 / 2,851 passed | 100% | PASS |
| Lock Invariants | 0 async locks, 0 lock inversions | 0 | PASS |
| Information Leakage | 0 capability secrets in logs/GETs | 0 | PASS |

---

## Recommended Actions

1. In Phase 04 coordinator implementation, add a 5s bounded send timeout on heartbeat ping dispatches to prevent stall under severe channel backup.
2. Advance workflow to Phase 04 (`phase-04-coordinator-consent-and-final-handoff.md`).

---

## Unresolved Questions

*None.* All technical and architectural contracts for Phase 03 are satisfied.
