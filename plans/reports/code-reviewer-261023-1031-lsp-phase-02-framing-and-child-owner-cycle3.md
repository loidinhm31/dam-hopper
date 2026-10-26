# Code Review — LSP Phase 02 (Cycle 3)

Score: **7/10 — C1/C2/C3 + W1/W5 verified fixed; 0 blocking criticals; plan-required panic/runtime-drop descendant guard still missing (Warning-High)**

## Fix verification
| # | Fix | Verdict | Evidence |
|---|-----|---------|----------|
| C1 | Teardown deadline leaks descendants | PASS | `child.rs` ~296-300: SIGKILL(-pgid) after `timeout(TOTAL_TEARDOWN_BUDGET…)` outside timed future, +500ms `verify_pgid_reaped`; status reflects leak. `exit_res` branch also SIGKILLs group. Caveat: kill is *unconditional*, not gated on `is_pgid_empty` (see W2). |
| C2 | Protocol/budget/write failure → `Crashed` | PASS | `termination_reason` set in StdoutError / InboundFull / stdin-write failure; applied in final match. `test_malformed_stdout_triggers_crashed_and_reap` asserts `Crashed(_)` (passes). |
| C3 | SIGTERM/SIGHUP-ignoring descendants | PASS | `spawn-stubborn-descendants` fixture mode, helpers not tracked by fixture `exit` → leader exits, group stays alive → forced path exercised; test asserts `is_pgid_empty`. Test does not assert terminal status (see S3). |
| W1 | Terminal publish deadlock | PASS | `timeout(500ms, event_tx.send(Terminated))`; flag set after. Side effect: terminal event may be silently dropped if queue full (rx then sees channel close, indistinguishable from graceful close except via `is_terminated()`). |
| W5 | Pre-enqueue validation | PASS | `send_message`: size → UTF-8 → JSON before budget reserve. Double-parse again in `encode_frame` (perf, S2). |

## Critical
None.

## Warnings
- **W1 (High) Plan-required panic/runtime-drop cleanup transfer absent.** Plan Architecture + Todo ("owner-task panic/drop guard must transfer cleanup to supervised owner/reaper") + step 8 (daemon graceful shutdown). Owner is a bare `tokio::spawn`; if the task panics or runtime shuts down (server graceful shutdown), only `kill_on_drop` hits the direct child → descendants survive. No test. Must land (guard struct with `Drop` that does best-effort `kill(-pgid, SIGKILL)` + tracked reaper handoff) before Phase 04 consumes this, or plan todo stays open.
- **W2 (Med) Unconditional `kill(-pgid)` after group may be empty/leader reaped.** PGID recycle window tiny (pid_max 4M) but real; the "verify `is_pgid_empty` first" described in the cycle brief is not what the code does. Gate on `!is_pgid_empty(pgid)` (still racy but narrows) or use pidfd/start-time identity; document residual risk. Same for exit-branch kill.
- **W3 (Med) Zombie members ⇒ false leak.** `kill(-pgid,0)` succeeds on zombies; on hosts without init reaper / after teardown-timeout where leader not yet reaped (`child.wait` future dropped) result is `Crashed("…descendant leak…")` falsely. Teardown-timeout path also reports `Crashed("deadline exceeded")` even when group verified empty.
- **W4 (Med) Terminal ordering (carried W2).** `Terminated` may precede stdout tail messages / stderr summary (readers not joined). Consumers must not assume Terminated is last.
- **W5 (Med) Test coverage gaps vs plan/success criteria:** no setsid/reparent-escape vector, no stdin-write-timeout test, no saturated event-queue + idle receiver test, no owner panic test, no assertion of terminal status in stubborn test (could mask `Exited` vs `Crashed(leak)`).
- **W6 (Med) Seal still weak.** `pub mod semantic`, `pub` fields/ctors with `#[doc(hidden)]`; any crate can construct `BundledLaunchSpec::with_extra_args` ⇒ arbitrary args. Plan: "no fixture-only runtime override". Prefer `pub(crate)` + `test-support` feature (carried W7).
- **W7 (Med) Test non-portable:** `resolve_node_bin` hardcodes `/home/loidinh/.nvm/...`, falls back to `which node` (system Node — violates "never system Node" for fixtures). Use `NODE_BIN` only, skip/fail loudly otherwise (carried W6).
- **W8 (Low-Med) Budget arithmetic:** graceful 1.3 s + `terminate_and_reap_tree` worst-case 0.8+1.0+1.2+1.2 = 4.2 s > 5 s `TOTAL_TEARDOWN_BUDGET`; deadline then cuts reaper mid-flight (safe now thanks to C1 fix, but stage timeouts should sum ≤ budget). Graceful stage also sleeps 0.5 s more even when leader already exited with non-empty group.
- **W9 (Low-Med) Owner blind to stop/rx-drop during ≤2 s stdin write;** termination_reason masks a detected leak (reason wins over leak status).
- **W10 (Low) `PATH=/usr/bin:/bin` injected** despite "no PATH" rule (carried W11); non-unix `is_pgid_empty`/`verify_pids_dead` return `true` (false success; module is Linux-only per plan, add `compile_error!`/cfg gate).
- **W11 (Low) Blocked stdout/stderr tasks** on `send().await` with alive-idle receiver keep tasks + event_tx clones alive indefinitely.
- Stderr redaction keyword-only (misses `secret`, `api_key`, `cookie`, `sk-`); 64 KiB snippet exposed via `Debug`/consumers (carried W4).

## Suggestions
- S1 Remove unused `ChildStatus::{Starting,Running,ShuttingDown}`, `ChildError::{Framing(via spawn path),Reaper}` if unused externally; drop `pub use` re-exports from `child.rs` and unused `GRACEFUL_SHUTDOWN_TIMEOUT` (YAGNI/DRY).
- S2 Perf: `parse_frame` DOM `Value` → `serde::de::IgnoredAny`; avoid `drain().collect()+split_off` (two copies); `encode_frame` re-validates what `send_message` already validated (validate once, e.g. typed `ValidatedPayload`). Stderr ring per-byte VecDeque push → slice-extend; `get_all_descendants` `Vec::contains` O(n²) → `HashSet`.
- S3 Assert exact terminal status in stubborn/descendant tests; add `Crashed`-leak negative test.
- S4 Named consts for 300/500/200/800/1200 ms teardown stages derived from one budget; extract teardown from the ~110-line owner closure to `reaper.rs`/`teardown.rs`.
- S5 Fixture header documents nonexistent `crash`/coalesced modes; actual `crash-now`, `crash-on-msg`, `malformed-stdout`, `spawn-stubborn-descendants` undocumented.
- S6 `parse_frame` accepts any JSON value (e.g. `123`); require object at owning layer if JSON-RPC intended.

## Positives
- Clear single terminal publication, bounded teardown, SIGKILL fallback outside timeout, receiver-drop + handle-drop arms, RAII `BoundedMessage`/budget release on all paths.
- Typed codec errors without payload leakage; `env_clear`, abs-path checks, `process_group(0)`, no logging in module.
- Real-process tests with truly SIGTERM-ignoring fixtures now exercise escalation; zero leftover processes after runs.

## Validation (executed by reviewer)
- `cargo test --lib semantic::` → 13/13 pass
- `cargo test --test semantic_child_process` → 11/11 pass (9.1 s)
- `cargo clippy --lib --tests` → no diagnostics in `semantic/` (one pre-existing unrelated hit)
- `pgrep` for fixture helper processes after run → none leaked
- Not run: workspace-wide tests, setsid-escape probe, panic probe (no harness; code inspection only)

## Reviewed files
`server/src/semantic/{framing,launch,reaper,types,child,mod}.rs`, `server/src/lib.rs` (diff), `server/tests/fixtures/lsp-test-server.mjs`, `server/tests/semantic_child_process.rs`, prior cycle-2 report, phase-02 plan.

## Plan status
Phase file not edited by reviewer (Pending). Todo items "panic/drop/startup failure + descendant cleanup" and "Cover … real fixtures" remain partially open (W1, W5).

## Unresolved questions
- Must Phase 02 own setsid-escaped/reparented descendants (G7), or is bounded-PGID + fail-closed documented acceptable?
- Is inbound-budget overflow → kill (vs back-pressure) intended?
- Accept `test-support` feature gate to replace `pub`/`doc(hidden)` seal?
- Is `PATH=/usr/bin:/bin` intended?
- Is terminal event dropping on full queue (500 ms) acceptable vs guaranteed delivery via `is_terminated()` only?
