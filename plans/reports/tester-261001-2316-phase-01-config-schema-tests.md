# Phase 01: Config and Schema — Test Report

## Test results overview

All five requested commands completed successfully: **2,325 passing test executions, 0 failed (100% pass rate)**. The total counts executions, not unique test cases: the three Rust filters overlap, and the targeted UI files are included in the full UI run.

| Command | Result | Filtered out | Duration / notes |
|---|---:|---:|---|
| `cd server && cargo test cognito` | 4 passed, 0 failed | 1,761 | Cargo output: 63 suites |
| `cd server && cargo test ui_config` | 18 passed, 0 failed | 1,747 | Cargo output: 63 suites |
| `cd server && cargo test config` | 146 passed, 0 failed | 1,619 | Cargo output: 63 suites |
| `pnpm --filter @dam-hopper/ui exec vitest run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts src/stores/settings.test.ts` | 47 passed, 0 failed; 3 files passed | — | Vitest duration: 602 ms |
| `pnpm --filter @dam-hopper/ui test` | 2,110 passed, 0 failed; 286 files passed | — | Vitest duration: 19.74 s |

## Failures and warnings

- Failed tests: none.
- The full UI run printed two jsdom `Error: Not implemented: navigation (except hash changes)` messages from hyperlink navigation. The Vitest summary still reported all 2,110 tests passing.
- Rust test compilation emitted warnings for unused imports (`atomic::Ordering` in `src/pty/tests.rs`; `chrono::Utc` and `jsonwebtoken` imports in `tests/idle_suspend.rs`; `jsonwebtoken` imports in `tests/browser_debug_artifacts.rs`) and unused `TestClaims` in `tests/idle_suspend.rs`.

## Build and coverage

- The Rust commands reached the test profile and completed their selected tests successfully.
- UI package test command completed successfully.
- Coverage was not collected by the requested commands; line, branch, and function coverage are unavailable.

## Performance

- Targeted UI tests: 602 ms Vitest duration.
- Full UI package tests: 19.74 s Vitest duration.
- Rust commands completed; individual test harness durations were negligible in the reported output.

## Recommendations and next steps

- No failing-test follow-up is required for this run.
- Consider cleaning the reported Rust warnings and checking whether the jsdom navigation messages are expected test behavior.
- Run coverage tooling separately if Phase 01 coverage metrics are required.

## Unresolved questions

- None.
