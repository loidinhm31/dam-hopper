# Phase 02 — Server Harness Model Discovery Test Report

## Test results overview

All four requested `cargo test` commands completed successfully: **44 passed, 0 failed, 0 ignored** (100% of selected tests).

| Command | Result | Test-run time | Command wall time |
| --- | ---: | ---: | ---: |
| `cargo test --manifest-path server/Cargo.toml advisor::models` | 11 passed, 0 failed, 0 ignored | 0.00s | 0.47s |
| `cargo test --manifest-path server/Cargo.toml advisor::policy` | 11 passed, 0 failed, 0 ignored | 0.00s | 0.45s |
| `cargo test --manifest-path server/Cargo.toml --test advisor_policy_evaluations` | 12 passed, 0 failed, 0 ignored | 3.25s | 3.54s |
| `cargo test --manifest-path server/Cargo.toml --test advisor_history_api` | 10 passed, 0 failed, 0 ignored | 0.63s | 0.90s |
| **Total** | **44 passed, 0 failed, 0 ignored** | **3.88s** | **5.36s** |

The two unit-test invocations intentionally filtered unrelated tests. Filtered tests are not counted as ignored/skipped in the requested test selection.

## Coverage metrics

Line, branch, and function coverage were not collected; no coverage command was requested or run.

## Failed tests

None.

## Performance metrics

Combined command wall time: **5.36s**. Combined test-harness time: **3.88s**. The longest requested target was `advisor_policy_evaluations` at 3.25s.

## Build status

**Pass.** All commands built/used the test profile and exited successfully. Non-blocking compiler warnings appeared in the unit-test invocations:

- Unused `router` binding in `tests/advisor_policy_evaluations.rs:740`.
- Unused `atomic::Ordering` import in `src/pty/tests.rs`.
- Unused `chrono::Utc` and `jsonwebtoken` imports, and dead `TestClaims`, in `tests/idle_suspend.rs`.
- Unused `jsonwebtoken` imports in `tests/browser_debug_artifacts.rs`.

## Critical issues

None. All requested assertions passed.

## Recommendations and next steps

- No test remediation is required for this scope.
- Consider cleaning up the listed compiler warnings separately.
- Run coverage only if Phase 02 has an explicit coverage threshold or requirement.

## Unresolved questions

None.
