# Code Review — Phase 04 Semantic Session Supervisor

Plan: `plans/260901-1000-lsp-server-integration/phase-04-semantic-session-supervisor.md`
Branch: `feat/lsp-server-integration-reassess` | Date: 2026-10-23

## Score: 4/10 — NOT ready to close Phase 04

Skeleton + admission/default-OFF/overlay UTF-16 solid; session actor has correctness bugs (restart no-op, multi-change batch always rejected, id collision w/ child-initiated requests), teardown not awaited/bounded, no request deadlines. Several Success Criteria untested (tests never run a real navigation, crash, cancel, idle, reap).

## Scope
Reviewed: `server/src/semantic/{protocol,overlay,session,supervisor,mod}.rs`, `server/src/state.rs`, `server/src/main.rs` diff, `server/tests/semantic_supervisor.rs`; context: `child.rs`, `resources.rs`, `tool_profile.rs`, tester report `plans/reports/tester-261023-1205-phase-04.md`.
~2.2k LOC new. Plan file status/todos NOT updated by me (review-only; todo list in plan still all unchecked — see Task completeness).

## Critical issues (must fix before Phase 05)

1. **Crash restart is a no-op; session permanently dead after 1 child crash.** `session.rs` `handle_child_exit` clears `child_handle` but never changes `state` (stays `Ready`). Then `do_initialize()` starts with `if self.state == Ready { return Ok(()) }` → returns without spawning; replay `send_child_json` fails `NotReady` (error ignored). Subsequent `did_open` (`child_handle.is_none()` → `do_initialize` → same early return) fails forever. Restart budget/backoff (`MAX_RESTARTS_PER_WINDOW`) is dead logic. Fix: set `state = Crashed/Starting` before restart; make `do_initialize` check `child_handle.is_some()`; add real crash/restart/replay test.
2. **Multi-change `didChange` batch always rejected.** `overlay.rs` `apply_changes` passes same `new_version` to each change; `apply_*` require `new_version > self.version`, which after first change equals it → `NonMonotonicVersion`. Reproduced (throwaway probe, removed): `apply_changes("u",2,[c1,c2])` → `Err(NonMonotonicVersion{current:2,received:2})`. Plan requires "ordered multiple changes". Real editors (Monaco) batch multi-cursor edits. Fix: check version once vs original doc; internal edit helpers take no version.
3. **Server-initiated requests collide with in-flight navigation ids / initialize id.** `handle_child_event` and init loop match on `parsed.get("id")` only; no check that message is a *response* (no `method`). TSLS sends requests (`window/workDoneProgress/create`, `client/registerCapability`, `workspace/configuration`) with small numeric ids, which equal our sequential ids (1..). A child request id=3 would resolve in-flight #3 and be published to the editor as the "result" (leak of non-filtered child message, plan: "not generic pass-through"). Also server requests are never answered (can stall child). Fix: treat only `result|error` w/o `method` as responses; reply `MethodNotFound`/null to server requests; use a per-incarnation id namespace; filter published payload to `result` only.
4. **Teardown is fire-and-forget, unbounded to caller, not verified.** `SemanticChildHandle::shutdown()` only signals oneshot; `cleanup()` never awaits `is_terminated()`/Terminated event. `supervisor.shutdown().await` + `main.rs` therefore return before tree reaped (graceful 2s + kill 3s runs in detached task; runtime exit can orphan descendants). Failure to reap is never surfaced; `shutdown` reply `unwrap_or(Ok(()))` treats a dead actor as success (plan: "failed cleanup … not reported as success", "blocks replacement admission"). `test_clean_shutdown_and_tree_reap` asserts only actor-state/overlay counters, no pid/pgid liveness check → requirement "complete-tree reaping" unproven. Fix: await terminal (bounded by `TOTAL_TEARDOWN_BUDGET`), expose result, verify pgid gone in test.
5. **Shutdown/cancel cannot preempt long actor operations; admission lock held across actor awaits.** Actor handles `do_initialize` (≤30s `STARTUP_TIMEOUT`) and `handle_child_exit` (`sleep(backoff)` + re-init) inline in its single loop, so `Shutdown`/`DidClose`/`Cancel` queue behind them (cmd channel cap 32; senders `.await` when full). `supervisor.get_or_create_session` holds `sessions.write()` while awaiting `existing.get_state()` and `get_overlay_stats()` on every session → one wedged actor blocks all admission, `get_aggregate_status`, `close_session`, and `shutdown()` (needs the same write lock). `main.rs` shutdown awaits this unbounded → server exit hang ≤30s+/session. Violates "startup cancellation", "no unbounded locks", teardown independent of work. Fix: cancellation token/priority channel select-ed against init and sleep; snapshot handle clones outside lock; wrap shutdown in `timeout` + force path; keep cheap atomic counters (state/doc bytes) readable without actor round-trip.
6. **No navigation deadline.** `NAVIGATION_REQUEST_TIMEOUT` (10s) is defined but unused; `InFlightRequest.created_at` is `#[allow(dead_code)]`. Hung child retains up to 8 in-flight forever, blocks idle eviction (`in_flight_requests` non-empty), callers await unbounded. Violates "all deadlines bounded". Fix: deadline sweep in actor `select!` (timer) → reply `Timeout`, send `$/cancelRequest`.

## High / warnings

7. `do_initialize` accepts any message with `id==1` including `{"error":…}` and never validates `capabilities` (definition/implementation providers) → Phase says "validate actual TSLS capabilities". Error-path leaves `state=Starting` when `spawn`/`send_message` fail via `?` (stuck Starting; incarnation incremented).
8. `rootUri` built with `format!("file://{}", path.display())` — not percent-encoded; spaces/`#`/`%` paths break. Use `url::Url::from_file_path` or existing helper.
9. **Perf: per-navigation full overlay clone.** `do_navigation` calls `overlays.all_documents()` (clones every document's full text, ≤4 MiB/session) just to snapshot `(uri, version)`. Snapshot versions in place (iterate, no text clone). Also `apply_changes` clones whole doc speculatively + `change.text.clone()`; `do_did_open` clones `text` and builds `json!` (3 copies of ≤1 MiB). Transient bytes are not reserved against session/global budget (plan: "transient reservation", "bounded temporary storage") — peak ≈ 3–4× doc; with 2 sessions OK but unaccounted. Implement reserve-before-copy or in-place edit with rollback.
10. Destination freshness incomplete: snapshot only covers docs open at request time; (a) doc closed→reopened w/ same version, (b) dest opened/edited during flight (not in snapshot), (c) unopened files, (d) non-canonical URI forms all pass. Plan: version+incarnation compare, uncertainty ⇒ reject; unopened-file strategy requires G5 proof (no evidence in code/tests). Also stale results returned as `Ok(Null)` (indistinguishable from "no definition") — prefer explicit `Stale` error.
11. `damHopperModelGeneration` parsed but never validated against open incarnation; `RequestIdentityFence`, connection/target generations (hardcoded `1`), `SessionIdentityFence` are effectively unused → incarnation-fence requirement only partly delivered (single-actor serialization covers most, but target/connection generations never checked).
12. Idle eviction gaps: timer only armed on last `didClose`/response; a session whose `didOpen` fails after spawn (oversize, language, `TooManyDocuments`) leaves a live child with 0 docs and **no timer** until disconnect. `do_did_open` spawns child *before* validating size/limits/duplicate (overlay open after init) → rejected request still pays a spawn. Reorder: validate → open overlay → spawn.
13. Supervisor handle leak: `get_or_create_session` `sessions_guard.remove(&key)` for `Crashed/Invalidated` without `shutdown()`. Dropped `cmd_tx` doesn't stop actor (`select!` `else` only fires when child branch also disabled) → `Invalidated` session (child still alive after send failure) leaks its tree. Always `shutdown().await` before replacing.
14. `set_enabled(false)` race: `get_or_create_session` checks `is_enabled()` before awaiting the write lock and never rechecks; concurrent OFF → drain → creator inserts a session post-shutdown. Plan: "rechecks enabled/target/auth epoch after async startup". Recheck under lock. Same session key with different `target_root` returns existing session bound to the old root (target not part of key / no rebinding check).
15. `tool_profile.verify_integrity()` SHA-256s node (~100 MB) + tsserver + tsls **synchronously on the Tokio worker thread on every `get_or_create_session`** (even for existing sessions, before lookup) and every `get_aggregate_status`. Cache result with (mtime,size,inode) or run in `spawn_blocking` once per admission-new-session; skip for existing sessions. Also TOCTOU between verify and exec (low).
16. `SemanticSupervisor::new` does `tokio::spawn` → panics without runtime; `AppState::new` now requires runtime (all current tests pass; sync callers would panic). Idle worker holds `supervisor.clone()` ⇒ Arc cycle through `idle_notify_tx`: supervisor + worker never freed (per-AppState leak in tests). Hold `Weak`/inner and exit on shutdown. Also idle notification has no token: eviction may kill a session that just received new work between notify and `get_overlay_stats` (only checks docs==0; `did_open` after check races) — carry the timer token or do check+close atomically in actor.
17. Aggregate status inaccurate: `in_flight_requests: 0` hard-coded, `active_trees = active_sessions` (sessions ≠ trees), `state` collapses to Idle/Ready. Plan wants precise actual facts.
18. `SessionHandle::navigation(method:&str)` forwards arbitrary method to child (`is_allowed_semantic_method` is never called in production). Current callers internal, but Phase 05 will rely on it; assert `definition|implementation` in actor. `target_root` parameter of `get_or_create_session` is caller-trusted (plan: derive only via `resolve_project_target`); mark `pub(crate)`/doc.
19. `cancel_request(id)` keys on internal sequential ids that callers cannot learn (navigation returns only the result) → cancel API unusable; dropping the `navigation` future leaves request in flight (no cancel to child). Needs client-id ↔ internal-id map or cancel-on-drop.
20. Invalid range/version/capacity returns plain error leaving session `Ready`; plan says invalid → invalidate generation & require full replay. Also `did_change` forwards client's `changes` verbatim when ≥64 KiB (incl. `range_length`, range-less entries) rather than validating representation; sub-threshold rewrites to full text (OK) — contract "server validates representation" not enforced.

## Medium / low

21. CR-only line breaks not treated as newlines in `position_to_byte_offset` (LSP allows `\r`, `\n`, `\r\n`); position past `\r` in CRLF errors. O(n) scan per position, 2× per edit — fine at 1 MiB cap.
22. Dead/YAGNI: `CancelParams`, `Did{Open,Change,Close}TextDocumentParams`, `RequestIdentityFence`, `is_allowed_semantic_method`, `damHopperModelGeneration`, `InFlightRequest.request_id/created_at`, `idle_timer` indirection, `with_semantic_supervisor` (tests only). Remove or wire in. Redundant global overlay check (2 trees × 4 MiB == 8 MiB cap already; and only checked at creation).
23. `Shutdown` command calls `cleanup()` then loop break calls `cleanup()` again; `session.rs` `do_navigation` returns `Result` but outcome ignored (`if let Err(_e)` empty body). Clippy: `collapsible_else_if` (session.rs:730), `cloned_ref_to_slice_refs` (overlay.rs:426 test).
24. `send_child_json` is `async` but never awaits; `send_message` re-parses JSON already built (existing child.rs design).
25. `session.rs` 846 LOC (> project 800/ modularization guidance): split (`session/{actor,handle,navigation}.rs`). Mod ordering in `mod.rs` unsorted (cosmetic).
26. `unwrap()` on `serde_json::to_vec` (infallible, fine) and `overlays.get(uri).unwrap()` after successful apply (safe but prefer `expect`).
27. `semantic_supervisor.rs` test helper hardcodes `/home/loidinh/.nvm/versions/node/v24.16.0/bin/node` fallback → non-portable; remove.

## Positive observations

- Default OFF, zero child on construction/Settings; passive toolchain verify is symlink/permission/digest strict; only `tracing::info!` added in `main.rs`.
- Admission limits (2 global, 1 per connection, 16 docs, 4 MiB/session) enforced centrally; failing boundedly with typed errors.
- Actor-per-(connection,project,worktree) gives real overlay isolation; per-session `didClose` is document-scoped and cancels only that URI's requests.
- Overlay atomic commit via speculative clone (no partial mutation on failure), UTF-16 boundary + surrogate-split detection verified (probe: split inside emoji → `InvalidPosition`); size validated before `replace_range`.
- Extension stripping (`to_standard_lsp_params`) correct; no content logged.
- No core locks (PTY/fs/config) touched; `AppState` addition clone-cheap `Arc`.
- `main.rs` shutdown wired after idle-suspend coordinator (ordering fine, but see #4/#5).

## Phase requirement matrix

| Requirement | Status |
|---|---|
| Bounded admission / zero eager spawn / passive tool check | Done (perf caveat #15) |
| Isolated actor per connection+target | Done (session-key vs target_root #14) |
| Overlay UTF-16, 64 KiB threshold | Mostly; multi-change bug #2; transient reservation missing #9 |
| FIFO dispatch, version fence | Admission-time fence done; incarnation/generation fences partial #11 |
| Destination freshness | Partial #10 |
| Doc-scoped close | Done |
| Finite idle / restart | Idle partial #12; restart broken #1 |
| Complete-tree reaping on shutdown | Signalled only, unverified #4 |
| No lock contention w/ core | Core: OK. Supervisor lock held across awaits #5 |
| Deadlines on requests | Missing #6 |

Task completeness (plan Todo list): none of 7 items may be ticked; items 1–4 partial, 5 partial, 6 done at unit level, 7 not done. Plan file left untouched (status still "Pending 0%").

## Test gaps (tests/semantic_supervisor.rs, 7 tests)

No test for: successful definition/implementation round-trip through real child; response id collision; crash→restart→replay; cancel; request timeout; idle eviction (60s, needs time-paused test); close→reopen same version; destination edit during flight; multi-change batch; transient limits; concurrent admission race; child pid/pgid reaped after `shutdown`; saturated cmd queue; enable/disable race; non-percent-encoded root. Tester's own matrix flags these as unexercised.

## Recommended actions (priority)

1. Fix #1, #2, #3 (small, local) + tests.
2. Redesign actor cancellation (#5, #6) + awaited bounded teardown w/ result (#4); stop holding sessions lock across actor calls.
3. Fix #7–#9, #12–#14 admission/ordering/leaks; #15 cache/spawn_blocking integrity.
4. Settle destination-freshness policy (#10) with Phase 01 G5 evidence or STOP per plan.
5. Prune YAGNI (#22), split session.rs (#25), add missing tests.

## Metrics / validation

| Command | Result |
|---|---|
| `cargo clippy --all-targets` (server) | Finished; 2 new warnings in semantic (`session.rs:730 collapsible_else_if`, `overlay.rs:426 cloned_ref_to_slice_refs`); other warnings pre-existing/unrelated |
| `cargo test --lib` (server) | 1485 passed, 0 failed, 2 ignored |
| `cargo test --tests` (server) | all binaries ok incl. `semantic_supervisor` 7/7 (exit shows no failures) |
| Throwaway probe test `apply_changes` multi-change/surrogate (file deleted) | confirmed bug #2; surrogate split rejected correctly |
| Tester report | 58/58 passing (check/semantic_*); coverage gaps above |
| Type/Test coverage | not measured |

## Unresolved questions

1. Is Phase 01 G5 evidence available for unopened-destination freshness strategy (invalidate-and-requery vs content association)? Code has none; plan says STOP if unproven.
2. Should `get_or_create_session` take `target_root` from `AppState::resolve_project_target` (needs `&AppState`) or stays caller-supplied until Phase 05 mediation?
3. Per-connection limit = 1 tree across projects: intended (plan says per connection+target)? Users switching worktrees will hit `ConnectionTreeLimitExceeded` until idle eviction (60s).
4. Is stale-result = `null` an accepted editor contract or should it be an explicit error code?
