---
title: "Server-Authoritative Terminal Idle Suspend"
description: "Add an opt-in fail-closed Linux suspend policy with authoritative PTY state, bounded authenticated timing settings, and read-only live status."
status: pending
priority: P1
effort: 68h
branch: feat/terminal-idle-suspend
tags: [feature, backend, frontend, security, infra]
created: 2026-08-24
---

# Server-Authoritative Terminal Idle Suspend

## Overview

Add startup-owned terminal-fleet monitoring that may request one fixed RTC-timed Linux suspend after a bounded empty-fleet quiet period. Enablement/helper enrollment remain operator-only; authenticated Settings users may atomically update only the bounded quiet/wake pair. Browser output stays informational, and the host-resource popover stays read-only.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---|---:|---|
| 1 | Policy, config, security gate, protocol | Done | 100% | 10h | [Phase 01](./phase-01-policy-config-security-gate.md) |
| 2 | PTY fleet seam and fake coordinator | Done | 100% | 18h | [Phase 02](./phase-02-pty-fleet-coordinator.md) |
| 3 | Privileged helper, systemd enrollment, audit | Blocked on sign-off | 0% | 20h | [Phase 03](./phase-03-privileged-helper-systemd-audit.md) |
| 4 | Protected status/timing API, WS hint, Settings UI | Pending | 0% | 8h | [Phase 04](./phase-04-rest-websocket-ui-monitoring.md) |
| 5 | Integration, release, resume, rollback evidence | Pending | 0% | 12h | [Phase 05](./phase-05-integration-release-rollback.md) |

## Dependencies

- Phase 2 depends on Phase 1 policy, persistence, audit, protocol, and timing-command contracts; it uses fake/unavailable execution.
- Phase 3 requires recorded security-owner/operator approval; no privileged code or enrollment before it.
- Phase 4 depends on Phases 1–2 authoritative status and ordered timing admission, not real-helper enablement.
- Phase 5 depends on Phases 1–4; real-host acceptance additionally requires approved Phase 3.
- Linux/systemd/RTC/logind support, root-owned enrollment, and authenticated production identity are external prerequisites.

## Key decisions

- No-running = zero live, creating, or restart-pending server-owned PTYs; tombstones, output silence, replay buffers, panels, and WS clients do not count.
- One incarnation-aware fleet seam and coordinator own quiet epochs, final generation checks, handoff admission, and one attempt per epoch.
- Feature defaults off. Enablement/helper enrollment are startup/operator-only; no browser trigger, cancel, lease, per-request override, helper selection, or unrestricted config authority.
- `PATCH /api/system/idle-suspend/v1/timing` accepts only the complete bounded quiet/wake pair from a normal authenticated enabled actor; `--no-auth` rejects it. The canonical loaded registry, bounded audit, runtime pair, status revision, WS hint, and UI cache reconcile as one ordered change.
- Timing update and helper handoff share admission order: a pre-handoff update cancels the arm, commits both values, re-evaluates fleet, and re-arms when applicable; accepted handoff returns `409 idleSuspendHandoffInProgress` with no memory/disk change until outcome/resume reconciliation.
- Settings owns timing controls. Protected REST owns live status; `host:idleSuspendChanged` only invalidates/refetches. Host-resource popover remains read-only.
- Unsupported capability, inhibitor, audit/persistence failure, unknown state, shutdown, or deployment drift fails closed without automatic retry.

## Unresolved questions

- Approve exact quiet/wake defaults and min/max values; `wakeAfterSeconds = 600` remains proposal only.
- Which Linux/kernel/systemd/RTC matrix and inhibitor classes qualify; is RTC wake mandatory when unavailable?
- Approve helper peer proof, root/server audit locations and retention, enrollment ownership, and residual risk.
- Which operator-owned workloads beyond DamHopper PTYs must block suspend, if any?
- Must existing PTYs survive resume, or is explicit status/replay reconciliation with surfaced failures sufficient?

## Validation Summary

**Prior interview:** 2026-08-24, 8 questions. **Revision:** incorporated; second validation pending. Revised design is not validated yet.

### Prior decisions preserved

1. Idle scope: managed live/creating/restart-pending PTYs plus respected OS inhibitors; no process scan or keep-awake lease.
2. Authority: PTY fleet state and generation only; browser output/presence never authorizes suspend.
3. Privilege: one enrolled root-owned fixed helper operation; no shell, sudo, password, or generic remediation.
4. Ownership: canonical registry source; enablement and helper enrollment stay startup/operator-only.
5. Timing access: normal authenticated enabled Settings actor; no separate role or mandatory re-authentication.
6. UI split: timing controls in Settings; read-only live state in host-resource popover.
7. Admission: pre-handoff update cancels/persists/re-evaluates/re-arms; post-acceptance update rejects unchanged until reconciliation.
8. Capability outcome: unsupported RTC/suspend or inhibitor fails closed without suspend or retry.

### Revalidation gate

- [ ] Confirm the remaining values/policies above and the exact v1 timing contract/error codes in Phases 1 and 4.
- [ ] Do not mark revised design validated or begin implementation until second interview and security/operator gates complete.
