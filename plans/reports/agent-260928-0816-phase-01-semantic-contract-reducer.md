# Phase 01: Semantic Contract and Reducer — Test Report

**Result:** PASS — all requested test commands completed successfully.

## Test results

| Command | Suites/files | Passed | Failed | Skipped/ignored | Runner duration |
|---|---:|---:|---:|---:|---:|
| `cargo test --manifest-path server/Cargo.toml agent_status --lib` | 1 Rust test binary | 8 | 0 | 0 ignored (1,145 filtered out) | 0.00 s |
| `pnpm --filter @dam-hopper/ui test src/api/agent-status-types.test.ts` | 1 Vitest file | 8 | 0 | 0 | 141 ms |
| `pnpm --filter @dam-hopper/ui test` | 275 Vitest files | 1,923 | 0 | 0 | 13.34 s |

Across command invocations: **1,939 passed, 0 failed, 0 skipped**; the 8 targeted frontend tests are also included in the full UI suite. Distinct test cases represented: **1,931** (8 Rust + 1,923 UI). Suite executions: **277** (1 Rust binary + 1 targeted Vitest file + 275 full-suite files). Total wall time across the three command invocations: **14.95 s** (0.26 s + 0.77 s + 13.92 s).

## Issues and validation notes

- No test failures.
- Full UI suite emitted jsdom `Not implemented: navigation (except hash changes)` messages (twice) and `Not implemented: HTMLCanvasElement.prototype.getContext` output from xterm WebGL. They did not fail any tests.
- Coverage was not collected; coverage was not among the requested commands.
- No separate build or lint was run; requested test commands only.

## Performance and build status

- Full UI Vitest run: **13.34 s** runner duration; 275 files, 1,923 tests.
- Targeted UI Vitest run: **141 ms** runner duration.
- Rust test body duration: **0.00 s** reported by Cargo.
- Build status: no separate build attempted.

## Recommendations / next steps

- No blocking follow-up indicated by test results.
- If the jsdom messages are unexpected, isolate the affected tests and mock navigation/canvas APIs; current output alone does not indicate a failed assertion.

## Unresolved questions

- None.
