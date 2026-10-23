# Code Review — Phase 04 Semantic Session Supervisor (Cycle 3)

Plan: `plans/260901-1000-lsp-server-integration/phase-04-semantic-session-supervisor.md`
Branch: `feat/lsp-server-integration-reassess` | Date: 2026-10-23 | Prior: cycle 1 (4/10), cycle 2 (7/10)

## Score: 8/10 — PASS (no critical issues; residual warnings are Phase-05-gate hardening, not blockers for Phase 04 close)

Cycle 2 W2/W3/W4 fixes verified in code + tests (+ my own drop probe). W1 not addressed (not claimed). Plan todo/status NOT edited (review-only; PM owns).

## Cycle 2 warning re-verification

| # | Cycle 2 warning | Status | Evidence |
|---|---|---|---|
| W1 | Shutdown queues behind inline `do_initialize` (≤30s) / restart backoff; `supervisor.shutdown()` unbounded | OPEN (not in Cycle 3 fix list) | `session.rs:328` `handle_command(Initialize)` awaits `do_initialize` inline; `STARTUP_TIMEOUT` 432; `supervisor.shutdown()` 364-373 sequential, no outer timeout; `main.rs` awaits it |
| W2 | Cleanup wait (3s) < child budget (5s) | FIXED (partial) | `session.rs:882` timeout = `TOTAL_TEARDOWN_BUDGET + 500ms` = 5.5s. Still: `Terminated(status)` ignored, `Shutdown` always replies `Ok(())`, `SessionHandle::shutdown` `unwrap_or(Ok(()))` → leak-on-timeout/`Crashed("Descendant leak")` not reported (see S-W2b) |
| W3 | Actor never exits when handles dropped | FIXED | `session.rs:302-305` `None => break` → `cleanup()`. **My probe**: test copy with `drop(session); drop(supervisor);` (no `close_session`/`shutdown`), sleep 7s → `is_pgid_empty(pgid)` true, pass. Probe file removed |
| W4 | `get_or_create_session` TOCTOU | FIXED for same-key + global cap + enabled | `supervisor.rs:237-251`: under write lock re-checks `enabled`, `contains key` (returns winner, shuts loser), global cap. Per-connection cap NOT rechecked under write lock (see N-W1) |
| ETXTBSY | TestToolchain | FIXED | `tests/semantic_supervisor.rs:76,93,105` `sync_all()` + file dropped before chmod/exec; 10/10 pass, no flake observed |

## Critical issues

None.

## Warnings

- **N-W1. Per-connection limit still TOCTOU.** `supervisor.rs:174-188` checks `MAX_TREES_PER_CONNECTION` under read lock only; write-lock block (237-251) re-checks key + global but not per-connection count. Two concurrent calls, same connection / different project, can both insert → 2 trees for 1 connection (multithread runtime; `[INFERENCE]`, not reproduced). Fix: `conn_count` check under the write lock, shut down loser.
- **N-W2. `test_drop_handles_triggers_actor_exit_and_reap` does NOT test the drop path.** `tests/semantic_supervisor.rs:649-650` calls `supervisor.close_session(&key)` → explicit `handle.shutdown()` (supervisor.rs:271), so it is equivalent to the clean-shutdown test; W3 regression would still pass. Fix: `drop(session); drop(supervisor);` then poll `is_pgid_empty` with ≥6s deadline (my probe did exactly this and passed). Test name/claim is misleading.
- **S-W2b. Reap failure still reported as success.** `cleanup()` discards `Terminated(status)` and timeout result; `Shutdown` replies `Ok(())` regardless; init-failure paths unawaited. Plan: failed cleanup must not be reported as success / must block replacement admission. Return `Err` when status is `Crashed(..)` or timeout hits.
- **W1 (carried).** See table. Server exit may stall up to 30s per session during init. Bound `supervisor.shutdown()` with `TOTAL_TEARDOWN_BUDGET` + make init preemptible, or accept + document.
- **W5–W12 (carried from Cycle 2, unchanged)**: init loop `id==1` without `method` exclusion + no capability validation; rejected `didOpen` spawns child; stale/cancel→`null`, cancel ids unreachable; G5 unopened-destination freshness unproven, fence generations hard-coded `1`; idle-eviction check/close race (`supervisor.rs:349-361`); `get_aggregate_status` sync `verify_integrity` + `in_flight_requests: 0`; nav method not asserted; invalid range leaves session `Ready`.
- **N-W3. W4 shuts down loser handle while holding the `sessions` write lock** (`supervisor.rs:239,243,247`). Loser actor has no child (no init yet) so fast today; if spawn ever initializes eagerly it would hold lock up to 5.5s. Drop guard first or leave as-is with comment.

## Suggestions

- `session.rs` 934 LOC (>800 docs guidance) → split `session/{handle,actor,navigation}.rs`.
- Remove dead code: `Did*TextDocumentParams`, `CancelParams`, `RequestIdentityFence`, `is_allowed_semantic_method` (unused in prod), `#[allow(dead_code)]`s, `send_child_json` `async` with no await, `with_semantic_supervisor` → `#[cfg(test)]`.
- `Shutdown` handler runs `cleanup()` then `run()` runs it again after break (second is cheap no-op; drop duplicate).
- Gate `deadline_ticker` on non-empty `in_flight_requests` (idle 2 Hz wakeup per session).
- Add tests: concurrent same-key admission, shutdown during startup, init failure, request-timeout sweep, idle eviction (paused time), real definition round-trip payload.
- Mock-fixture child only (`tests/fixtures/lsp-test-server.mjs`); no real TSLS evidence (Phase 01 G5/Phase 09).

## Positive observations

- Actor loop exit semantics now correct on all three paths: `Shutdown`, closed `cmd_rx`, `else`.
- Weak-ref idle worker, no Arc cycle; teardown order in `main.rs` after idle-suspend shutdown; AppState addition minimal (one `Arc`).
- Teardown budget aligned with child reaper; process-group liveness assertions in tests (not counters only).
- Security: default OFF, toolchain integrity verified off-thread + cached, file-URI percent-encoding, bounded overlay/tree limits; no secrets/logging concerns, no new routes exposed.
- Zero clippy warnings in semantic code; zero compiler warnings.

## Requirement matrix

| Requirement | Status |
|---|---|
| Default OFF, zero eager spawn, passive verify | Done |
| Isolated actor per connection/target, admission limits | Done (N-W1 minor race) |
| Overlay atomic/multi-change/adaptive threshold | Done |
| FIFO nav, version extension, deadline | Done |
| Complete-tree reap on shutdown & on drop | Done (S-W2b status not surfaced) |
| Teardown independent of work | Partial (W1) |
| Crash restart + replay | Done |
| Idle eviction | Partial (W6/W9) |
| Destination freshness / fences | Partial (G5 unproven) → keep plan todo 5 unchecked |

## Reviewed files

`server/src/semantic/{session,supervisor,overlay,protocol,mod}.rs`; `server/src/{state,main}.rs` diffs; `server/tests/semantic_supervisor.rs`; context `resources.rs`; Cycle 2 report. ≈2.9k LOC.

## Validation (run by me)

| Command | Result |
|---|---|
| `cargo test --test semantic_supervisor` | 10/10 pass, 2.03s |
| `cargo test --lib semantic` | 23/23 pass |
| `cargo clippy --all-targets` (filtered to `src/semantic`, `tests/semantic_*`) | zero warnings |
| Throwaway probe: drop session+supervisor w/o shutdown, wait 7s | PGID empty → W3 fix confirmed (probe removed; `git status` shows only the real untracked test) |
| Full workspace tests / coverage | not run (reported by main: 62 pass total across suites) |

## Unresolved questions

1. Is W1 (preemptible init / bounded `supervisor.shutdown()`) deferred to Phase 05 intentionally, or should Phase 04 close only after it?
2. Should reap failure/timeout surface as `Err` from `shutdown()` now (plan acceptance) or remain best-effort until an admin/status surface exists?
3. Does Phase 04 close with G5 unopened-destination gap tracked in Phase 05 (plan says STOP-if-unproven)?
4. Per-connection limit = 1 tree across all projects: intended?
5. Is mock-fixture child acceptable for "real bundled-child" criterion in Phase 04?
