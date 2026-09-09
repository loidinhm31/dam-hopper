# Phase 03: Release Manager Service Lifecycle (`activate.rs`, `rollback.rs`, `status.rs`)

## 1. Context Links
- Parent Plan: [plan.md](./plan.md)
- Architecture Overview: [cmd-plan.md](./cmd-plan.md)
- Previous Phase: [Phase 02: Release Manager Unit Staging](./phase-02-release-manager-unit-staging.md)
- Next Phase: [Phase 04: Verification, Boundary Enforcement & End-to-End Testing](./phase-04-verification-boundary-enforcement-and-e2e.md)
- Relevant Docs: `docs/linux-release-manager.md`, `docs/terminal-idle-suspend-security.md`

## 2. Overview
- **Date**: 2026-09-09
- **Description**: Integrate `dam-hopper-idle-suspend-helper.service` into `dam-hopper start`, `dam-hopper status`, and `dam-hopper rollback`/`recover` workflows.
- **Priority**: P2
- **Implementation Status**: Pending
- **Review Status**: Pending

## 3. Key Insights
- When `sudo dam-hopper start` is invoked, `server/src/linux_release/activate.rs` starts services according to role.
- Starting the helper daemon before starting the API server ensures `/run/dam-hopper/idle-suspend.sock` is immediately available when `dam-hopper-server` launches, avoiding race conditions.
- On service stop or rollback, the helper daemon should be stopped gracefully (`systemctl stop dam-hopper-idle-suspend-helper.service`).
- `dam-hopper status` should inspect and report the helper service state alongside the API server state.

## 4. Requirements
- `activate.rs`: `sudo dam-hopper start` MUST start `dam-hopper-idle-suspend-helper.service` whenever `role.includes_server()`.
- Helper service startup failure must be handled gracefully: if the host does not support helper or fails to start, log a warning, but allow API server startup to proceed so non-suspend operations are not blocked.
- `rollback.rs`: `sudo dam-hopper rollback` and `recover.rs` MUST stop `dam-hopper-idle-suspend-helper.service` during transition and restart it for active rollback version.
- `status.rs`: `dam-hopper status` MUST query and surface `dam-hopper-idle-suspend-helper.service` active status.

## 5. Architecture
```text
sudo dam-hopper start
  │
  ├─ 1. systemctl daemon-reload
  ├─ 2. If server role:
  │       ├─ systemctl start dam-hopper-idle-suspend-helper.service
  │       └─ systemctl start dam-hopper-api.service
  ├─ 3. If web role:
  │       └─ systemctl start dam-hopper-web.service
  └─ 4. wait_for_health_stability()
```

## 6. Related Code Files
- `server/src/linux_release/activate.rs`
- `server/src/linux_release/rollback.rs`
- `server/src/linux_release/recover.rs`
- `server/src/linux_release/status.rs`
- `server/src/linux_release/systemd.rs`

## 7. Implementation Steps
1. In `server/src/linux_release/activate.rs`:
   - Inside `if active_candidate.role.includes_server()`:
     - Add `systemctl_start(super::constants::HELPER_SERVICE_UNIT)` before `systemctl_start("dam-hopper-api.service")`.
     - Allow non-fatal warning if helper start fails on unsupported environments.
2. In `server/src/linux_release/rollback.rs`:
   - Inside service stop logic:
     - Add `systemctl_stop(super::constants::HELPER_SERVICE_UNIT)`.
   - Inside post-rollback start logic:
     - Add `systemctl_start(super::constants::HELPER_SERVICE_UNIT)` if role includes server.
3. In `server/src/linux_release/status.rs`:
   - Query `inspect_service_process(super::constants::HELPER_SERVICE_UNIT)`.
   - Include helper unit in `dam-hopper status` table/JSON output under Server services.
4. Update unit tests in `server/src/linux_release/` covering activation and status reporting.

## 8. Todo List
- [ ] Add helper service startup to `activate.rs`
- [ ] Add helper service stop/restart to `rollback.rs` and `recover.rs`
- [ ] Include helper status in `status.rs`
- [ ] Add unit tests for release manager lifecycle transitions

## 9. Success Criteria
- `sudo dam-hopper start` starts both `dam-hopper-idle-suspend-helper.service` and `dam-hopper-api.service`.
- `dam-hopper status` reports status of both API and idle-suspend helper services.
- `sudo dam-hopper rollback` stops and restarts the helper unit cleanly.

## 10. Risk Assessment
- **Risk**: Helper failure blocks API server startup on environments without RTC/suspend support.
- **Mitigation**: Log error/warning if helper fails to start, but do not abort API server activation.

## 11. Security Considerations
- Ensure helper is stopped before switching release symlinks to prevent running binary code from unlinked older release directories.

## 12. Next Steps
- Proceed to [Phase 04: Verification, Boundary Enforcement & End-to-End Testing](./phase-04-verification-boundary-enforcement-and-e2e.md).
