---
title: "Restore host-resource visibility and alerts"
description: "Show legacy thermal/disk metrics and bounded in-app incidents."
status: in-progress
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
| 02 | API/SSE/client contract — **pending** | 01 | [phase-02](./phase-02-api-sse-client-contract.md) |
| 03 | Accessible disclosure — **pending** | 02 | [phase-03](./phase-03-popover-disclosure.md) |
| 04 | Tests/release gate — **pending** | 01–03 | [phase-04](./phase-04-tests-validation-docs.md) |

## Exact implementation order
1. Test conservative real/persistent filesystem classification and keyed evidence first.
2. Feed cached `HostMetrics` to a bounded keyed alert evaluator using monitor monotonic elapsed time; retain memory engine behavior.
3. Extend alert summaries/history/SSE/client validator additively; preserve routes/auth/legacy fields.
4. Render temperatures and default-collapsed all-disk disclosure from `legacyMetrics`; retain CPU/workspace-disk summary.
5. Run focused Rust/API/Vitest/browser/type/build gates; update only existing relevant docs.

## Side-effect checklist
- [ ] Auth/session unchanged; assert all resource endpoints remain protected.
- [ ] Legacy GET fields preserved; V1/SSE extension additive; old valid events accepted.
- [ ] No DB/migration; config defaults only if needed, clamped/backward compatible.
- [ ] <=60/unavailable resets thermal timer; disk recovery/dedupe keyed per target.
- [ ] Empty thermal data unavailable, never healthy; virtual/pseudo disks excluded before alerting.
- [ ] Evidence bounded; no secrets, commands, env, or arbitrary paths logged.
- [ ] No new UI polling; existing monitor cadence/one task/capped cache retained.
- [ ] No deploy/dependency/permission work; docs only where current behavior is documented.

## Success criteria
Real sensor rows and all disks are accessible on demand; each qualifying independent target gets a recoverable single incident with evidence; memory alerts, auth, legacy metrics, snapshot compatibility, strict event handling stay green.

## Risks
Conservative Linux mount classification may need internal metadata; fail closed. A single `snapshot.alert` cannot describe concurrent targets, so add an additive current collection/projection. Key sensors by `source`, not colliding label. **Residual risk (medium): normalized host samples are not capped before `BTreeMap` allocation; fix this before Phase 02.**

## Unresolved questions
None; policy, scope, UI default, and delivery channel approved.
