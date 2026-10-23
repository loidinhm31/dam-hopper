# Code Review — Phase 04 Semantic Session Supervisor (Cycle 2)

Plan: `plans/260901-1000-lsp-server-integration/phase-04-semantic-session-supervisor.md`
Branch: `feat/lsp-server-integration-reassess` | Date: 2026-10-23 | Prior: `code-reviewer-261023-1205-phase-04.md` (4/10)

## Score: 7/10 — Conditional PASS (no blockers; fix W1–W3 before Phase 05 exposes the owner)

All 6 Cycle 1 criticals are verifiably fixed in the steady-state path. Residual gaps are edge/teardown robustness (not exposed via routes yet). Plan todo/status NOT edited by me (review-only; PM owns status flip). Tests use mock fixture `tests/fixtures/lsp-test-server.mjs` behind a real node wrapper, not real TSLS — real-TSLS/G5 evidence still absent.

## Cycle 1 critical re-verification

| # | Cycle 1 issue | Status | Evidence |
|---|---|---|---|
| 1 | Crash restart no-op | FIXED | `do_initialize` guard now `Ready && child_handle.is_some()`; `handle_child_exit` sets `Crashed` → backoff → `Starting` → init → replay. `test_child_crash_and_automatic_restart_with_replay` SIGKILLs PGID, asserts new PGID + overlay kept + final reap (passes) |
| 2 | Multi-change batch rejected | FIXED | `apply_changes` checks version once, uses `*_internal` helpers on speculative clone; `test_multi_change_batch_integration` + lib tests pass |
| 3 | Child-initiated request id collision | FIXED (steady state) | `handle_child_event` branches on `method` first; answers server requests (`workspace/configuration` → `[{}]`, else null); nav ids start at 100. Init loop still unchecked, see W5 |
| 4 | Teardown fire-and-forget | MOSTLY FIXED | `cleanup()` awaits `Terminated` (3s cap); `test_clean_shutdown_and_tree_reap` asserts `is_pgid_empty(pgid)` after shutdown. Residual: W2 |
| 5 | Lock held across actor awaits | PARTIAL | `get_or_create_session` snapshots handles, no `sessions.write()` across `get_state`/stats; re-checks `enabled` under write lock. Actor still can’t preempt init/restart (W1) |
| 6 | No nav deadline | FIXED | 500ms `interval` sweep → `Err(Timeout)` + `$/cancelRequest`; `created_at` used, `allow(dead_code)` on struct remains |
| 7–9 | clippy, rootUri encoding, snapshot clone | FIXED | `cargo clippy --all-targets`: zero warnings in `src/semantic/*`/`tests/semantic_*`. `path_to_file_uri` percent-encodes. `document_versions_snapshot` copies versions only |

Also fixed vs Cycle 1: tests no longer hardcode `/home/loidinh/.nvm` node path; `Weak` used in idle worker (Arc cycle gone); integrity verify via `spawn_blocking` + cached flag; supervisor shutdown drains map.

## Critical issues

None.

## Warnings (should fix; W1–W3 before Phase 05)

- **W1. Shutdown/Close/Cancel still queue behind actor-inline `do_initialize` (≤30s `STARTUP_TIMEOUT`) and `handle_child_exit` (`sleep` 1–3s + init).** `supervisor.shutdown()` awaits sequentially per session; `main.rs:1091` awaits unbounded → server exit can stall ≥30s/session (2 sessions). Plan: "startup cancellation", teardown independent of work. Fix: run init in `select!` with `cmd_rx` Shutdown preemption (or spawn init task + oneshot), bound `supervisor.shutdown()` with `TOTAL_TEARDOWN_BUDGET`.
- **W2. Reap failure not surfaced; cleanup wait (3000ms, `session.rs:874`) < child teardown budget (graceful 2s + kill 3s = 5s, `resources.rs:63-67`).** On slow tree, `cleanup()` times out, actor replies `Ok(())`, `shutdown().await` returns, process may exit with descendants alive. `SessionHandle::shutdown` also `unwrap_or(Ok(()))` on dead actor. Plan: "failed cleanup … not reported as success / blocks replacement admission". Use `TOTAL_TEARDOWN_BUDGET`, check `Terminated(status)` (child reports `Crashed("Descendant leak…")`), return `Err`. Init-failure paths (`handle.shutdown()` at 468/473) are also unawaited.
- **W3. Actor never exits when all handles drop — CONFIRMED by throwaway probe (removed):** supervisor + session handle dropped without `shutdown()`, child PGID still alive after 8s (probe killed it). Cause: `select!` `else` branch unreachable because the 500ms `deadline_ticker` is always ready; closed `cmd_rx` just disables its arm. Impact: leak on `AppState` drop/panic/test teardown; any replaced/orphaned handle keeps its tree. Fix: `None` from `cmd_rx.recv()` ⇒ break (run `cleanup`); also arm ticker only when `in_flight_requests` non-empty (avoids idle 2 Hz wakeups per session).
- **W4. `get_or_create_session` TOCTOU: no re-check of key / per-connection limit at insert** (only global + enabled re-checked under write lock, `supervisor.rs:237-248`). Two concurrent calls for same key can both pass fast path, second `insert` overwrites first handle (orphan actor, untracked, not reaped by `shutdown()`; related to W3); two concurrent calls same connection / different project can exceed `MAX_TREES_PER_CONNECTION`. Probe with `join!` did not reproduce (calls serialized on single poll) → `[INFERENCE]`, reachable on multithread runtime. Fix: check `contains_key` + per-connection count under the write lock; shut down loser handle.
- **W5. Init loop (`session.rs:424-447`) matches `id == 1` without excluding `method` messages and never validates `capabilities.definitionProvider/implementationProvider`; `?` on `spawn`/`send_message` leaves `state = Starting`.** Plan: "validate actual TSLS capabilities". Error replies already handled.
- **W6. Rejected `didOpen` still spawns a child.** `do_did_open` runs `do_initialize` before overlay validation (size/limit/duplicate); failure leaves live child with 0 docs and no idle timer until disconnect (`check_schedule_idle_timer` not called on error). Reorder: validate → overlay open → spawn; or schedule timer on error.
- **W7. Cancel API unusable / nav stale ⇒ `null`.** Internal ids (100+) never returned to caller so `cancel_request(id)` can’t be called; dropping `navigation()` future leaves request in flight until 10s sweep. Stale/cancelled/closed all collapse to `Ok(Null)`, indistinguishable from "no definition" (plan: uncertainty must reject). Prefer explicit `Stale`/`Cancelled` errors.
- **W8. Destination freshness still partial** (only docs open at request time, no unopened-file strategy; Phase 01 G5 evidence absent). `damHopperModelGeneration` not validated; connection/target generations hard-coded `1`; `SessionIdentityFence`/`RequestIdentityFence` effectively unused. Plan marks unopened-destination strategy STOP-if-unproven — todo item 5 must stay unchecked.
- **W9. Idle eviction race**: notify carries only key; supervisor does `get_overlay_stats` then `close_session` non-atomically; a `didOpen` landing between them kills a session with fresh work. Do check+close inside actor (token-carrying `IdleExpired` command).
- **W10. `get_aggregate_status` still runs sync `verify_integrity()` (SHA-256 of ~100MB) on a Tokio worker per call; `in_flight_requests: 0` hard-coded; `active_trees == active_sessions`; `main.rs:891` startup status also sync.** `toolchain_verified` never reset on `set_enabled(false→true)`; verify→exec TOCTOU low.
- **W11. Method not asserted**: `SessionHandle::navigation(method: &str)` forwards any method; `is_allowed_semantic_method` unused in production. Assert `textDocument/definition|implementation` in actor before Phase 05 consumes it. `target_root` caller-trusted (must come from `resolve_project_target`).
- **W12. Invalid range/version/capacity leaves session `Ready` with plain error**; plan says invalidate generation + require replay. `did_change` ≥64KiB forwards client `changes` verbatim (incl. `range_length`) instead of server-validated representation. `SemanticSupervisor::new` / `AppState::new` now panic outside a Tokio runtime (`tokio::spawn`).

## Suggestions

- `session.rs` 926 LOC (>800 guidance; was 846) → split `session/{handle,actor,navigation}.rs`.
- Remove dead/YAGNI: `CancelParams`, `Did*TextDocumentParams`, `RequestIdentityFence`, `is_allowed_semantic_method`, `InFlightRequest.request_id`, `#[allow(dead_code)]`, redundant global overlay check (2×4MiB == 8MiB cap), `send_child_json` `async` with no await, `with_semantic_supervisor` (tests only → `#[cfg(test)]`).
- `Shutdown` handler calls `cleanup()` then loop-exit calls it again; `do_navigation` result ignored via empty `if let Err`.
- Unsorted `pub mod` order in `semantic/mod.rs`; `overlay.rs` blank-line/format nits (`cargo fmt` not clean repo-wide, not attributed to this phase).
- CR-only (`\r`) line breaks not treated as LSP newlines in `position_to_byte_offset`.
- Perf: `apply_changes` clones whole doc + `change.text`; `do_did_open` builds `json!` with 3 copies of ≤1 MiB; transients not reserved against budget (plan: reserve-before-copy). Acceptable at current caps (4 MiB/session, 2 sessions).
- `get_state()`/stats calls from supervisor block behind a busy actor (W1) — consider atomics for state/stats snapshot.
- Tests to add: concurrent same-key admission; shutdown during startup; drop-without-shutdown reap; init failure state; capabilities missing; request timeout sweep; idle eviction (time-paused); close→reopen same version; destination edit in flight; successful definition round-trip asserting payload; replay content actually reaching child (crash test asserts only overlay counters). Multi-change integration test asserts `bytes > 0` only, not resulting text (covered by lib unit tests).

## Positive observations

- Crash/restart now deterministic and tested with real PGID kill + new-PGID + final reap.
- Overlay batch semantics correct: single version check, atomic speculative commit, UTF-16/surrogate validation, size check pre-`replace_range`.
- Navigation: version extension required/stripped, FIFO via actor, 10s deadline with child cancel, id namespace separate from init, child requests answered.
- Admission limits central and bounded; default OFF; no children on construction; lock snapshotting removes cross-session blocking; enabled re-check under lock.
- No core PTY/fs/config locks touched; `AppState` addition is one `Arc`; main.rs wiring minimal and ordered after idle-suspend shutdown.
- Teardown test now asserts real process-group liveness (not only counters).

## Phase requirement matrix

| Requirement | Status |
|---|---|
| Zero eager spawn, default OFF, passive verify | Done (W10 perf) |
| Per connection/target isolated actor | Done (W4 race) |
| Atomic overlay, adaptive threshold, multi-change | Done |
| FIFO, version extension, nav deadline | Done |
| Incarnation/generation fences | Partial (W8) |
| Destination freshness | Partial (W8) — STOP-gate G5 unproven |
| Doc-scoped close | Done |
| Crash restart + replay | Done |
| Idle eviction | Partial (W6, W9) |
| Complete-tree reap on shutdown | Mostly (W2, W3) |
| Teardown independent of work | Partial (W1) |

Plan todo list (not edited): items 1, 3, 6 satisfiable; 2 and 4 near-done; 5 incomplete; 7 partial.

## Reviewed files

`server/src/semantic/{session,supervisor,overlay,protocol,mod}.rs`; `server/src/{state,main}.rs` diff; `server/tests/semantic_supervisor.rs`; context `child.rs`, `reaper.rs`, `resources.rs`, `types.rs`; `plans/reports/tester-261023-1205-phase-04-cycle-2.md`, prior review. ≈2.9k LOC.

## Validation (run by me)

| Command | Result |
|---|---|
| `cargo test --test semantic_supervisor` (server) | 9/9 pass, 2.03s |
| `cargo test --lib semantic` | 23/23 pass |
| `cargo clippy --all-targets` | zero warnings in `src/semantic`/`tests/semantic_supervisor.rs`; other warnings pre-existing in unrelated modules |
| Throwaway probe: drop supervisor+handle w/o shutdown | PGID still alive after 8s → W3 confirmed (probe removed, tests file restored to 603 lines, orphan killed) |
| Throwaway probe: concurrent same-key `get_or_create_session` | Both calls returned the same child PGID (no overwrite observed) → W4 unproven, not reproduced |
| Full workspace test / coverage | Not run by me; QA report states 61 pass |

## Recommended actions

1. W3 (break actor on closed `cmd_rx`; gate ticker) + W2 (budget=5s, surface terminal status/err) + W1 (preemptible init, bounded supervisor shutdown) — small, local.
2. W4 recheck at insert; W5/W6 init ordering and capability validation; W9 atomic idle close.
3. Before Phase 05: W7 explicit stale/cancel errors + cancellable ids, W11 method assert, W8 G5 destination strategy decision.
4. Add tests listed in Suggestions; split `session.rs`.

## Unresolved questions

1. Is Phase 01 G5 evidence available for unopened-destination freshness (invalidate-and-requery vs content association)? Code has none; plan says STOP if unproven — should Phase 04 close with this gap tracked in Phase 05, or block?
2. Should `get_or_create_session` take `&AppState`/resolved target (plan: derive only via `resolve_project_target`) now, or remain caller-supplied until Phase 05 mediation?
3. Per-connection limit = 1 tree across all projects (users switching worktrees get `ConnectionTreeLimitExceeded` until 60s idle eviction): intended?
4. Is stale-result `null` an accepted editor contract or should it be an explicit error code (W7)?
5. Is a mock-fixture child acceptable for the plan's "real bundled-child" criterion, or is a real TSLS qualification expected in Phase 04 (vs Phase 09)?
