# Code Review Cycle 3 — Phase 05 Authenticated Semantic WebSocket Gateway

Score: **6/10**. Both Cycle-2 criticals (C1 leak-on-exit, C2 slow-consumer) closed + probe-verified; W1, W5, W8, W9(phase files) closed. BUT W3, W4, W7 reported fixed are NOT fixed in tree (probe-proven), reader still outlives dead writer, and a workspace-wide `cargo fmt` rewrote 175 unrelated files. No Critical. NOT ready to mark Phase 05 complete (3 must-fix + churn decision). Plan todo list left unchecked; plan file not edited.

## Scope
- Reviewed: `server/src/api/semantic_ws.rs` (522), `semantic/gateway.rs` (1180), `semantic/uri.rs` (697), diffs of `semantic/{supervisor,session,mod}.rs`, `api/{router,mod,ws}.rs`, `Cargo.toml`, `tests/semantic_websocket.rs` (887, 7 tests), `tests/common/{mod,semantic_fixtures}.rs`, `tests/fixtures/lsp-test-server.mjs`. Spec: `plans/260901-1000-lsp-server-integration/phase-05-authenticated-semantic-websocket-gateway.md`. Prior: `…-gateway.md`, `…-gateway-cycle-2.md`.
- Temp probe `server/tests/zz_probe3.rs` (real socket + mock TSLS) used, then deleted (confirmed gone).
- Advisor consulted on draft; severity raised for W3/W4/churn (adopted below).

## Cycle-2 fix verification
| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | C1 `teardown()` unconditional (invalidate+release), called on exit + outbound timeout | **FIXED** | `gateway.rs:1105-1117` no early return; `handle_exit` `:1099`; `send_outbound` `:1120-1128`. Probe1: init+didOpen → sessions 1; after `exit` → 0 (socket still open); after drop → 0, presence 0 |
| 2 | C2 slow-consumer reaps tree | **FIXED (tree)** / residual socket issue → W-A | Probe4: 70×1 MB invalid-id requests, client never reads, pings every 4s: sessions 0 at t=4s..24s, after drop 0 |
| 3 | W1 close frame delivery: bounded wait before abort | **FIXED** | `semantic_ws.rs:517-521` `timeout(SOCKET_SEND_TIMEOUT, writer_task)`; probe5 revocation 5/5 runs `Close(4401,"Session revoked or account modified")` (cycle 2: 1/3) |
| 4 | W3 cancel keeps client id | **NOT FIXED** | W-B |
| 5 | W4 invalid id not echoed | **NOT FIXED** | W-C |
| 6 | W5 URI grammar (unreserved check; `[id].tsx`, `@types`, `a+b.ts`) | **FIXED** (parse side) | `uri.rs:153-182` rejects `%`-encoded RFC3986 unreserved only; unit `test_parse_complex_valid_names` (`%5Bid%5D.tsx`, `[id].tsx`, `@types/node.d.ts`, `a+b.ts`); drive rule now 2-byte segment only (`:203-206`) |
| 7 | W7 didOpen/didChange failure closes overlay | **PARTIAL** | W-D: only actor-returned errors close doc |
| 8 | W8 abort watcher before teardown | **FIXED** (see S1) | `semantic_ws.rs:513-517` |
| 9 | W9 rustfmt | **FIXED for phase files** / churn → W-E | `rustfmt --edition 2021 --check` on all phase files → exit 0 |

## Critical
None.

## Warnings (must-fix before closing phase)

**W-B (High). Cancelled request answered with `id:null` — W3 unresolved (probe-proven).**
`handle_cancel_request` (`gateway.rs:1048-1063`) removes both id maps, then session `do_cancel_request` replies `Ok(Value::Null)` (`session.rs:731-733`); worker `map.remove(&internal_id).unwrap_or(Value::Null)` (`gateway.rs:977`) → `{"id":null,"result":null}`. Original id never resolved; client cannot match → pending promise hangs. Probe2: 40× (definition + `$/cancelRequest` back-to-back) → 40 replies, **20 with `id:null`**.
Fix: cancel must NOT touch maps; worker is sole owner of removal. Make `do_cancel_request` reply `Err(SessionError::Cancelled)` (new) → worker emits `-32800 RequestCancelled` with original id. Also validate cancel `params.id` same as request ids.

**W-C (High). Invalid request id echoed verbatim; notification-style navigation gets reply — W4 unresolved (probe-proven).**
`gateway.rs:735-736` `json_rpc_error(v.clone(), …)`. Probe2: 300 KB string id → 300 181-byte reply (cap 4 MiB in → 4 MiB out; amplification path). Also `None => Value::Null` (`:745`): nav without `id` returned `{"id":null,"result":{"outsideTarget":true}}` — JSON-RPC forbids replying to notifications, and Null id participates in dup-detect.
Fix: invalid id → reply `id: null`; id absent on definition/implementation → drop silently (debug log). Same for other handlers that use `req_id.unwrap_or(Null)` for request-only methods (attach/initialize/shutdown reply to notification form — low).
Note: client id never reaches child (internal ids 1_000_000+ passed via `submit_navigation`, `gateway.rs:913`), so child-side collision concern is N/A.

**W-D (Medium). didOpen/didChange pre-actor rejections leave overlay stale — W7 partial (probe-proven).**
Only `Err` from `handle.did_open/did_change` closes the doc (`gateway.rs:615-621, 680-686`). These return silently with overlay unchanged: malformed `contentChange` item (`:657-659`), missing `version`/`contentChanges` (`:643-651`), missing/ill-typed fields in didOpen. Probe3: didChange v2 with `range:"bad"` → dropped; nav fenced @v2 → STALE (current 1) and nav @v1 still served → overlay alive at v1 while client believes v2. Fails safe for now (fence mismatch), but a following valid incremental v3 would be applied on stale v1 text if overlay accepts any monotonic version (`overlay.rs` monotonic, not +1 — NOT probed). Spec/Cycle-1 asked: reject AND invalidate doc.
Fix: once `file_url` resolves, any rejection (parse, missing field, actor error) → `did_close(file_url)`; if URI itself invalid nothing to close.

**W-A (Medium). Reader loop survives dead writer; socket + presence slot held (probe-proven).**
After slow-consumer teardown the writer exits (`semantic_ws.rs:302-304`) but reader select (`:440-509`) has no arm for writer death. `send_outbound` only handles `Elapsed`, ignores `Ok(Err(SendError))` (closed queue) (`gateway.rs:1122-1128`). Probe4: authenticated non-reading client pinging every 4s: `presence=1` for 24 s+ (sessions 0). Each Ping re-arms the 60 s timeout (`:446,487`), so indefinite. Impact: holds a shared 1024-cap presence slot + idle-suspend `connection_count` (blocks idle suspend), reader task, gateway. Tree no longer leaks.
Fix: add `_ = outbound_tx.closed() => break` (or await `writer_task` handle) arm in reader select; treat `Ok(Err(_))` in `send_outbound` same as timeout and make worker/rate-limit/binary reply sites (`semantic_ws.rs:458,481`, `gateway.rs:993+`) not `let _ =`.

**W-E (High, scope/merge). Workspace-wide `cargo fmt` touched 175 unrelated tracked files.**
`git diff --shortstat`: 184 files, +13 784/−11 270 vs ~130 lines in Phase-05-owned tracked files (Cargo.toml/lock, router, api/mod, ws.rs 1-line visibility, semantic/{mod,session,supervisor}, tests/common/mod.rs). 13 files also flipped CRLF→LF (`i/crlf w/lf`: `src/system/monitor.rs`, `tests/ws_fs_subscribe.rs`, `src/config/parser.rs`, `src/lib.rs`, `src/pty/session.rs`, …). With `-w --ignore-cr-at-eol` still +4551/−2037 = rustfmt layout churn in 178 files (code-semantics unchanged, e.g. `hook_ingress.rs` line rewraps). Not whitespace-only, so don't blanket-revert blindly (confirm none carry real work). CI gate `pr-quality-gate.yml:171-176` only checks changed files, so churn is not required — it just buries the phase diff, inflates review, and conflicts with parallel branches (stash `feat/cloudflared-persistence-reminder` exists).
Fix: restrict diff to Phase-05 files; restore the other 175 (main agent's decision; I did not touch them).

**W-F (Medium). Test coverage does not guard the cycle-2/3 fixes.** 7 integration tests (up from 6 incl. reap-on-disconnect). Still missing: `exit` → zero-tree (C1), slow-consumer reap + dead-writer socket close (C2/W-A), close-code assert (cutoff test accepts any `Close(_)|None`, `:806`, never attaches a child, so no zero-tree under revocation), cancel response id (W-B), invalid id (W-C), malformed didChange (W-D), nav result assertions (nav test only checks `id`; probe3 shows in-target `src/main.ts` returns `outsideTarget:true` from echo fixture, so result mapping is effectively unasserted), live branches MFA/expired/disabled/backend-timeout, oversize 4 MiB, dev no-auth, `%2F/%5C//` over wire, epoch-map size after disconnect. `test_rate_limiting_and_binary_rejection` still doesn't test rate limit. Spec todo "Prove real-socket slow-consumer, revocation and zero-tree cleanup" unmet.

## Suggestions
- S1. W8: `task.abort()` not awaited (`semantic_ws.rs:513-515`); a watcher polled concurrently could still run one `invalidate_connection` (re-inserting epoch entry after release). Narrow; `let _ = task.await` after abort makes it deterministic. Also `release_connection` → `get_connection_epoch` defaults to `1` (`supervisor.rs:~135`): invalidate(2)→release→default 1 equals an old captured epoch 1 (ABA). Unreachable today (admission awaited sequentially by reader before teardown) but fragile; tombstone/monotonic counter closes it.
- S2. `timeout(SOCKET_SEND_TIMEOUT, writer_task)` on expiry detaches (no abort); writer self-bounded at 2 s + 2 s so OK; add explicit `abort` for spec wording.
- S3. After `exit` socket stays open; later messages get "not ready"/"already initialized"; acceptable, or close with 1000.
- S4. URI: emit side (`PATH_SEGMENT_ENCODE_SET`, `uri.rs:29-41`) leaves `[ ] @ + , = : $ & ; ^ |` raw while parser accepts both raw and `%XX` (lowercase/uppercase hex both) → several wire spellings per document. Identity safe (overlay keyed by file URL) but Phase 07 client string-compare of returned URIs vs Monaco-normalised model URIs must use parse-then-compare; document it. Add unit tests for `%40types`, `%2B`, `%2c`; file named `a:` or containing `\` is emitted but refused (`:199,203-206`) – rare.
- S5. Carry-overs from cycle 2 W10 unchanged: auth/Origin/live-watcher ~270 LOC copied from `ws.rs` (DRY, spec "share decision functions"; only `websocket_origin_allowed` made `pub(crate)`); `MAX_QUEUED_BYTES` unenforced on outbound mpsc (32×≤4 MiB); rate-limit never disconnects, hard-coded "40 msg/s, burst 80", `-32004` reused for rate/in-flight; binary consumes token but unrestricted; `msg.get("params").cloned()` 4 MiB copy (`gateway.rs:191`); blocking `exists/canonicalize/directory_identity` on async worker (`uri.rs:235,288`, `gateway.rs:319,391,792`); dangling symlink bypasses `exists()` branch (`uri.rs:235`); child server-requests answered `Null`/`[{}]`.
- S6. `outsideTarget` wire shape `{ "outsideTarget": true }` for an LSP `Location|Location[]` result is non-standard; document for Phase 07. `GatewayError` still never returned; `#[allow(dead_code)] actor`; `filter_location_or_link_result` can no longer `Err` (`.unwrap_or(Null)` dead path `gateway.rs:986`).
- S7. Presence decision (shared `/ws` registry) still undocumented vs spec "semantic pressure never consumes /ws capacity" (see W-A impact).

## Positive
- C1/C2 root cause fixed cleanly: single `teardown()` owner, idempotent, used by exit/outbound-timeout/reader-exit; supervisor reaps in <1.5 s in probes.
- Cancellation-first ordering holds: watcher invalidates admission → sets close info → cancels; writer delivers 4401 reliably 5/5.
- Abort-watcher-before-teardown, bounded writer wait, presence dropped last.
- Epoch recheck under sessions write lock; session-generation compare before removing crashed handle.
- URI parser: split-before-decode, per-segment checks, unreserved-encoding rejection, 38 semantic unit tests pass.
- Internal id space (1_000_000+) separate from child counters; RAII in-flight guard; strict descriptor; target identity recheck per navigation.
- `/ws` behavior preserved (`ws_client_presence` 5/5).

## Validation
| Command | Result |
|---|---|
| `rustfmt --edition 2021 --check` on semantic_ws, gateway, uri, supervisor, session, router, ws, tests/{semantic_websocket,common/*} | exit 0 (clean) |
| `cargo test --lib semantic::` | 38 passed, 0 failed |
| `cargo test --test semantic_websocket` | 7 passed, 0 failed (5.9 s) |
| `cargo test --test ws_client_presence` | 5 passed |
| `cargo check --tests` | OK |
| `cargo clippy --lib --bins` | 133 warnings repo-wide; 0 in semantic/gateway/uri/semantic_ws (grep-verified); pre-existing e.g. `agent_status/reducer.rs:791` |
| Probes (temp, deleted): exit→reap; invalid-id echo; no-id nav; cancel race; malformed didChange; slow consumer+pings; revocation close code ×5 | see table above |
| Not run | full `cargo test`; Mongo-dependent suites; web/client tests |

## Recommended order
1. W-B + W-C (gateway-owned id lifecycle: cancel→`-32800` w/ original id, invalid id→null, drop id-less nav) with tests.
2. W-A (reader exits on writer death; handle `Ok(Err)`) + slow-consumer/zero-tree + presence-released test.
3. W-D (close doc on any rejection once URI resolves) + test; assert close codes in cutoff test with child attached.
4. W-E restore unrelated files; keep fmt on phase files only.
5. S1/S4/S5 carry-overs; Phase todo stays open until 1–3 and W-F land.

## Unresolved questions
1. W-E: are any of the 175 unrelated reformatted files intentionally reformatted by the user (vs side effect of `cargo fmt`)? Need decision before restoring.
2. Cancel semantics: `-32800 RequestCancelled` with original id, or no reply at all (LSP allows either; spec prose silent)?
3. Presence: keep semantic sockets in shared `/ws` registry (idle-suspend count + 1024 cap) or dedicated cap?
4. `outsideTarget` exact wire shape for Phase 07; mixed-result marker?
5. W-D: does overlay accept non-+1 versions (v1→v3)? Not probed; determines whether desync after dropped change is exploitable.
6. G3–G5 gates (destination freshness for unopened files) unchanged/unproven per tester report.
