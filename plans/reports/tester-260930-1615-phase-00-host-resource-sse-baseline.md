# Phase 00 host-resource SSE baseline — test report

## Test Results Overview

**Both commands passed.** The focused baseline passed 7/7. The complete server suite passed 1,709 tests, with 0 failures and 5 ignored across 62 suite result groups: **100% pass rate among executed tests**. The focused baseline is included in the full-suite count; rows are not additive.

| Command | Passed | Failed | Ignored | Filtered out | Test time / status |
|---|---:|---:|---:|---:|---|
| `cargo test --manifest-path server/Cargo.toml --test host_resource_baseline` | 7 | 0 | 0 | 0 | 0.74 s; PASS |
| `cargo test --manifest-path server/Cargo.toml` | 1,709 | 0 | 5 | 0 | PASS; 162.35 s wall time |
| **Full-suite aggregate** | **1,709** | **0** | **5** | **0** | **100% of executed tests passed** |

The full run discovered 1,714 tests: 1,709 executed and passed; 5 were marked ignored and not run. No test failures.

## Coverage Metrics

Coverage was not collected; line, branch, and function coverage are not measured. No threshold assessment possible.

## Failed Tests

None.

## Performance Metrics

- Focused baseline tests: 0.74 s test time.
- Full command: 162.35 s wall time; Cargo reported 50.17 s for test-profile compilation.
- No benchmark, memory, or leak checks run.

## Build Status

**PASS.** Full server test command compiled and completed successfully. Rust emitted warnings: unused imports in `tests/browser_debug_artifacts.rs`, `tests/idle_suspend.rs`, and `src/pty/tests.rs`; unused `TestClaims` in `tests/idle_suspend.rs`. No compile errors.

## Critical Issues

None. Five ignored tests were not exercised by the full run.

## Recommendations / Next Steps

- Review the 5 ignored tests separately if their environment-specific scenarios are release gates.
- Clean the reported unused-import/dead-code warnings in a separate scoped change.
- Collect coverage only if a numeric threshold is required.

## Unresolved Questions

None.
