---
title: "DamHopper systemd system service"
description: "Plan an admin-installed system service that always runs DamHopper as loidinh."
status: in-progress
priority: P2
effort: 4.5h
branch: feat/systemd-system-service
tags: [infra, backend, security]
created: 2026-08-17
---

# DamHopper systemd System Service

## Overview

Design a minimal system unit managed by an administrator but executed directly as
`User=loidinh`. Preserve user-owned private runtime state, loopback/auth defaults, graceful
SIGTERM shutdown, `Restart=on-failure`, and journald.

## Decision

Use the system-unit-as-loidinh option from
[the advisor brief](./reports/01-advisor-decision-brief.md). User units are blocked by supplied
user-bus evidence; nohup remains rollback only.

## Preflight Contract

- **Final output:** future unit asset, administrator install/rollback handoff, and recorded
  non-privileged/manual evidence.
- **Acceptance criteria:** effective UID loidinh; loopback `4800`; auth enabled; explicit
  HOME/XDG/config/binary/web/working paths; journald; on-failure restart; clean SIGTERM.
- **Scope / non-goals:** unit asset and docs only; no package, installer script, privileged helper,
  server code change, automatic deployment, root process, or no-auth mode.
- **Constraints:** no noninteractive sudo; no user bus; current nohup owns `0.0.0.0:4800`;
  live SQLite files must have one process owner; `/opt/dam-hopper/web` is absent.
- **Touchpoints:** `server/src/main.rs`, `server/src/state.rs`,
  `server/src/api/router.rs`, `deploy/run-linux-nohup.sh`, deployment docs/assets.
- **Tests / manual checks:** isolated `127.0.0.1:4801` gate first; unit syntax/static checks;
  non-root identity checks; admin-only install/start/log/rollback checklist.

## Phases

Overall progress: 22% (1h of 4.5h effort complete)

| # | Phase | Status | Effort | Progress |
| --- | --- | --- | --- | --- |
| 01 | [Isolated port-4801 feasibility gate](./phase-01-isolated-port-4801-feasibility-gate.md) | Done | 1h | 100% |
| 02 | [Service asset and administrator handoff](./phase-02-service-asset-and-administrator-handoff.md) | Pending | 2h | 0% |
| 03 | [Verification and rollback validation](./phase-03-verification-and-rollback-validation.md) | Pending | 1.5h | 0% |

## Dependencies

- Phase 01 must pass before Phase 02 starts.
- Phase 02 asset/docs must exist before Phase 03 static and administrator checks.
- Administrator actions remain outside repository automation.

## Unresolved Questions

- Serve UI from explicit `/opt/dam-hopper/web`, or use an external UI host with exact CORS?
