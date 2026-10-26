# Code Review — LSP Phase 02 (Cycle 2)

Score: **5/10 — NOT APPROVED** (7 of 9 prior criticals only partly fixed; 2 reproduced as still broken)

## Fix verification
| # | Fix | Verdict |
|---|-----|---------|
| 1 | Malformed stdout → `Crashed` | **FAIL** — terminal is `Exited(None)` (probe). `StdoutError/InboundFull` → `graceful=false` → `terminate_and_reap_tree` → `Ok` → `Exited`. Test only asserts "terminated". |
| 2 | No raw header text in errors/logs | PASS (no header payload in `FramingError`; no logging in `semantic/`) |
| 3 | Bounded binary-safe stderr | PASS-ish — raw bytes, 64 KiB ring. Redaction keyword-only. |
| 4 | Tree tracking + leak audit | **PARTIAL/FAIL** — see C1 |
| 5 | Graceful LSP stage | PARTIAL — shutdown RPC→1s→exit→0.5s done; stdin never closed before escalation |
| 6 | 5 s teardown budget | **FAIL** — budget cutoff *removes* the kill (C1) |
| 7 | Rx drop → teardown | PASS (tested) |
| 8 | Inbound byte budget | PASS (policy caveat W3) |
| 9 | Seal visibility | **PARTIAL** — only `#[doc(hidden)]`; `pub mod semantic` + `pub` ctor/fields still callable by any crate/test |

## Critical
- **C1 Teardown deadline leaks descendants (reproduced).** Probe: node parent exits on `exit`, helper in same PGID ignores SIGTERM/SIGHUP. `shutdown()` → graceful stage returns early path, `verify_pgid_reaped` burns 3 s twice (`child.rs:283,292`; `reaper.rs:109`), outer `timeout(5s)` drops future at 5.00 s **before any SIGTERM/SIGKILL is sent to the group**. Result `Crashed("Teardown overall deadline exceeded")`, pgid still alive 0.5 s later (needs manual kill). `kill_on_drop` only hits direct child (already reaped). Fix: on every graceful-stage branch where leader is gone but PGID non-empty, go straight to SIGKILL(-pgid); reserve final unconditional SIGKILL(-pgid) after the timeout fires (outside the timed future); size stage timeouts so worst case ≤ budget (term 2 s + verify 3 s + kill-wait 1 s + verify 3 s alone = 9 s).
- **C2 Malformed/over-budget stdout reported as `Exited`, not `Crashed` (reproduced: `Exited(None)`).** Fix #1 claim false. Carry a reason from `InternalSignal` into final status (`Crashed("protocol violation"/"inbound budget exceeded")`) irrespective of kill outcome; assert `Crashed` in `test_malformed_stdout_triggers_crashed_and_reap`.
- **C3 Escape/leak path untested; tests give false assurance.** `test_descendant_spawn_and_reap` fixture helpers handle SIGTERM and the fixture kills them itself on `exit` → escalation never exercised. No SIGTERM-ignoring descendant, no setsid escapee, no stdin-write-timeout test, no saturated-event-queue test. C1 passed all 10 tests undetected.

## Warnings
- W1 `Terminated` send `.await` on full event queue (cap 32) blocks owner forever if receiver alive-but-idle; `terminal_published` set only after (`child.rs:245,310`). Use `try_send`/timeout; set flag first.
- W2 `Terminated` not guaranteed last: stderr summary / stdout tail race it (stderr summary only at EOF; `test_stderr_flood` uses `got_stderr` after break — flaky by design). Join readers (bounded) before emitting terminal.
- W3 Inbound budget breach = kill child (reader never back-pressures). Slow consumer + few ~1 MiB diagnostics ⇒ TSLS killed. Confirm policy.
- W4 `sanitize_text` keywords (authorization/bearer/token/password) only; misses `secret`, `api_key`, `cookie`, `sk-…`, split first line of ring. `StderrSummary.recent_snippet` (64 KiB) delivered to consumers and via `Debug`.
- W5 `send_message` doesn't validate JSON/UTF-8/size at enqueue; one bad payload fails at write → kills child (carried from cycle 1).
- W6 Test helper hardcodes `/home/loidinh/.nvm/...` and falls back to `which node` (non-portable, non-bundled).
- W7 `#[doc(hidden)]` ≠ sealed (see fix 9). Prefer `pub(crate)` + in-crate tests, or `test-support` feature.
- W8 Zombie group members make `kill(-pgid,0)` succeed → false leak on hosts w/o init reaper; PID-recycle risk on `kill(-pgid)` after leader reaped (descendant snapshot has no start-time identity).
- W9 Owner blind to stop/rx-drop while inside 2 s stdin write.
- W10 Non-unix `is_pgid_empty`/`verify_pids_dead` return `true` ⇒ false success.
- W11 `PATH=/usr/bin:/bin` injected despite "no PATH" rule — unresolved intent.

## Suggestions
- `ChildStatus::{Starting,Running,ShuttingDown}`, `ChildError::{Framing,Reaper}` unused → remove (YAGNI).
- Stderr ring is per-byte `VecDeque` push; append slices / keep last-N chunk (perf), avoid `into_iter().collect()` copy.
- Magic numbers 500/1000/300/500/1000 ms in `child.rs`/`reaper.rs` → named consts derived from the budget.
- `parse_frame`: `Value` DOM → `IgnoredAny`; `drain().collect()+split_off` = extra copies; `encode_frame` duplicate parse.
- `get_all_descendants` `Vec::contains` O(n²) → `HashSet`.
- `AtomicBool` `terminal_published` + `pub use` re-exports in `child.rs` duplicate `types` paths.
- Extract teardown into `reaper`/`teardown.rs`; `child.rs` owner closure is ~110 lines.
- Fixture header doc lists `crash`, coalesced mode that don't exist.

## Positives
- Receiver-drop select arm, RAII `BoundedMessage` (no double-release), outbound budget release on all paths.
- Typed codec errors without payload leakage; `env_clear`, abs-path validation, `process_group(0)`, `kill_on_drop`.
- Real-process harness; stuck-shutdown fixture now truly ignores SIGTERM.

## Validation (executed)
- `cargo test --lib semantic::` → 13/13 pass
- `cargo test --test semantic_child_process` → 10/10 pass (10.1 s)
- `cargo clippy --lib --tests` → no diagnostics in `semantic/` (pre-existing elsewhere)
- Throwaway probes (deleted afterwards): graceful-path SIGTERM-ignoring helper → `Crashed(deadline)` at 5.00 s, PGID alive; malformed stdout → `Exited(None)`. No leftover processes.

## Unresolved questions
- Must Phase 02 own setsid-escaped descendants, or is bounded-PGID + fail-closed documented?
- Is inbound-budget overflow intended to kill the child vs back-pressure?
- Accept `test-support` feature gate for integration-test access?
- `PATH=/usr/bin:/bin` intended?
- Plan file `phase-02-…md` not edited by reviewer; status stays Pending.
