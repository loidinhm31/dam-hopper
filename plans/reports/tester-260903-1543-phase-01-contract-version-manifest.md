# Phase 01 Test Report — Contract, Version, and Manifest

## Test Results Overview

- Requested command 1: `cargo test --manifest-path server/Cargo.toml --test linux_release_manifest --test linux_release_manifest_errors`
  - Suites: 2
  - Executed: 20
  - Passed: 20
  - Failed: 0
  - Ignored: 0
  - Result: 100% pass
  - Breakdown: `linux_release_manifest` 2/2; `linux_release_manifest_errors` 18/18.
- Requested command 2: `cargo test --manifest-path server/Cargo.toml linux_release`
  - Test binaries/suites started: 14
  - Executed: 10
  - Passed: 10
  - Failed: 0
  - Ignored: 0
  - Filtered by name: 896
  - Result: 100% pass for executed tests
  - Breakdown: library unit tests 8/8; `linux_release_manifest_errors` selected integration tests 2/2.
- Combined command invocations: 30/30 passed, 0 failed.
- Unique test cases exercised: 28/28; two manifest-error tests intentionally rerun by command 2.

## Coverage Metrics

Coverage instrumentation not requested or run. No line, branch, or function percentages available.

## Failed Tests

None.

## Performance Metrics

- Both cargo test commands completed successfully.
- Each executed suite reported `finished in 0.00s`.
- No slow test identified.

## Build Status

Pass. Cargo test profile compiled and executed all requested targets without warnings or errors in the captured output.

## Critical Issues

None for the requested Phase 01 test scope.

## Recommendations

- Preserve the requested manifest and `linux_release` test commands as the Phase 01 regression gate.
- Run a separate full workspace/server test command before release because the `linux_release` name filter excluded 896 tests.
- Add coverage instrumentation only if a coverage threshold is required; this run did not produce coverage data.

## Next Steps

1. Main agent reruns the project-wide validation gate after all Phase 01 changes land.
2. Review the 896 filtered tests in the broader server suite during release validation.

## Unresolved Questions

None.
