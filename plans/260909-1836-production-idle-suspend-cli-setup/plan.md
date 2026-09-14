---
title: "Production CLI Deployment Setup for Idle Suspend Helper & Socket"
description: "Integrate dam-hopper-idle-suspend-helper.service and /run/dam-hopper/idle-suspend.sock into dam-hopper-manager CLI"
status: complete
priority: P2
effort: 3h
branch: feat/terminal-idle-suspend
tags: [idle-suspend, systemd, deployment, release-manager]
created: 2026-09-09
---

# Production CLI Deployment Setup for Idle Suspend Helper & Socket

## Executive Summary
This plan specifies the production deployment architecture and CLI lifecycle management for the privileged Linux idle-suspend helper (`dam-hopper-idle-suspend-helper`) and its Unix domain socket (`/run/dam-hopper/idle-suspend.sock`). Under the agreed **Integrated Release Manager** model, `dam-hopper-manager` (`dam-hopper` CLI) automatically stages, enables, and manages the helper systemd service alongside the API server, ensuring seamless installation (`sudo dam-hopper install`), startup (`sudo dam-hopper start`), and rollback without manual operator daemon setup.

## Problem Statement
While the core idle-suspend engine is functional, production CLI deployment via `dam-hopper-install.sh` and `dam-hopper-manager` has three critical integration gaps:
1. **Unstaged Unit**: `server/src/linux_release/stage_units.rs` does not stage `dam-hopper-idle-suspend-helper.service` to `/etc/systemd/system/`.
2. **Missing PID Linkage**: `dam-hopper-api.service.in` does not write `/run/dam-hopper/server.pid`, causing peer authentication (`--enrolled-pid-file`) to fail when enabled.
3. **Unmanaged Lifecycle**: `server/src/linux_release/activate.rs` (`sudo dam-hopper start`) and `rollback.rs` do not start or stop the helper service during candidate release transitions.

## Architecture & Peer Security Model
- **Supervision**: `systemd` supervises both `dam-hopper-idle-suspend-helper.service` (root, `CAP_WAKE_ALARM`) and `dam-hopper-api.service` (service user).
- **Socket Path**: `/run/dam-hopper/idle-suspend.sock` (mode `0660`, owned by root with group matching API service group).
- **Peer Authentication**: `SO_PEERCRED` kernel socket credentials verification in `server/src/idle_suspend/peer_auth.rs`:
  - Enrolled UID check matches API service account.
  - Enrolled PID check matches `/run/dam-hopper/server.pid` populated via systemd `ExecStartPost`.

## Phases Overview

| Phase | Description | Deliverable | Status | Progress |
|---|---|---|---|---|
| **Phase 01** | Systemd Service Unit Templates & PID Management | Updated `.service.in` templates with PID file and socket group configuration | DONE (2026-09-09) | 100% |
| **Phase 02** | Release Manager Unit Staging (`stage_units.rs`) | Dynamic helper unit rendering and staging in `stage_units.rs` | DONE (2026-09-10) | 100% |
| **Phase 03** | Release Manager Service Lifecycle (`activate.rs`, `rollback.rs`, `status.rs`) | Coordinated start, stop, and status inspection in `dam-hopper` CLI | DONE (2026-09-10) | 100% |
| **Phase 04** | Verification, Boundary Enforcement & End-to-End Testing | Unit tests, security boundary validation, and UAT CLI test | DONE (2026-09-10) | 100% |

**Current plan status:** COMPLETE — All phases (01–04) DONE (100% overall; 4/4 phases at 100%).

**Progress:** 100% (4/4 phases complete).

## Phase Links
- [cmd-plan.md](./cmd-plan.md)
- [Phase 01: Systemd Service Unit Templates & PID Management](./phase-01-systemd-service-templates-and-pid-management.md)
- [Phase 02: Release Manager Unit Staging](./phase-02-release-manager-unit-staging.md)
- [Phase 03: Release Manager Service Lifecycle](./phase-03-release-manager-service-lifecycle.md)
- [Phase 04: Verification, Boundary Enforcement & End-to-End Testing](./phase-04-verification-boundary-enforcement-and-e2e.md)

---

## Validation Summary

**Validated:** 2026-09-10  

**Questions asked:** 4  

### Confirmed Decisions
1. **Helper Failure Tolerance**: Log warning and continue if helper fails to start; do not abort API server boot. Non-suspend features remain fully accessible.
2. **PID File Population**: Systemd `ExecStartPost` writes `$MAINPID` to `/run/dam-hopper/server.pid`, and `ExecStopPost` removes it upon service stop. Zero custom server codebase changes needed.
3. **Socket Group Ownership**: Socket created with mode `0660` and `Group=@API_GROUP@` so only root and the authorized API service account can communicate over it.
4. **Helper Restart Policy**: `Restart=on-failure` with `RestartSec=5s`. Restarts the daemon process on crash; does not trigger or affect host machine reboots.

### Action Items
- Phases 01–04 DONE (Phase 01: 2026-09-09; Phases 02–04: 2026-09-10); production CLI deployment setup complete.
- Parent plan status: COMPLETE (100%).
