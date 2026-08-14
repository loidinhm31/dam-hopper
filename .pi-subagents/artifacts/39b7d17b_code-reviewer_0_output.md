Turn budget wrap-up was requested after 10 assistant turns (soft limit 10, grace 1). Process-mode live steering is unavailable, so the child was warned at launch to wrap up by this budget. Output may be partial.

## Code Review Summary

### Scope
- Files: `manager.rs`, `ssh_client.rs`, `shutdown.rs`, `lib.rs`, `Cargo.toml`, Phase 04 plan
- LOC analyzed: ~3,700
- Focus: latest Phase 04 runtime tests/lifecycle seams
- Updated plans: none; user requested no edits

### Overall Assessment
Real Windows native tests now run: russh listener/`manager.stop`, manager lifecycle, shutdown, and SSH-forward suite pass. No production key-injection leak: injection is `cfg(test)` only.

**Phase 04 cannot yet be marked complete.**

### High Priority Findings
1. **Mandatory Clippy gate fails**
   - `cargo clippy --all-targets -- -D warnings` fails on two `needless_borrow`s:
     - `manager.rs:2546`
     - `manager.rs:2657`
   - The written Phase 04 success criteria explicitly require Clippy clean.
   - Fix the two redundant `&` references, rerun gate.

### Medium Priority Improvements
1. **`force_close` cleanup is not reliable when no Tokio runtime is entered**
   - `manager.rs:1180+` only schedules deferred runtime-map cleanup after lock contention if `tokio::runtime::Handle::try_current()` succeeds.
   - `RunEvent::Exit` is synchronous/event-loop code and may not have an entered Tokio handle. Workers are aborted through `abort_handles`, but `runtimes` can remain uncleared after contention.
   - Use the Tauri async runtime for deferred cleanup, or otherwise make cleanup runtime-independent. Add a contention test initiated from a non-Tokio thread.

2. **Written-plan test evidence remains incomplete**
   - Challenge manager test issues/repeats then stops, but does not call `approve_host` and prove approval is consumed while a subsequent explicit Start creates the new generation.
   - Purge test proves active denial and idempotency, not staged/racing activation denial.
   - “1,000 schedules” tests pure intent ordering, not 1,000 randomized barrier schedules with staged scope/listener cleanup as specified.
   - Shutdown tests validate injected closures and one-shot coordinator behavior, but do not prove actual close/exit/reload/timeout wiring with live resources.

3. **Test key injection is process-global**
   - `ssh_client.rs:43-60` uses mutable `OnceLock<Mutex<Option<Vec<u8>>>>` and fixed key ID.
   - Current suite is safe with one consumer, but future parallel tests can overwrite state. Prefer a scoped restore guard or serialize only tests that use this seam.

### Positive Observations
- Real in-process russh test exercises production `run_profile`, loopback bind, SSH auth/trust, and `manager.stop`; listener unreachability is asserted.
- Scope switch, dispose, purge, challenge-repeat, worker reaping, and lock-contention paths have meaningful coverage.
- `trigger_with_exit` correctly gives the shutdown test a generic `Runtime` seam without exposing it to production callers.
- Test-only `tauri` and `rand` dependencies plus `cfg(test)` private-key path do not affect release behavior.
- SSH-forward suite: **117 passed, 1 intentionally ignored**.
- Targeted manager: **18 passed**; shutdown: **3 passed**; commands: **1 passed**.
- `cargo fmt --check` and `git diff --check` passed.

### Recommended Actions
1. Remove the two Clippy-reported needless borrows; rerun Clippy.
2. Make lock-contention `force_close` cleanup independent of an entered Tokio runtime.
3. Add the missing plan-required challenge approval/restart, staged/racing purge, barrier-schedule, and live shutdown wiring tests.
4. Only then update Phase 04 from blocked and check all corresponding plan TODOs.

### Metrics
- Type/build: targeted test compilation passed
- Test failures: 0 in executed native SSH/shutdown tests
- Linting issues: 2 Clippy errors
- Test coverage: no percentage available

### Unresolved Questions
- None.