# QA Test Report: Phase 02 Release Manager Unit Staging

**Date:** 2026-09-09 23:46
**Target Suite:** Linux Release Unit Policy & Unit Staging
**Targets:**
- `server/tests/linux_release_unit_policy.rs`
- `server/tests/linux_release_staging.rs`
- `server/src/linux_release/stage_units.rs`
- `server/src/linux_release/unit.rs`
- `server/src/linux_release/unit_policy.rs`

---

## Test Results Overview

| Suite / Command | Run | Passed | Failed | Ignored | Filtered | Duration | Status |
|---|---|---|---|---|---|---|---|
| `cargo test --test linux_release_unit_policy` | 10 | 10 | 0 | 0 | 0 | 0.24s | PASS |
| `cargo test --test linux_release_staging` | 6 | 6 | 0 | 0 | 0 | 0.21s | PASS |
| `cargo test --test 'linux_release*'` (16 suites) | 123 | 123 | 0 | 0 | 0 | 0.16s | PASS |
| **Total Unique Suite Scope** | **123** | **123** | **0** | **0** | **0** | **0.61s** | **PASS** |

### Suite Breakdown (`linux_release*`)
- `tests/linux_release_acquisition.rs`: 3 passed, 0 failed
- `tests/linux_release_archive.rs`: 5 passed, 0 failed
- `tests/linux_release_cli.rs`: 13 passed, 0 failed
- `tests/linux_release_format2_migration_drift.rs`: 10 passed, 0 failed
- `tests/linux_release_format2_migration_exchange.rs`: 3 passed, 0 failed
- `tests/linux_release_format2_migration_fixture.rs`: 1 passed, 0 failed
- `tests/linux_release_health.rs`: 7 passed, 0 failed
- `tests/linux_release_manifest.rs`: 2 passed, 0 failed
- `tests/linux_release_manifest_errors.rs`: 26 passed, 0 failed
- `tests/linux_release_ownership.rs`: 5 passed, 0 failed
- `tests/linux_release_platform.rs`: 7 passed, 0 failed
- `tests/linux_release_publisher_contract.rs`: 7 passed, 0 failed
- `tests/linux_release_staging.rs`: 6 passed, 0 failed
- `tests/linux_release_state_machine.rs`: 10 passed, 0 failed
- `tests/linux_release_unit_policy.rs`: 10 passed, 0 failed
- `tests/linux_release_web_host.rs`: 8 passed, 0 failed

---

## Scope & Coverage Analysis

1. **Idle-Suspend Helper Unit Staging:**
   - Helper unit template loaded and rendered via `render_helper_unit`.
   - Helper service staged to `pending_units` when target role includes server (`TargetRole::Server` and `TargetRole::Both`).
   - Non-server role (`TargetRole::Web`) excludes helper unit staging.
   - Staging candidate presence explicitly validated in `linux_release_unit_policy.rs` and `linux_release_staging.rs`.

2. **Template Rendering & Allowlist Enforcement:**
   - Allowlisted tokens (`@RELEASE_ROOT@`, `@RELEASE_VERSION@`, `@PUBLIC_CONFIG@`, `@API_ORIGINS@`, `@API_USER@`, `@API_GROUP@`, `@API_HOME@`) verified.
   - Unknown tokens (`@UNKNOWN_TOKEN@`) and unresolved leftover tokens rejected.
   - Control character injection (`\n`, `\r`, `\0`, `\t`) in paths/identities rejected.

3. **Systemd Unit Policy Enforcement:**
   - Helper unit: `Type=simple`, `User=root`, `Group=@API_GROUP@`, `RuntimeDirectory=dam-hopper`, `RuntimeDirectoryMode=0775`, `StateDirectory=dam-hopper`, `LogsDirectory=dam-hopper`, `Restart=on-failure`, `RestartSec=5s`, `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=15s`, `UMask=0007`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `CapabilityBoundingSet=CAP_WAKE_ALARM`, `SyslogIdentifier=dam-hopper-idle-suspend-helper`.
   - ExecStart validated: `{release_root}/bin/dam-hopper-idle-suspend-helper --socket /run/dam-hopper/idle-suspend.sock --audit-file /var/log/dam-hopper/idle-suspend-helper.jsonl --enrolled-pid-file /run/dam-hopper/server.pid`.
   - API unit: root execution strictly prohibited, cross-service coupling to web rejected, PID file tracking enforced (`/run/dam-hopper/server.pid`).
   - Web unit: `EnvironmentFile` and `ReadWritePaths` strictly prohibited.

---

## Build Status & Diagnostics
- `cargo check --test linux_release_unit_policy --test linux_release_staging`: Clean, 0 errors, 0 warnings.
- Test suites compilation: Clean, 0 warnings in target files.

---

## Failed Tests
None. 100% pass rate.

---

## Performance Metrics
- `linux_release_unit_policy`: 0.24s total execution.
- `linux_release_staging`: 0.21s total execution.
- `linux_release*` (16 suites): 0.16s combined test execution.
- Slowest individual test: `test_stage_candidate_units_roles` (~0.22s) due to disk I/O and isolated temp directories.

---

## Critical Issues
None. All security invariants and staging contracts satisfied.

---

## Recommendations
- Retain explicit assertion in `test_staging_fresh_install_success` verifying `dam-hopper-idle-suspend-helper.service` creation during server staging.

---

## Next Steps
1. Proceed to Phase 03 integration validation.
2. Maintain unit policy constraints during future systemd unit modifications.

---

## Unresolved Questions
None.
