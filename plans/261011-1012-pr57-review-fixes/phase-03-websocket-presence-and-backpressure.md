# Phase 03 — WebSocket presence and backpressure

## Context links
- [Overview](plan.md); [Phase 01 approved connection fence](phase-01-coordinator-admission-and-cooldown.md).
- [Original presence contract](../261010-1746-host-resources-auto-sleep/contracts.md#public-client-presence).
- [WebSocket API](../../docs/api/websocket.md); [architecture](../../docs/system-architecture.md#semantic-agent-free-automatic-sleep); [code standards](../../docs/code-standards.md#rust-backend).

## Overview
- Date: 2026-10-11. Priority: P1. Estimated effort: 6h.
- Implementation: complete. Review: complete. Validation: passed.
- Issues: **7** frame reader still blocks behind full data/control queues and has no explicit protocol byte bound; **8** unlocked watch publication can reorder membership snapshots.

## Key Insights
- Reader is separate from application dispatch, but `app_msg_tx.send(msg).await` (`ws.rs:421–427`) stops reading once 64 messages queue up. Ping forwarding also awaits `reader_alert_tx.send` (`411`). Dedicated task alone does not eliminate starvation.
- Upgrade (`ws.rs:250`) sets neither `max_message_size` nor `max_frame_size`; message-count cap does not bound allocated queue bytes.
- Applications must retain FIFO ordering: file writes/uploads use a JSON header followed by binary payload and stateful `pending_binary` (`ws.rs:626–644,694–712`). Never drop or reorder data, or spawn one task per frame.
- Current clients use 128KiB write/upload chunks (`ws-transport.ts:175,3609,3897`), but encrypted `fs:put_save` is a **single** blob (`3950–3986`). `crypto.ts:194–220` allows 100MiB plaintext plus metadata, nonce and tag; a blanket 128KiB socket cap would break supported behavior.
- Registry assigns revision N under its mutex, drops guard, then publishes (`client_presence.rs:363–368`). Another task can publish N+1 first, then N rolls the watch backward. `snapshot()` itself reads the watch (`477–479`), so this is not merely event ordering.

## Requirements
### Functional
- Reader never awaits data-queue capacity or control-channel capacity; overload explicitly retires/revokes socket rather than accumulating unbounded work or starving heartbeat.
- Under admitted workload, Pong/Close processing stays prompt even while application handler awaits; on sustained overload, prompt closing is correct behavior, not fabricated healthy presence.
- Explicit maximum assembled-message size, individual frame size, queue count and aggregate queued/in-processing bytes. Preserve supported chunked and single-frame encrypted writes.
- All membership/fence/public-availability mutations publish monotonically ordered snapshots, including prune changes on error branches.
- Normal reconnect, auth revocation, heartbeat deadline, EOF/writer failure and overflow clean up guards exactly once.
### Non-functional
- One reader, one sequential application dispatcher, one sole sink writer. No unbounded control queue or task-per-message fanout.
- Keep existing stable close/auth codes and private receipt delivery; public watch remains the current aggregate, not authority over exact socket binding.
- No synchronous lock held across `.await`, and no leaked permits on errors/cancellation.

## Architecture
### Bounded inbound reader
Use existing channels and overload teardown, plus a small queued-message wrapper carrying an owned byte-budget permit.

Recommended concrete starting bounds, chosen to preserve existing 100MiB content operations:
- `MAX_WS_MESSAGE_BYTES = 128 * 1024 * 1024` for assembled Text/Binary; `MAX_WS_FRAME_BYTES` same upper bound so existing single-frame encrypted text saves remain valid.
- `APP_MSG_CAP = 64` retained; `APP_MSG_BYTE_BUDGET = 128 * 1024 * 1024` across queued **and currently dispatched** data. This prevents 64 maximum messages consuming 8GiB per socket.
- These are transport ceilings, not new file-size allowances: existing filesystem decrypted-content cap (100MiB), identifier validation, upload quotas and auth/path fences still apply.
- Explicit frame/message limits bound adapter assembly/fragmentation allocations. The queue budget does not include the currently decoded reader frame or existing decrypt buffers; document these additional bounded allocations rather than claim a 128MiB total process-memory guarantee.

On Text/Binary:
1. Inspect length without cloning payload; acquire byte permit nonblocking (`len.max(1)` to bound zero-length message count independently), then `try_send` wrapper.
2. Full queue, insufficient byte capacity or disconnected dispatcher → mark presence closing immediately, cancel peers, request existing overflow close best-effort and exit reader. Never discard a binary payload while keeping its socket alive.
3. Dispatcher preserves FIFO and holds permit until handling completes; Drop releases permit on ordinary completion, queue teardown and cancellation. No semaphore await in reader.

On Ping/Pong/Close:
- Refresh current liveness under existing policy; Pong/Close do no application dispatch. Forward required Pong using `try_send`, not await; saturated control/alert channel also fails closed promptly through existing teardown.
- Keep sole writer ownership. Best-effort close frame must not itself block revocation. Healthy hidden/old browsers still use ordinary protocol Pong; no JavaScript presence heartbeat introduced.
- Scope is starvation and byte bounds. Do not redesign heartbeat nonce policy, rate limiter, outbound scheduling or message protocol while fixing this issue.

Configure Axum upgrade limits before `on_upgrade`; keep authenticated reservation and failure-drop semantics. Protocol rejection/oversized frame must retire any promoted live guard; a failed upgrade must release pending guard.

### Ordered presence publication
Prefer serialization over stale-snapshot CAS:

- Add `publish_inner(&RegistryInner)` using `status_tx.send_replace(snapshot_inner(inner))` while caller still holds the membership mutex. No await, user callback or expensive I/O; snapshot is a tiny DTO.
- Route **every** membership mutation through this same helper: reserve, promote, duplicate/promotion error after removal, pending release/prune, closing, retire, host-suspending and zero-client claim; Phase 01 approved fence uses it too.
- If a mutation prunes expired reservations then returns an admission/fence error, publish the pruning revision before return. Otherwise current watch can remain stale even without a reorder.
- Mutations are linearized under presence mutex; publication completes before another mutation can publish. watch may coalesce N → N+2, but never N+2 → N+1.
- Liveness-only `record_pong` remains nonpublishing because it does not alter membership DTO.
- Receivers borrow/clone/drop watch refs before calling registry mutators; never retain `watch::Ref` while taking the registry mutex, preventing mutex/watch lock inversion.
- No second mirror registry, publisher task, unbounded event queue or revision-reset rule. Exact binding checks and fences read `inner`, not a potentially coalesced watch snapshot.

## Related code files
| Action | File and researched lines | Purpose |
|---|---|---|
| Modify | `server/src/api/ws.rs:43–52,132–251,378–433,435–472,659–668,2059–2082` | Upgrade bounds, nonblocking reader admission, byte permits and unified overflow cleanup |
| Modify | `server/src/idle_suspend/client_presence.rs:192–262,265–368,461–494,503–549` | Serialize all publication with mutation, including prune/error branches |
| Modify | Colocated presence tests in `server/src/idle_suspend/client_presence.rs` | Concurrent publication, all mutation paths, revision/count consistency |
| Modify | `server/tests/ws_client_presence.rs:54–109,134–370` | Extend real loopback socket tests for overflow, limits, liveness, cleanup |
| Modify | Colocated WS tests in `server/src/api/ws.rs` | Deterministic reduced-capacity reader and byte-wrapper lifecycle tests |
| Reference / intentionally unchanged | `packages/ui/src/api/ws-transport.ts:175,3380–3405,3608–3630,3896–3926,3950–3993` | Preserve actual client FIFO/chunk/single-save behavior; change only if integration reveals an incompatible bound |
| Reference / intentionally unchanged | `packages/ui/src/lib/crypto.ts:17–44,194–220` | Account for metadata + nonce/tag framing above plaintext cap |
| Modify | `docs/api/websocket.md`, `docs/system-architecture.md:273–289`, `docs/terminal-idle-suspend-security.md`, `docs/CHANGELOG.md` | Explicit inbound limits, overload close policy, ordered watch semantics |

No production file additions/deletions required. Remove misleading starvation-free comments tied to blocking send paths; no deprecated alias or alternate publication convention.

## Implementation Steps
1. Enumerate every registry `send_replace`/revision mutation and every reader await. Confirm maximum legal current wire payloads with actual plaintext/encryption framing and existing FS APIs before selecting final constants.
2. Introduce explicit upgrade frame/assembled-message ceilings and count+byte queue wrapper. Keep client-compatible limits above 100MiB encrypted saves; pass owned payloads without unnecessary copies.
3. Replace data/control enqueue await with bounded nonblocking admission and one common overflow revocation/cancel path. Hold byte permit through sequential handling and ensure queued work cannot continue after socket closing.
4. Refactor registry publication under its existing mutex. Include successful, duplicate, capacity/fence error and prune-only branches; preserve exact-once RAII removal semantics.
5. Coordinate `client_presence.rs` ownership: Phase 03 lands publication contract first; Phase 01 approved fence composes the same helper. Never merge independent locking conventions.
6. Add deterministic unit/concurrency tests plus real loopback socket coverage; use explicit barriers and reduced private test capacities, not 90-second sleeps or timing-dependent flooding.
7. Validate representative regular/large/encrypted file operations preserve header/binary FIFO and size allowances; oversized fragmented messages fail at aggregate limit.
8. Update normative docs/changelog; main agent performs targeted and full qualification only after integrated edits.

## Todo list
- [x] Bound upgrade frame/assembled-message sizes and inbound aggregate bytes.
- [x] Make reader data/control enqueues nonblocking with fail-closed overflow.
- [x] Keep sequential protocol dispatch and release owned budget permits everywhere.
- [x] Serialize every presence watch publication with its membership mutation.
- [x] Cover real sockets, concurrent watch revisions, large writes and teardown.

## Success Criteria
| Regression | Required observable result |
|---|---|
| Slow application handler, subcapacity data backlog, Pong/Close arrives | Control handled promptly; no false heartbeat timeout; Close revokes capability immediately |
| Full data count queue or byte budget | Socket marked closing promptly; receipt invalid; no enqueue wait and no later queued commands dispatched |
| Saturated control/alert queue during Ping | Prompt bounded cancellation, not reader waiting forever |
| Oversized Text/Binary frame or fragmented assembled message | Rejected/closed; no application mutation or live guard leak |
| Boundary-size legal single encrypted save / ordinary chunks | Supported save succeeds; JSON/binary pairs remain ordered and correctly associated |
| Byte wrapper drops on success/error/cancel | Budget recovered exactly once; no retained allocation/permit leak |
| Concurrent reserve/promote/close/retire/claim | Observed watch revisions never decrease; final DTO equals authoritative membership snapshot |
| Prune followed by admission/fence rejection | Latest pruned revision/counts published; no stale pending-zero observation |
| Exact socket fence under watch coalescing | No stale count substitutes for current original-socket liveness |
| Normal auth/EOF/writer failure/private reporter/SSE cases | Existing exclusion, cancellation and guard behavior preserved |

Main-agent commands after integration: `cargo test --manifest-path server/Cargo.toml --lib client_presence`; colocated WS reader tests; `cargo test --manifest-path server/Cargo.toml --test ws_client_presence`; then full server suite. Planner runs none. Real-socket tests complement deterministic queue tests; neither claims hardware suspend.

## Risk Assessment
- **Compatibility:** low transport limits would break 100MiB encrypted saves. Retain 128MiB transport allowance, independently keep FS content cap; test encryption metadata overhead at boundary.
- **Resource multiplier:** per-socket queue budget is not a global memory guarantee with 1024 clients. Explicit assembly+queue bounds fix this issue; do not imply aggregate DoS is solved or introduce an unrelated global scheduler.
- **Healthy burst closes:** deliberate overload policy trades availability for bounded memory/control responsiveness. Preserve normal four-in-flight upload workload; exercise it before adopting bounds.
- **Watch deadlock:** publication while membership locked is safe only when consumers drop watch borrow before calling mutators. Audit internal subscribers/tests and document the rule.
- **Cleanup races:** reader/writer/heartbeat all revoke same guard. Keep closing/retire idempotent and abort/join existing tasks using established bounded cleanup.

## Security Considerations
- Bound payloads before expensive JSON/file/crypto work; malformed/oversized fragmented frames cannot accumulate beyond adapter limits.
- Overflow immediately removes approval authority, even if peer has unread data or its writer cannot flush Close.
- Never silently drop data that could attach a later binary frame to the wrong header/path. No concurrent dispatcher that bypasses per-socket ordering.
- Keep auth/session/origin guards, constant-time capability checks and private receipt channels untouched. Logs contain bounded reason codes, not payloads or capabilities.

## Next steps
Deliver ordered presence/fence helper contract to Phase 01 and run its approver-loss/zero-client races against real socket lifecycle. Phase 04 consumes actual connection counts/receipts without fabricated host elements.

## Unresolved questions
None blocking. Deployment-wide memory admission is not part of this ten-issue remediation.
