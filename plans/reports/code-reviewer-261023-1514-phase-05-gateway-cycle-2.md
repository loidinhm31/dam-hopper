# Code Review Cycle 2 — Phase 05 Authenticated Semantic WebSocket Gateway

Score: **5/10**. Cycle-1 items mostly implemented at code level (IDs, URI grammar, filtering, epochs, identity, descriptor). BUT new teardown bug leaks child trees (probe-proven), slow-consumer timeouts have no teardown effect, close-code delivery racy. NOT ready to mark Phase 05 complete. Plan todo list left unchecked (blockers below); plan file not edited.

## Scope
- Reviewed: `server/src/api/semantic_ws.rs` (520), `semantic/gateway.rs` (1193), `semantic/uri.rs` (641), `semantic/supervisor.rs` + `session.rs` diffs, `semantic/mod.rs`, `api/{router,mod,ws}.rs` diffs, `Cargo.toml`, `tests/semantic_websocket.rs` (765), `tests/common/{mod,semantic_fixtures}.rs`. Spec: `plans/260901-1000-lsp-server-integration/phase-05-authenticated-semantic-websocket-gateway.md`. Cycle 1: `plans/reports/code-reviewer-261023-1514-phase-05-gateway.md`.
- Temp probe test `server/tests/zz_probe.rs` used for evidence, then deleted (confirmed gone).

## Cycle-1 fix verification (task checklist 1–10)
| # | Item | Status |
|---|------|--------|
| 1 | Slow-consumer timeouts (writer `ws_sink.send`, reader `outbound_tx.send`) | Timeouts present, **consequence broken** → C2 |
| 2 | Presence promoted; liveness | Promoted OK (`semantic_ws.rs:265`). No server ping; see W2. Shares `/ws` 1024 cap (W6) |
| 3 | Internal ids 1_000_000+, dup reject, shape/≤64B | Implemented; edge issues W3, W4 |
| 4 | Canonical URI: split-then-decode per segment, `%2F/%5C/%00/./..//` rejected, round-trip | Implemented; interop issue W5 |
| 5 | Location filter, `outsideTarget`, multi-result kept | Implemented; minor S4 |
| 6 | Close codes 4401/4403/1013 from watcher | Code passes code, **delivery racy** (probe) → W1 |
| 7 | `release_connection` | Exists; **skipped when gateway Terminated** → C1 |
| 8 | `didChange` strict parse | Rejects w/o advancing version; residual hazard W7 |
| 9 | Target identity recheck | Done at initialize + every navigation (`gateway.rs:390-413,787-810`) ✔ |
| 10 | Descriptor exact `"typescript"` | ✔ (`gateway.rs:262-274`) |

## Critical

**C1. `teardown()` early-returns on `Terminated` → child tree + epoch entry leak (probe-proven).**
`gateway.rs:1106-1109`: `if Terminated { return }` skips `invalidate_connection` and `release_connection`. `Terminated` is set from paths that do NOT close the session:
- `handle_exit` (`:1089-1103`): `mem::replace(.., Terminated)`; only `ShuttingDown` arm closes the session. `Ready`/`Initializing` + `exit` → handle dropped, session still registered in supervisor, lifecycle Terminated, teardown no-op.
- `send_outbound` timeout (`:1125-1134`) sets `Terminated` without cleanup.
Any authenticated user: attach → initialize → didOpen → `exit` → disconnect ⇒ session persists (idle eviction needs 0 open docs, `session.rs:895-897`). Cap is 2 global trees → trivial DoS.
Evidence (probe, real socket + mock TSLS): (a) `initialize,initialized,didOpen,exit,close` ⇒ `active_sessions` stays **1** 2s after disconnect; control (initialize + disconnect) ⇒ 0. (b) slow-consumer: 70×1 MB invalid-id navigation requests, client never reads, 8s later client drops ⇒ `active_sessions` **1** after drop.
Fix: teardown must always run `invalidate_connection` + `release_connection` (idempotent, drop the early return); `handle_exit` must `close_session` regardless of state (or just transition and let teardown reap); `send_outbound` failure must signal cancel (see C2).

**C2. Slow-consumer detection does not terminate the socket.**
- `send_outbound` (`gateway.rs:1125`) treats only `Elapsed` as failure: `timeout(..).await.is_err()`. `Ok(Err(SendError))` (writer already dead/queue closed) is silently ignored. On Elapsed it only flips lifecycle; reader loop (`semantic_ws.rs:440-510`) never breaks.
- Completion workers (`gateway.rs:993,1002,1011,1020,1029`) and rate/binary replies (`semantic_ws.rs:458,481`) `let _ =` the result.
- Writer exits after one 2s send timeout (`:302-304`) but nothing cancels the reader. Reader stays alive as long as client sends any frame within 60s (timer re-armed each message; Ping resets). A non-reading client sending a ping every <60s holds the connection and its tree indefinitely.
Fix: give gateway a `cancel_tx` (or return `GatewayError::OutboundClosed` and have reader `break` on it); add `_ = outbound_tx.closed()` / writer `JoinHandle` completion arm in reader select; workers cancel on failure. Combined with C1 fix, teardown then reaps.

## Warnings

**W1. Close frame racy/lost on live-auth cutoff (probe-proven 2/3 runs).** Reader exits on cancel → `teardown()` → `writer_task.abort()` (`semantic_ws.rs:518`) can pre-empt the writer's Close send. Probe of the existing revocation scenario, 3 runs: 1× `Close(4401)`, 2× stream ended with no close frame. Existing test accepts `Close(_) | None` and never asserts code, so it cannot catch this. Fix: after teardown, `timeout(SOCKET_SEND_TIMEOUT, writer_task).await`, abort only on expiry; abort watcher before `teardown` too (W8). Assert code 4401/4403/1013 in tests.

**W2. No server heartbeat; healthy idle clients dropped at 60s.** Browsers cannot originate WS pings; server never pings; reader `timeout(60s)` (`:446`) closes any tab idle >60s (no edits/navigation). `/ws` uses 30s ping / 90s deadline (`client_presence.rs:29-32`). Add periodic `Message::Ping` from writer (≈25-30s); client Pong (already counted as activity) keeps alive; call `presence_guard.record_pong()` on Pong. Presence `last_liveness` currently never refreshed (harmless today; nothing consumes it outside tests/`/ws`).

**W3. Cancelled request answered with `id:null`.** `handle_cancel_request` (`gateway.rs:1038-1056`) removes both id maps; session replies `Ok(Null)` (`session.rs:735`); worker does `map.remove(&internal_id).unwrap_or(Null)` (`:974`) ⇒ client receives `{"id":null,"result":null}`; original id never resolved. Code-read, not probed. Fix: keep mapping until worker completes (cancel only signals session), reply `RequestCancelled` (-32800) with original id.

**W4. Invalid request-id echoed verbatim (up to 4 MiB).** `gateway.rs:733-736` `json_rpc_error(v.clone(), ..)`. Defeats "cap request IDs" and is an output-amplification path (my slow-consumer probe used it: 70×1 MB in → 70×1 MB out). Reply with `id: null`. Also: navigation without `id` (notification) falls to `Value::Null` id and gets a response + dup-detect on null (`:743`); drop silently or reject.

**W5. URI canonical form not compatible with `encodeURIComponent`/Monaco `Uri`.** Encode set (`uri.rs:29-41`) leaves `[ ] @ + , = : $ & ; ^ |` raw; parser demands exact equality with that form. Probe: `[id].tsx` canon `.../[id].tsx` OK, but `%5Bid%5D.tsx` REJECTED; same for `a%2Bb.ts`, `%40types/x.d.ts`, `a%2Cb.ts`, `a%3Db.ts` (all realistic TS names: Next.js `[id].tsx`, `@types`). Also bijection hole: `a:b.ts` → server emits `.../a:b.ts` (`file_uri_to_virtual_uri`) but `parse_virtual_uri` rejects it via drive-letter check (`uri.rs:166`) — server issues URIs it refuses. Fix: pick RFC3986-unreserved-only encode set (`A-Za-z0-9-._~`), document exact grammar for Phase 07 client, apply drive-letter rule only to first segment or drop it (Linux-only), add unit tests for these names.

**W6. Presence cap shared with `/ws`.** Spec Success l.104 "semantic pressure never consumes /ws capacity". Semantic sockets reserve/promote into same registry (1024 pending+live) and count in idle-suspend `connection_count`. Decision (promote) is defensible for presence semantics but no dedicated semantic cap exists (per-user/global). Needs explicit decision/doc or own bounded cap.

**W7. didChange / didOpen failures swallowed → silent overlay divergence.** Malformed event batch dropped with only `warn!` (`gateway.rs:654-660`); `did_open/did_change/did_close` results `let _ =` (`:613,680,715`). Overlay accepts any monotonic version (`overlay.rs:294`), not +1. If edit v5 is dropped/failed (bad range, limit) and client sends incremental v6 on its true base, overlay applies to stale text yet `damHopperDocumentVersion` fence (6) passes ⇒ navigation on wrong content. Cycle-1 asked to reject message AND invalidate/close doc. Fix: on any rejected/failed change, drop overlay for that URI (didClose) + send error notification, or close socket (policy violation).

**W8. Watcher/teardown ordering can recreate epoch entry.** `semantic_ws.rs:511-518`: `teardown()` (release) runs before `auth_watcher_task.abort()`. Watcher mid-lookup (≤2s) can then call `invalidate_connection` → `entry().or_insert` → leaked entry for a dead connection. Abort watcher first (or await it) then teardown.

**W9. CI gate fails: rustfmt.** `.github/workflows/pr-quality-gate.yml:171-176` runs `rustfmt --check` on changed server files. Diff counts: `gateway.rs` 14, `uri.rs` 14, `tests/semantic_websocket.rs` 29, `router.rs` 2 (import order `workspace, ws, semantic_ws`), `supervisor.rs` 1. `semantic_ws.rs` clean. Run `cargo fmt`/`rustfmt` on those.

**W10. Carry-overs from cycle 1 still open (not in cycle-2 list):** auth/Origin/live-watcher logic still copy-pasted from `ws.rs` (~270 LOC; spec Todo "Reuse exact … decisions"); `MAX_QUEUED_BYTES` not enforced on outbound channel (32×≤4 MiB); rate-limit never disconnects and message hard-codes "40 msg/s, burst 80" with code −32004 reused for `IN_FLIGHT_FULL` (`semantic_ws.rs:454-455`); binary/ping not rate-limited (binary consumes token but is never rejected); child server-requests answered `Null`/`[{}]` (`session.rs:754-759`); `msg.get("params").cloned()` 4 MiB copy (`gateway.rs:191`); blocking `exists/canonicalize/directory_identity` on async worker; `candidate.exists()` follows dangling symlinks (`uri.rs:206`).

## Suggestions
- S1. `filter_location_or_link_result` can no longer return `Err`; drop `Result` + `.unwrap_or(Value::Null)` (`gateway.rs:986`) — dead path.
- S2. `outsideTarget` wire shape: all-outside array becomes object `{"outsideTarget":true}` (not array/null). Document for Phase 07 client; mixed result (some outside) emits no marker. Non-object/unknown array items count as `outsideTarget` (`uri.rs:384` `Ok(None)` → `had_outside`), misclassification — distinguish malformed vs outside.
- S3. No result-count cap in `filter_location_or_link_result`.
- S4. `GatewayError` never returned (all handlers `Ok`); `#[allow(dead_code)] actor`; `TargetBinding.root_identity` now used (attribute removable, check `:85`).
- S5. Dup `invalidate_connection` in `teardown` + caller was removed — good; keep single owner.
- S6. `target_generation` hard-coded 1 (`supervisor.rs:255`) — Phase 08.

## Tests: coverage gaps (Phase todo "Prove real-socket slow-consumer, revocation and zero-tree cleanup" NOT met)
Existing: 6 integration tests pass. Missing: slow consumer / full queue / session reap after disconnect; exit-without-shutdown; revocation with attached child + zero-tree assertion; close-code assertion (4401/4403/1013); MFA/expired/disabled/backend-timeout live branches; duplicate/invalid/oversized id; cancel response; `%2F`, `%5C`, `//`, `./`, `[id].tsx` over wire; `outsideTarget` payload over wire; malformed didChange then nav; 4 MiB oversize; dev no-auth path; epoch map size after disconnect (needs test accessor). `test_rate_limiting_and_binary_rejection` does not test rate limit.

## Positive
- Cancellation-first ordering (invalidate → close info → cancel) correct; supervisor lock ordering sound; runtime+connection epoch rechecked under sessions write lock.
- Writer close and watcher close-code plumbing correct (`watch<Option<(u16,String)>>`).
- URI parser: split-before-decode, per-segment checks, canonical round-trip, strong unit tests (37 semantic lib tests pass).
- Internal id allocation separated from child counter; dup rejection and RAII in-flight guard good.
- Fixed generic error strings replaced raw `{e}` interpolation for spawn/init errors.
- Identity recheck per navigation; strict descriptor.

## Validation
- `cargo test --lib semantic::` → 37 passed, 0 failed.
- `cargo test --test semantic_websocket` → 6 passed (5.9s). Note: test passes on revocation even when close frame lost (see W1).
- `cargo clippy --all-targets` → 0 warnings in reviewed semantic files (only pre-existing `agent_status/reducer.rs:791`).
- `rustfmt --edition 2021 --check` per-file → fail (counts in W9); `semantic_ws.rs` clean.
- Probes (temp `tests/zz_probe.rs`, deleted): `exit`-then-disconnect → sessions 1 (leak); control disconnect → 0; slow-consumer flood → sessions 1 after client drop; revocation close code 3 runs → 4401 / none / none; URI probe → W5 table. Not run: full `cargo test`, Mongo-dependent suites.

## Recommended order
1. C1 + C2 (teardown always reaps; outbound failure cancels reader; handle_exit closes session) + add regression tests (zero-tree after exit/slow-consumer/revoke).
2. W1 (await writer before abort; assert close codes), W8, W7, W3, W4.
3. W5 URI grammar decision + tests; W2 ping; W9 fmt.
4. W6/W10 carry-overs.

## Unresolved questions
1. Presence: keep semantic sockets in shared `/ws` presence (affects idle-suspend count + 1024 cap) or give dedicated cap? Spec l.104 ambiguous vs "presence admission".
2. `outsideTarget` exact wire shape for Phase 07 (flag object vs error vs sentinel); mixed-result marker needed?
3. Should URI canonical encode set be unreserved-only (matches Monaco/encodeURIComponent) — client contract owner?
4. Should a rejected didChange/didOpen close the doc or the socket (W7)? Error notification shape undefined.
5. G3–G5 gates status unchanged (destination freshness for unopened files unproven) per tester report.
