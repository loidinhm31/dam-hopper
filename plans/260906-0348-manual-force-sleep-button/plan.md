---
title: "Authenticated Manual Force Sleep"
description: "Add a fail-closed, audited Force Machine to Sleep action with active-terminal confirmation and optional RTC auto-wake."
status: in-progress
priority: P1
effort: 38h
branch: feat/terminal-idle-suspend
tags: [feature, backend, frontend, api, auth, security, linux]
created: 2026-09-06
---

# Authenticated Manual Force Sleep

## Overview

Add a permanent production action in the Host Resource Popover for authenticated, enabled users. Every request passes same-origin protection for cookie sessions, server-side confirmation enforcement, durable actor audit, fleet handoff ordering, helper peer verification, inhibitor/capability preflight, and one fixed suspend operation. The dialog defaults to indefinite sleep (`wakeAfterSeconds: 0`) and optionally schedules a bounded RTC wake.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Protocol and helper indefinite sleep | DONE (2026-09-06 04:36:40 +07:00) | 100% | 6h | [Phase 01](./phase-01-protocol-and-helper-indefinite-sleep.md) |
| 2 | Coordinator and fleet forced handoff | DONE (2026-09-06 10:48:00 +07:00) | 100% | 8h | [Phase 02](./phase-02-coordinator-and-fleet-forced-handoff.md) |
| 3 | Authenticated force-suspend REST API | DONE (2026-09-06 12:00:21 +07:00) | 100% | 6h | [Phase 03](./phase-03-rest-api-force-suspend-endpoint.md) |
| 4 | Host popover action and confirmation dialog | DONE (2026-09-06 12:20:00 +07:00) | 100% | 8h | [Phase 04](./phase-04-host-popover-ui-and-confirmation-dialog.md) |
| 5 | Integration testing and docs | Pending | 0% | 10h | [Phase 05](./phase-05-integration-testing-and-docs.md) |

## Dependencies

- Phase 2 depends on Phase 1 helper request semantics.
- Phase 3 depends on Phase 2 command/result and audit contracts.
- Phase 4 depends on Phase 3 wire DTOs and existing protected status query.
- Phase 5 qualifies Phases 1–4; automated checks use fakes, while a real suspend requires an approved maintenance window and recovery path.
- Production requires Linux/systemd/logind, enrolled helper socket, usable RTC wakealarm, database-backed authentication, and exclusive host policy for `rtc0` alarm ownership.

## Key Decisions

- `0` means indefinite sleep only for execution requests. Persisted automatic timing remains `60..=86400`; automatic idle suspend never becomes indefinite.
- Helper wire shape stays version 1: `wakeAfterSeconds` remains a required integer and expands to `0 | 60..=86400`; mixed old/new helper deployment fails closed.
- Manual sleep is independent of automatic idle policy `enabled`; it is always routed in production but requires an enrolled capable helper. `--no-auth` always rejects.
- `force: false` plus active fleet returns `409` with content-free counts. `force: true` bypasses only quiescence—not generation, shutdown, disposal, handoff, audit, capability, inhibitor, peer, or RTC checks.
- Active count is `live + creating + restartPending`; terminal IDs, commands, output, cwd, and environment never cross this boundary.
- Accepted POST returns `202` after audited atomic handoff admission. Outcome/resume remains authoritative through status revision and existing `host:idleSuspendChanged` reconciliation.
- The helper refuses to clobber a non-empty RTC alarm unless host qualification establishes DamHopper-exclusive ownership; clear/write/verification failures suppress suspend.

## Preflight Contract

Auth/session → cookie-origin check → strict DTO/bounds → enabled actor/database auth → coordinator/capability → authoritative fleet confirmation → durable server audit → generation-fenced handoff → helper peer/dedupe/inhibitor/RTC audit → fixed suspend.

## Side-Effect Review Checklist

- [ ] No automatic timing default/bounds change and no config persistence from the dialog.
- [ ] No terminal kill, restart, output inspection, shell, sudo, arbitrary path/device/mode, or generic host command.
- [ ] No foreign RTC alarm overwrite; indefinite mode writes only the reviewed clear operation.
- [ ] New terminal starts are blocked only while handoff is active and resume/outcome always releases the gate.
- [ ] Browser/network loss after suspend cannot trigger retry; status/audit reconcile on resume.

## Unresolved Questions

- Operations must confirm whether enrolled hosts can guarantee exclusive ownership of `/sys/class/rtc/rtc0/wakealarm`; otherwise release must keep manual suspend unavailable.