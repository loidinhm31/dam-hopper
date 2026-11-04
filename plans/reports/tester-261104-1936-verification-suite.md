# Test Suite Verification Report

- **Date:** 2026-11-04
- **Operation:** `run` (code validation)
- **Authority:** Execution & reporting only (no source, test, or CI mutations permitted)
- **Overall Status:** `FAIL` (1 passed, 3 failed)

## 1. Summary of Executed Commands

| Command | Exit Code | Result | Pass/Fail Counts | Artifact / Evidence |
|---|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml pty::tests` | 101 | **FAIL** | 111 passed; 1 failed; 0 ignored; 0 measured; 1307 filtered out | `artifact://57` |
| `cargo test --manifest-path server/Cargo.toml api::tests` | 101 | **FAIL** | 153 passed; 1 failed; 0 ignored; 0 measured; 1265 filtered out | `artifact://59` |
| `pnpm --filter @dam-hopper/ui test` | 0 | **PASS** | Test Files: 330 passed (330); Tests: 3166 passed (3166) | Duration: 24.21s |
| `pnpm check` | 101 | **FAIL** | Build: PASS; Lint: PASS (0 errors, 315 warnings); Cargo test: 1416 passed, 2 failed, 1 ignored | `artifact://61`, `artifact://62` |

## 2. Command Details & Terminal Evidence

### 2.1 `cargo test --manifest-path server/Cargo.toml pty::tests`
- **Exit code:** 101
- **Duration:** 8.11s (test execution)
- **Counts:** `111 passed; 1 failed; 0 ignored; 0 measured; 1307 filtered out`
- **Failing test:** `pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics`
- **Failure output:**
  ```text
  ---- pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics stdout ----

  thread 'pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics' (319129) panicked at src/pty/tests.rs:2294:9:
  respawn failure should be recorded
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics

  test result: FAILED. 111 passed; 1 failed; 0 ignored; 0 measured; 1307 filtered out; finished in 8.11s
  ```
- **Evidence artifact:** `artifact://57`

### 2.2 `cargo test --manifest-path server/Cargo.toml api::tests`
- **Exit code:** 101
- **Duration:** 6.22s (test execution)
- **Counts:** `153 passed; 1 failed; 0 ignored; 0 measured; 1265 filtered out`
- **Failing test:** `api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals`
- **Failure output (Suite Run):**
  ```text
  ---- api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals stdout ----

  thread 'api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals' (322860) panicked at src/api/tests.rs:7759:5:
  assertion `left == right` failed
    left: 409
   right: 200
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

  failures:
      api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals

  test result: FAILED. 153 passed; 1 failed; 0 ignored; 0 measured; 1265 filtered out; finished in 6.22s
  ```
- **Diagnostic Solo Run:** `cargo test --manifest-path server/Cargo.toml api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals -- --nocapture`
  - **Exit code:** 101 (0 passed; 1 failed; 1418 filtered out; finished in 0.29s)
  - **Failure output:**
    ```text
    thread 'api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals' (378636) panicked at src/api/tests.rs:7725:5:
    assertion `left == right` failed
      left: String("TERMINATION_NOT_LIVE")
     right: "TERMINATION_ALREADY_REQUESTED"
    ```
  - **Evidence artifact:** `artifact://73`

### 2.3 `pnpm --filter @dam-hopper/ui test`
- **Exit code:** 0
- **Duration:** 24.21s (transform 41.79s, setup 0ms, import 112.69s, tests 66.49s, environment 74.82s)
- **Counts:** `Test Files 330 passed (330)`, `Tests 3166 passed (3166)`
- **Runtime diagnostics (non-failing):**
  Two jsdom non-implemented navigation diagnostics emitted during execution:
  `Error: Not implemented: navigation (except hash changes)`

### 2.4 `pnpm check`
- **Pipeline:** `pnpm build && pnpm lint && cd server && cargo test`
- **Exit code:** 101
- **Stage 1 (Build):**
  - `@dam-hopper/browser-extension`: staged and built in 87ms
  - `@dam-hopper/web`: 6032 modules transformed, bundle built in 31.64s
  - Result: PASS
- **Stage 2 (Lint):**
  - `eslint apps/ packages/`: 0 errors, 315 warnings
  - Result: PASS
- **Stage 3 (Cargo Test):**
  - Command: `cd server && cargo test`
  - Exit code: 101
  - Counts: `1416 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out; finished in 49.04s`
  - *Note:* Counts represent the Rust library-test runner; subsequent integration targets were not reached due to library test failure.
  - Failures:
    1. `api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals`
    2. `pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics`
- **Evidence artifact:** `artifact://61` (full output), `artifact://62` (failure slice)

## 3. Diagnostic Observations & Failure Triage

Under the `run` contract, no source or test files were modified. The following observations and hypotheses are provided for handoff to the debug/fix pipeline:

1. **`pty::tests::pty_tests::terminal_respawn_failures_are_recorded_in_diagnostics`**:
   - *Observation:* Panicked at `src/pty/tests.rs:2294:9` (`respawn failure should be recorded`).
   - *Analysis:* In `server/src/pty/manager.rs:4086`, `finish_respawn_source_failure` returns `None` if `!guard.fleet.is_restart_pending(session_id, incarnation)`. Because `respawn_internal` transitions fleet state from `restart_pending` to `creating` (`transition_restart_pending_to_creating`) before attempting to spawn, `is_restart_pending` evaluates to `false` when a respawn attempt fails. Consequently, `finish_respawn_source_failure` returns `None`, and the subsequent call to `store.record_terminal_event("pty", "terminal.respawn_failed", fields)` (indented under `if let Some(...) = failure_state`) is bypassed.

2. **`api::tests::test_terminal_terminate_success_outcomes_and_domain_refusals`**:
   - *Observation (Suite run):* Panicked at `src/api/tests.rs:7759:5` with `left == right` failed (`left: 409, right: 200`) when posting termination cancel request for `term-restart-route`.
   - *Observation (Solo run):* Panicked earlier at `src/api/tests.rs:7725:5` with `left: String("TERMINATION_NOT_LIVE"), right: "TERMINATION_ALREADY_REQUESTED"` on duplicate termination check for `term-live-route`.
   - *Analysis & Hypotheses:*
     - For the duplicate request assertion (line 7725): Once `term-live-route` is signaled with `SIGTERM` and exits, the reader thread removes `termination_requested` marker on exit (`inner_guard.remove_termination_requested`), and since the dead session is not restart-pending, subsequent calls return `TERMINATION_NOT_LIVE` rather than `TERMINATION_ALREADY_REQUESTED`.
     - For the cancel restart assertion (line 7759): The test pauses via `state.pty_manager.test_respawn_hook().pause_next()`. If the respawn loop proceeds into `respawn_internal` and marks `pending_replacements`, `request_termination` rejects with 409 (`ReplacementPending` / `TERMINATION_REPLACEMENT_PENDING`) rather than cancelling `RestartPending` with 200. Alternatively, if polling timing races, the session state may not match the expectation at cancel time.

## 4. Unresolved Questions
- Should `terminal.respawn_failed` diagnostic recording occur regardless of whether `finish_respawn_source_failure` returns `None` (as was originally structured before qualification repairs)?
- For guarded termination, is `TERMINATION_NOT_LIVE` intended if a terminated process has already fully exited and reached dead state without auto-restart, or should termination requests retain an epoch tombstone to answer `TERMINATION_ALREADY_REQUESTED`?
