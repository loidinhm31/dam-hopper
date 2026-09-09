# Implementation Plan: Production CLI Deployment for Idle Suspend

**Goal**: Seamless production setup of `dam-hopper-idle-suspend-helper.service` and `/run/dam-hopper/idle-suspend.sock` via `dam-hopper` release manager CLI.  
**Architecture**: Integrated Release Manager Model (systemd supervision + SO_PEERCRED authentication).  
**Parent Document**: [plan.md](./plan.md)  
**Report Reference**: [plans/reports/brainstorm-260909-1836-production-idle-suspend-cli-setup.md](../reports/brainstorm-260909-1836-production-idle-suspend-cli-setup.md)

---

## Phase Status Summary

| Phase | Description | Status | Progress | Link |
|---|---|---|---|---|
| **Phase 01** | Systemd Service Templates & PID Management | DONE (2026-09-09) | 100% | [phase-01-systemd-service-templates-and-pid-management.md](./phase-01-systemd-service-templates-and-pid-management.md) |
| **Phase 02** | Release Manager Unit Staging (`stage_units.rs`) | DONE (2026-09-10) | 100% | [phase-02-release-manager-unit-staging.md](./phase-02-release-manager-unit-staging.md) |
| **Phase 03** | Service Lifecycle (`activate.rs`, `rollback.rs`, `status.rs`) | Pending | 0% | [phase-03-release-manager-service-lifecycle.md](./phase-03-release-manager-service-lifecycle.md) |
| **Phase 04** | Verification, Boundary Enforcement & E2E Validation | Pending | 0% | [phase-04-verification-boundary-enforcement-and-e2e.md](./phase-04-verification-boundary-enforcement-and-e2e.md) |

---

## Execution Command
To begin execution once approved:
```bash
/cmd-code plans/260909-1836-production-idle-suspend-cli-setup/plan.md
```
