# Phase 04: Verification, Boundary Enforcement & End-to-End Testing

## 1. Context Links
- Parent Plan: [plan.md](./plan.md)
- Architecture Overview: [cmd-plan.md](./cmd-plan.md)
- Previous Phase: [Phase 03: Release Manager Service Lifecycle](./phase-03-release-manager-service-lifecycle.md)
- Relevant Docs: `docs/terminal-idle-suspend-security.md`, `docs/linux-release-manager.md`

## 2. Overview
- **Date**: 2026-09-09
- **Description**: Add unit and integration tests covering helper unit staging, lifecycle management, and boundary verification for the Integrated Release Manager deployment.
- **Priority**: P2
- **Implementation Status**: Pending
- **Review Status**: Pending

## 3. Key Insights
- The codebase relies on automated test suites (`server/src/linux_release/tests.rs`) and security verification scripts (`./scripts/verify-idle-suspend-boundary.sh`) to prevent architectural regressions.
- Updating `verify-idle-suspend-boundary.sh` ensures that unit files and release manager staging retain strict systemd sandboxing directives and zero shell/sudo leaks.
- End-to-end testing in the local workstation verifies the full CLI installation and startup flow (`dam-hopper start`).

## 4. Requirements
- All tests in `server/src/linux_release/` MUST pass.
- All tests in `server/src/idle_suspend/` MUST pass.
- `./scripts/verify-idle-suspend-boundary.sh` MUST pass with 0 failures.
- CLI verification: `dam-hopper status` displays healthy status for both API and idle-suspend helper services.

## 5. Architecture
```text
Verification Pipeline
  │
  ├─ 1. Unit Tests (`cargo test --lib linux_release`)
  │       ├─ Stage unit template validation
  │       └─ Service activation ordering
  │
  ├─ 2. Boundary Verification (`scripts/verify-idle-suspend-boundary.sh`)
  │       ├─ Systemd sandboxing directives check
  │       └─ Zero-leak sudo/shell validation
  │
  └─ 3. End-to-End CLI Smoke Test
          ├─ Staging candidate release
          ├─ `dam-hopper start`
          └─ Status inspection and force-suspend probe
```

## 6. Related Code Files
- `server/src/linux_release/tests.rs`
- `scripts/verify-idle-suspend-boundary.sh`
- `deploy/systemd/dam-hopper-idle-suspend-helper.service`
- `deploy/systemd/dam-hopper-api.service`

## 7. Implementation Steps
1. Update `server/src/linux_release/tests.rs`:
   - Add test case verifying `stage_units` generates `dam-hopper-idle-suspend-helper.service`.
   - Add test case verifying `activate` attempts to start `dam-hopper-idle-suspend-helper.service`.
2. Update `scripts/verify-idle-suspend-boundary.sh`:
   - Assert `dam-hopper-idle-suspend-helper.service` template exists and retains `ProtectSystem=strict`, `NoNewPrivileges=yes`, `CapabilityBoundingSet=CAP_WAKE_ALARM`.
   - Assert `dam-hopper-api.service` retains `PIDFile=/run/dam-hopper/server.pid`.
3. Run `cargo test --lib linux_release` and `cargo test --lib idle_suspend`.
4. Run `./scripts/verify-idle-suspend-boundary.sh`.
5. Execute end-to-end CLI smoke test on candidate release.

## 8. Todo List
- [ ] Add test cases to `server/src/linux_release/tests.rs`
- [ ] Update `scripts/verify-idle-suspend-boundary.sh` checks
- [ ] Run cargo tests across release and idle-suspend modules
- [ ] Run boundary script and verify 100% pass

## 9. Success Criteria
- 100% pass on all cargo unit/integration tests in `server/`.
- 100% pass on `./scripts/verify-idle-suspend-boundary.sh`.
- Staged production units are valid per `systemd-analyze verify`.

## 10. Risk Assessment
- **Risk**: Test fixtures lacking systemd mocks fail on CI environments.
- **Mitigation**: Reuse existing `SystemdMock` and `tempdir()` patterns in `linux_release/tests.rs`.

## 11. Security Considerations
- Ensure no root credentials or hardcoded paths are exposed in tests or CLI output.

## 12. Next Steps
- Complete phase and prepare for plan execution via `/cmd-code`.
