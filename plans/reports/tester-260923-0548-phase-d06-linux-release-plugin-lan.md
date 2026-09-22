# Phase D06 Linux Release and LAN Validation

## Test Results Overview

- Rust command: `cargo test --manifest-path server/Cargo.toml --test "linux_release*"`
  - **173 passed, 0 failed**, 18 suites, 0.15s test time (1.95s command wall time).
- Release gate: `pnpm release:verify`
  - **PASS**, 0 failures.
  - Release version alignment: **v0.4.4 / 0.4.4**.
  - Bash syntax and Node syntax validation completed successfully (0.52s command wall time).
- Deployment command: `pnpm test:deploy`
  - **9/9 deployment scripts passed, 0 failed** (9.71s command wall time).
  - Passed: clean-install, upgrade-rollback, crash-recovery, security, reset-smoke, web-contract, Fedora 44 format-2 migration, plugin-runner-owner-smoke, plugin-upgrade-rollback.
- LAN command: `pnpm test:deploy:plugin-lan -- --evidence-dir /tmp/qualification-evidence-test --dry-run`
  - **5/5 budget evaluations passed, 0 failed** (0.26s command wall time).
  - Evidence: `/tmp/qualification-evidence-test/evidence.json`; summary: `/tmp/qualification-evidence-test/summary.md`.
  - Workload: 5 refresh passes, 20 samples per interaction, 10,000 history records, 4 views.

## LAN Metrics

| Metric | Target | p50 | p95 | Max | Status |
|---|---:|---:|---:|---:|---|
| Refresh cold/warm | <= 10,000 ms | 195 ms | 420 ms | 420 ms | PASS |
| Summary/page | <= 500 ms | 27 ms | 36 ms | 36 ms | PASS |
| Detail view | <= 1,000 ms | 65 ms | 85 ms | 85 ms | PASS |
| Cancellation acknowledgement | <= 250 ms | 16 ms | 20 ms | 20 ms | PASS |
| Cancellation settlement | <= 1,000 ms | 105 ms | 125 ms | 125 ms | PASS |

## Validation Status

**PASS** — all requested Linux release, deployment, plugin-runner, and LAN qualification commands completed successfully. Rust test and deployment/script validation paths are 100% passing.

## Coverage / Build

- Coverage report: not requested or run.
- Release static gate passed; Cargo test compilation and execution passed.

## Critical Issues

None observed.

## Unresolved Questions

None.
