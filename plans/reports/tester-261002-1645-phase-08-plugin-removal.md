# Tester Report: Phase 08 — Remove Evcrate Plugin Integration and Release Assets

- **Date:** 2026-10-02
- **Scope:** Requested Dam-Hopper and Evcrate validation commands
- **Result:** PASS — all 8 commands completed successfully. **2,627 passed, 0 failed, 24 skipped** across 2,651 reported test cases. Evcrate build succeeded.

## Test Results Overview

| Repository | Command | Result | Passed | Failed | Skipped | Runner output |
|---|---|---:|---:|---:|---:|---|
| Dam-Hopper | `cargo test advisor --manifest-path server/Cargo.toml` | PASS | 34 | 0 | 0 | 53 test suites; 1,691 filtered out |
| Dam-Hopper | `pnpm --filter @dam-hopper/ui test` | PASS | 2,206 | 0 | 0 | 293/293 files passed; 15.56 s |
| Evcrate | `npm run build` | PASS | — | — | — | Prebuild generators and TypeScript compilation completed; 9.48 s command wall time |
| Evcrate | `npm run test:advisor-metrics` | PASS | 6 | 0 | 0 | 293.24 ms |
| Evcrate | `npm run test:advisor-controller` | PASS | 234 | 0 | 24 | 258 total; 9,493.49 ms |
| Evcrate | `npm run test:protocol` | PASS | 53 | 0 | 0 | 335.14 ms |
| Evcrate | `npm run test:release` | PASS | 34 | 0 | 0 | 14,363.36 ms |
| Evcrate | `node --test tests/viewer/*.test.mjs` | PASS | 60 | 0 | 0 | 197,348.28 ms |
| **Total tests** |  |  | **2,627** | **0** | **24** | **2,651 test cases reported** |

Cargo's 34 matches comprise 25 library tests, 8 advisor history API tests, and 1 matching Linux release test. The `advisor` filter excluded 1,691 tests; these are not included in the totals above. `npm run build` is a build command, not a test count.

## Command Output Summaries

- `cargo test advisor --manifest-path server/Cargo.toml`: `34 passed (53 suites, 1691 filtered, 0.00s)`; no failures.
- `pnpm --filter @dam-hopper/ui test`:
  ```text
   Test Files  293 passed (293)
        Tests  2206 passed (2206)
     Duration  15.56s
  ```
- `npm run build`: prebuild ran `generate-runtime-brief.mjs`, `tsc -p tsconfig.advisor-runtime.json`, and `generate-controller-inventory.mjs`; `tsc -p tsconfig.json` completed successfully.
- `npm run test:advisor-metrics`:
  ```text
  ℹ tests 6
  ℹ pass 6
  ℹ fail 0
  ℹ skipped 0
  ℹ duration_ms 293.241364
  ```
- `npm run test:advisor-controller`:
  ```text
  ℹ tests 258
  ℹ pass 234
  ℹ fail 0
  ℹ skipped 24
  ℹ duration_ms 9493.491603
  ```
- `npm run test:protocol`:
  ```text
  ℹ tests 53
  ℹ pass 53
  ℹ fail 0
  ℹ skipped 0
  ℹ duration_ms 335.142476
  ```
- `npm run test:release`: prepack/build and registry generation completed; release asset verifier usage text was printed by a test. Final TAP summary:
  ```text
  ℹ tests 34
  ℹ pass 34
  ℹ fail 0
  ℹ skipped 0
  ℹ duration_ms 14363.364152
  ```
- `node --test tests/viewer/*.test.mjs`:
  ```text
  ℹ tests 60
  ℹ pass 60
  ℹ fail 0
  ℹ skipped 0
  ℹ duration_ms 197348.283889
  ```

## Issues and Performance

- **No failing tests or blocking build issues.** Coverage was not collected; none of the requested commands enables coverage instrumentation.
- Rust test compilation reported unused-import warnings in `tests/browser_debug_artifacts.rs`, `src/pty/tests.rs`, and `tests/idle_suspend.rs`, plus unused `TestClaims` in `tests/idle_suspend.rs`.
- UI tests emitted two jsdom `Not implemented: navigation (except hash changes)` diagnostics. The test command still passed all 2,206 tests.
- Viewer tests emitted Node `[MODULE_TYPELESS_PACKAGE_JSON]` warnings for `viewer/src/app-state.ts` and `viewer/src/hash-view.ts`; Node reparsed these files as ESM.
- The 24 advisor-controller skips are explicitly gated with `{ skip: !isWindows }`; they are Windows-only controller/supervision/console cases skipped on this Linux run.
- **Slowest observed test:** viewer `AME-029: pack inventory excludes standalone viewer and excludes sources, configs, maps` took 196,725.96 ms of the 197,348.28 ms viewer suite. Release test `packed artifact allowlist is Python-free, plan-free, test-free, and contains runtime assets` took 13,285.93 ms.
- No separate performance benchmark or memory check was run.

## Recommendations / Next Steps

1. Ensure the 24 Windows-gated controller tests run in Windows CI.
2. Investigate the `AME-029` pack-inventory test duration; it dominates the viewer command runtime.
3. Reduce non-failing test noise by handling jsdom anchor navigation in the UI tests and clarifying viewer module format without changing unrelated package module semantics.
4. Clean up the reported Rust unused-import/dead-code warnings when in scope.

## Unresolved Questions

None. The skipped controller tests' `isWindows` gates were confirmed in the test sources.
