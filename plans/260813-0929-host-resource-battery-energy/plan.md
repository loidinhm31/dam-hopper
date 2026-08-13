---
title: "Host resource battery and energy telemetry"
description: "Add truthful Linux battery, remaining-energy, and instantaneous-power data to the cached v1 host snapshot and diagnosis UI."
status: completed
priority: P2
effort: 7h
branch: feat/host-resource-battery-energy
tags: [feature, backend, frontend, api]
created: 2026-08-13
---

# Host Resource Battery and Energy Telemetry

## Overview

Extend the existing read-only Linux snapshot path with one optional-data battery section. Preserve v1 and legacy compatibility; render only measurements the host reports.

## Preflight Contract

- **Output:** additive `battery` object in `GET /api/system/resources/v1/snapshot`; diagnosis rows for battery/status, remaining energy (Wh), and instantaneous power (W).
- **Acceptance:** existing JSON remains valid; no zero/default fabrication; like-for-like multi-battery aggregation only; failures use existing availability states; focused Rust/UI/browser tests and repository checks pass.
- **In scope:** Linux `/sys/class/power_supply`, cached v1 snapshot, shared TypeScript DTO, current diagnosis popover, tests, contract docs.
- **Out of scope:** legacy metrics changes, new endpoint/dependency/config, alerts/remediation, per-battery UI, macOS/Windows, charge/current/voltage-derived conversions.
- **Risk/public contracts:** additive camelCase DTO, sysfs micro-unit conversion, partial/multiple batteries, permissions/stale cache, precise Wh versus W wording.
- **Expected touch points:** Rust snapshot types/Linux collector/monitor/tests/API tests; UI client/formatting/diagnosis/tests; architecture/API/frontend docs.
- **Testing:** temp sysfs fixtures, serde/API contract tests, component/browser tests, Rust/UI checks, full repository gate.
- **Open questions:** none.

## Selected Design

Add one aggregate `battery` section to the v1 snapshot. Read direct `capacity`, `status`, `energy_now`, `energy_full`, and `power_now`; never derive energy/power from charge, current, or voltage. Keep the TypeScript field optional for old-server compatibility. See [Phase 01](./phase-01-contract-and-linux-collector.md#approach-decision).

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Contract and Linux collector | Completed 2026-08-13 | 3.5h | [phase-01](./phase-01-contract-and-linux-collector.md) |
| 2 | UI presentation and compatibility | Completed 2026-08-13 11:08:43 +07:00 | 2h | [phase-02](./phase-02-ui-presentation-and-compatibility.md) |
| 3 | Documentation and release gates | Completed 2026-08-13 11:39:20 +07:00 | 1.5h | [phase-03](./phase-03-documentation-and-release-gates.md) |

## Dependencies

- Existing startup-owned `HostResourceSource::sys_root`, bounded reader, cached monitor, and `Availability` model.
- Linux power-supply sysfs direct micro-unit attributes; no external crate.
- Phase 2 depends on Phase 1 DTO names; Phase 3 validates both.

## Side-Effect Review

- **Auth/session/permissions/roles:** unchanged protected endpoint; read-only startup-owned sysfs root; permission failures degrade locally.
- **API/client compatibility:** additive v1 field, unchanged `schemaVersion: 1`; old clients ignore it and new clients tolerate absence; legacy response shape unchanged.
- **Database/migrations/data integrity:** none; snapshot remains memory-only.
- **Business meaning:** descriptive battery state only; no alert, scoring, remediation, or automation changes.
- **Security/privacy/secrets/logging:** no request-provided paths, shell, credentials, persistent data, or device-path exposure.
- **Performance/concurrency/resources:** bounded directory/file reads once per existing sample; deterministic scan; no new timer/query/cache.
- **Docs/config/onboarding/deployment:** update contract/architecture/UI docs; no config, dependency, environment, packaging, or rollout change.

## Unresolved Questions

None.
