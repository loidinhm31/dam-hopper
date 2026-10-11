# Phase 03 — Public WebSocket presence, liveness and session binding

## Context links
- [Overview](plan.md), [contracts](contracts.md), [client research](reports/client-consent-research.md).
- Repository: `docs/api/websocket.md`, `docs/api/authentication.md`, `docs/code-standards.md`.
- Dependency: Phase 01. Independent of Phase 02; Phase 04 consumes both.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 8h.
- Implementation status: completed. Review status: approved (score: 9.6/10).
- Track actual public client sockets, not PTY attachments or broadcast subscribers.

## Key Insights
- `ws_handler` already performs full session/MFA/enabled-user evaluation before upgrade; `handle_socket` supervises periodic auth validation.
- No current public socket count or server-originated Ping/Pong liveness deadline in inspected sources.
- Writer failure currently can exit without cancelling reader; cleanup timeout does not explicitly abort writer. A reliable lifetime guard must cover these paths.
- Reader awaits long filesystem/request handlers; naively timing Pong processing can incorrectly drop a healthy socket.
- Private OMP listener is separate and must never count as UI presence.

## Requirements
- In-memory bounded live registry, membership revision and explicit unavailable/overflow state.
- Pending authenticated upgrades reserve an admission fence; become live only on successful upgrade; failed upgrade releases reservation.
- Live clients of every supported/old version count, including hidden tabs and authorized non-browser public `/ws` clients.
- Server-issued per-socket decision capability bound to actor/session/auth versions and deadline. No globally broadcast capability.
- Exact teardown on every exit, monotonic liveness, replacement-safe cleanup, and final shared admission fence.

## Architecture
- Create one narrow `idle_suspend/client_presence.rs` shared service in `AppState`; keep domain state out of the already large socket loop.
- Private record: opaque socket ID, capability digest, actor subject/session/version/deadline, socket generation/liveness and closing state. Public projection only live/pending counts, availability and revision.
- RAII pending guard -> live connection guard; closing revokes receipt and approvals before asynchronous task teardown.
- Existing writer remains sole socket sink owner; add bounded Ping control support. A supervised reader/control path must process Pong promptly even during application handlers.
- Admission gate serializes registry mutation against final automatic claim; it does not hold locks while authenticating or upgrading.

## Related code files

| Action | Full path | Change |
|---|---|---|
| Create | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/client_presence.rs` | Bounded registry, watch snapshot, RAII guards, receipt verification |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/mod.rs` | Private presence module wiring |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/state.rs` | Registry ownership and coordinator injection |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/ws.rs` | Upgrade reservation, live guard, heartbeat, unified cancellation/teardown |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/ws_protocol.rs` | Per-socket receipt and Ping wire support |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/ws-transport.ts` | Store current socket receipt, clear on replacement, expose subscription |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/connections.ts` | Exact-owner receipt/invalidation integration |

No files deleted. Existing authentication helpers reused, not replaced.

## Implementation Steps
1. Inspect all public socket admission/auth/writer/reader/pump/cleanup exits; enumerate startup/state fixtures and transport replacements through LSP references.
2. Implement bounded registry and monotonic membership revision. Select explicit connection cap consistent with server resource limits; on saturation refuse admission or mark presence unavailable, never silently stop counting.
3. After successful authentication and before upgrade scheduling, reserve the shared admission fence. Capture guard into upgrade callback; release on failed/cancelled upgrade through the actual Axum upgrade failure/drop path. Set a bounded pending-upgrade lifetime so abandoned handshakes do not leak permanent blockers.
4. In `handle_socket`, convert reservation to live before receipt/pumps start. Recheck host-suspending state under admission gate; reject/close post-commit arrivals rather than sending a false usable connection.
5. Generate high-entropy capability, store digest only, and send `host:uiConnection` receipt only to that socket's channel. Never through broadcast `event_sink`; no request/status/log path receives the secret.
6. Couple writer failure, reader failure, auth cancellation, heartbeat expiry, task cancellation and shutdown to one shared cancellation token. Revoke receipt/presence once when closing starts; explicitly abort/join leftover tasks after bounded cleanup.
7. Add proposed 30s Ping / 90s matching-Pong policy with monotonic deadlines. Reuse sole writer; ensure long FS work cannot starve control-frame reading. Preserve message ordering/backpressure and existing FS/PTY bounds; avoid unbounded task-per-frame dispatch.
8. Add exact-session/auth-version access for consent verification. Disable/revoke/MFA expiry/auth-store failure closes connection under existing fail-closed watcher rules; never convert failed auth into approval.
9. Store latest receipt inside exact `WsTransport` socket generation before forwarding events, so initial receipt survives late hook subscription. Clear on close/destroy/reconnect before a new socket can accept any decisions.
10. Expose captured-owner receipt lookup without ambient global fallback. Profile removal/replacement must invalidate only that owner.
11. Add behavior tests with real loopback websocket clients: accepted upgrade count, failed upgrade release, private reporter/SSE exclusion, writer-only failure, cancellation, heartbeat timeout, hidden/old browser Pong, auth revocation, two simultaneous users, old guard dropping after replacement and final admission races.
12. Extend receipt decoder tests for invalid/obsolete frames without pinning source text or testing mock echoes.

## Todo list
- [x] Bound registry and pending/live lifecycle.
- [x] Integrate public socket guard and exact cleanup.
- [x] Send/store per-socket capability receipt privately.
- [x] Qualify independent Ping/Pong supervision.
- [x] Bind auth/session/replacement invalidation.
- [x] Cover teardown and admission races with real sockets.

## Success Criteria
- Public live count matches real sockets after upgrade and returns to zero after every close path; pending upgrades block direct handoff without inflating live count.
- Private OMP sockets and SSE connections never count.
- Capability cannot be replayed on another socket/session, survives no reconnect and never reaches global status/broadcast.
- Writer failure/blackholed peer cleans up; hidden/old browser remains connected through protocol Pong.
- Connection admission before final commit forces consent; admission after irreversible dispatch cannot pretend to cancel sleep.

## Risk Assessment
- Delayed Pong processing during blocking dispatch: restructure bounded supervision before enabling deadline.
- Detached upgrade/writer task: guard lifetime and explicit cancellation, not a counter increment/decrement happy path.
- Multiple sockets per login session: capabilities bind exact socket; one tab closing cannot retire siblings.

## Security Considerations
- Existing query-token/cookie upgrade authentication unchanged. Do not add socket secrets to URLs, GET bodies, localStorage, telemetry or error details.
- Compare capability digest safely; enabled actor/session/version and live socket checked together. Client identity is not proof of consent.

## Next steps
- Phase 04 consumes presence watch and verified connection capability. Phase 05 consumes exact transport receipt.

## Unresolved questions
- Final resource cap and pending-upgrade timeout are repository/deployment engineering choices to freeze in Phase 01; neither may weaken fail-closed presence.
