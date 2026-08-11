---
title: "Restore host-resource visibility and alerts"
description: "Show legacy thermal/disk metrics and bounded in-app incidents."
status: completed
priority: P1
effort: 2d
branch: main
tags: [host-resources, rust, react, alerts, accessibility]
created: 2026-08-11
---

# Restore host-resource visibility and alerts

## Outcome
Restore temperatures and all-host disks in existing Host Resource popover. Add in-app incidents per sensor >60°C continuously for five minutes and per real/persistent disk >=95% used. No dashboard, delivery channel, permission, migration, or polling loop.

## Plan-owned preflight
- **Output:** legacy popover disclosure + monitor thermal/disk alerts via existing REST/SSE presentation.
- **Acceptance:** authenticated APIs compatible; unavailable temperature explicit; collapsed keyboard/click storage disclosure exposes all disks; workspace summary stays; alerts are evidenced, bounded, deduped, recoverable.
- **Scope:** Rust legacy sampler/monitor/V1 alert pipeline; React client/popover/diagnosis and tests.
- **Exclusions:** virtual/pseudo filesystems, external alerts, DB/config migration, pages, unrelated refactors.
- **Contract:** `/api/system/metrics` already owns `temperatures`/`disks`; never add metrics to `HostResourceSnapshotV1`. Alert DTO/SSE extension must be additive and strictly validated.

## Decision record
Recommended: minimally display cached legacy data and extend monitor alerts. Rejected: V1 metrics coupling, a dashboard, or external alerts—each widens scope/duplicates existing flow.

## Ordered phases
| # | Phase | Depends on | File |
|---|---|---|---|
| 01 | Monitor signal/model — **completed 2026-08-11 03:00:34 +07:00** | none | [phase-01](./phase-01-monitor-alert-model.md) |
| 02 | API/SSE/client contract — **completed 2026-08-11 04:07:13 +07:00** | 01 | [phase-02](./phase-02-api-sse-client-contract.md) |
| 03 | Accessible disclosure — **completed 2026-08-11 07:18:58 +07:00** | 02 | [phase-03](./phase-03-popover-disclosure.md) |
| 04 | Tests/release gate — **completed 2026-08-11 09:15:59 +07:00** | 01–03 | [phase-04](./phase-04-tests-validation-docs.md) |

## Exact implementation order
1. Test conservative real/persistent filesystem classification and keyed evidence first.
2. Feed cached `HostMetrics` to a bounded keyed alert evaluator using monitor monotonic elapsed time; retain memory engine behavior.
3. Extend alert summaries/history/SSE/client validator additively; preserve routes/auth/legacy fields.
4. Render temperatures and default-collapsed all-disk disclosure from `legacyMetrics`; retain CPU/workspace-disk summary.
5. Run focused Rust/API/Vitest/browser/type/build gates; update only existing relevant docs.

## Side-effect checklist
- [x] Auth/session unchanged; resource endpoints remain protected.
- [x] Legacy GET fields preserved; V1/SSE extension additive; old valid events accepted.
- [x] No DB/migration; config defaults only if needed, clamped/backward compatible.
- [x] <=60/unavailable resets thermal timer; disk recovery/dedupe keyed per target.
- [x] Empty thermal data unavailable, never healthy; virtual/pseudo disks excluded before alerting.
- [x] Evidence bounded; no secrets, commands, env, or arbitrary paths logged.
- [x] No new UI polling; existing monitor cadence/one task/capped cache retained.
- [x] No deploy/dependency/permission work; docs only where current behavior is documented.

## Success criteria
Real sensor rows and all disks are accessible on demand; each qualifying independent target gets a recoverable single incident with evidence; memory alerts, auth, legacy metrics, snapshot compatibility, strict event handling stay green.

## Risks
Conservative Linux mount classification may need internal metadata; fail closed. A single `snapshot.alert` cannot describe concurrent targets, so add an additive current collection/projection. Key sensors by `source`, not colliding label. **Resolved in Phase 02:** normalized samples now retain only the deterministic, bounded target prefix before `BTreeMap` growth.

## Unresolved questions
None; policy, scope, UI default, and delivery channel approved.
