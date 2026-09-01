# Phase 02 Test Report — Workflow Service and REST API

- **Directory:** `server/`
- **Scope:** Workflow unit tests, workflow REST API integration tests, full server suite
- **Overall status:** PASS — 0 failures in all requested commands

## Test Results Overview

| Command | Tests run | Passed | Failed | Ignored | Filtered | Rust test time | Wall time |
|---|---:|---:|---:|---:|---:|---:|---:|
| `cargo test --lib workflow::` | 14 | 14 | 0 | 0 | 801 | 0.03s | 33.66s |
| `cargo test --test workflow_api` | 8 | 8 | 0 | 0 | 0 | 1.50s | 1.85s |
| `cargo test` | 898 discovered / 896 executed | 896 | 0 | 2 | 0 | 17.83s aggregate | 26.07s |

- **Targeted workflow pass rate:** 100% (14/14)
- **Workflow API pass rate:** 100% (8/8)
- **Full executed-test pass rate:** 100% (896/896)
- Full suite: 14 test targets; 896 passed, 0 failed, 2 ignored.
- Full library target: 814 passed, 0 failed, 1 ignored.
- Full integration targets: 82 passed, 0 failed, 1 ignored.
- Main binary unit tests and doc-tests: 0 tests, both successful.

## Workflow Coverage

The targeted unit command passed all 14 `workflow::tests::*` cases, including hierarchy validation, item/session transitions, timestamps and limits, target isolation, replay/idempotency, CRUD invariants, notes, pagination/purge, overview progress, and migration/data preservation.

The targeted API command passed all 8 `workflow_api` cases, including authentication, hierarchy/plan-first behavior, session lifecycle and notes, invalid transitions, replay/CAS concurrency, validation limits, unknown projects, event pagination, and history purge.

## Ignored Tests

Cargo reported two existing ignored tests; neither is a failure:

1. `pty::tests::pty_tests::codex_usage_enabled_and_disabled_pty_performance_is_equivalent` — manual PTY performance gate.
2. `codex_0146_schema_proves_thread_list_cannot_exclude_content` — requires pinned `codex-cli 0.146.0`; available local binary reports `codex-cli 0.151.0`.

## Coverage Metrics

Source line/branch/function coverage was not generated. No `cargo-llvm-cov`, `cargo-tarpaulin`, or `grcov` binary, nor project coverage script/config, is available in this checkout. Test execution metrics above are not source-coverage percentages.

## Build and Performance

- Cargo test profile compiled successfully.
- No compiler warnings appeared in the full-suite output.
- Slowest full target: library unit tests, 10.74s.
- Workflow API integration target completed in 1.45s during the full run.

## Failed Tests / Critical Issues

None. No test failures or blocking issues.

## Recommendations / Next Steps

- Provision/pin `codex-cli 0.146.0` in CI if the ignored compatibility gate must be executed rather than reported ignored.
- Add a pinned Rust coverage tool (for example, `cargo-llvm-cov`) and CI threshold if source coverage metrics are required.

## Unresolved Questions

- Should CI provision `codex-cli 0.146.0` to run the existing ignored compatibility test?
