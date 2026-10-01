# Test Report: Phase 02 — Transport and Owned Queries

**Date:** 2026-10-01 21:51 (Asia/Saigon)  
**Status:** PASS

## Test Results Overview

| Command scope | Passed | Failed | Skipped / filtered | Result |
|---|---:|---:|---:|---|
| UI targeted Vitest (3 files) | 71 | 0 | 0 skipped | PASS |
| Server `cargo test git_log` | 2 | 0 | 1,759 filtered | PASS |
| **Executed tests total** | **73** | **0** | **0 skipped** | **100% pass rate** |

Both UI TypeScript checks also passed: `pnpm --filter @dam-hopper/ui exec tsc --noEmit` and `pnpm --filter @dam-hopper/web exec tsc --noEmit` (no diagnostics; exit success). The Cargo summary covered 63 suites; only the two matching Git log tests ran.

## Coverage Metrics

Coverage was not collected by the requested commands.

## Failed Tests

None.

## Performance Metrics

- Vitest: 3 files, 71 tests; runner duration 691 ms.
- Git log tests: 2 tests; test target duration 0.89 s (Cargo command wall time 2.44 s).
- UI TypeScript check wall time: 8.85 s; web TypeScript check wall time: 8.87 s.

## Build Status

All requested commands completed successfully. Cargo emitted non-fatal warnings for unused imports in `src/pty/tests.rs`, `tests/browser_debug_artifacts.rs`, and `tests/idle_suspend.rs`, plus an unused `TestClaims` struct in `tests/idle_suspend.rs`. No warnings were reported by either TypeScript check.

## Critical Issues

None. Acceptance criteria met: all 73 executed tests passed, and both TypeScript checks passed.

## Recommendations and Next Steps

No corrective action required for this scope. If warning-free Rust test builds are required, clean the listed unrelated unused test imports/dead code separately. Run coverage as a separate validation if coverage metrics are needed.

## Unresolved Questions

None.
