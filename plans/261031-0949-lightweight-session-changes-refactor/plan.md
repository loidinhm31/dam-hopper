---
title: "Lightweight tool-event Session Changes refactor"
description: "Replace repository snapshots with default-off, managed OMP per-file capture and viewer-only comparisons."
status: in-progress
priority: P1
effort: 2d
branch: feat/session-changes-omp
tags: [refactor, backend, frontend, api, security]
created: 2026-10-31
---

# Lightweight Session Changes

[Approved design](../reports/design-261031-0949-lightweight-session-changes-refactor.md).
Planning only; implementation and product qualification not performed by authoring.

## Outcome and invariants

- Server-owned `server.session_changes_enabled` defaults false; JSON uses `sessionChangesEnabled`.
- ON installs managed `extensions/dam-hopper-session-changes.ts`; active OMP sessions need restart.
- OFF immediately rejects producers, fences in-flight publication, purges retained data and removes the owned file.
- Never overwrite/delete modified or unmanaged extensions; expose conflicts. Agent Status stays independent.
- Snapshot each supported tool path once, immediately before first edit: 2 MiB/file, 64 MiB global, 500 files/session, 32 sessions.
- Session registration, `/settled` and `/status` do no file-content reads or diffs; no recursive inventory.
- Only explicit viewer `/files`, `/refresh`, `/files/{fileId}` requests read current files or compute line stats.
- Root and in-process task agents share root identity fenced by server epoch, terminal incarnation and OMP session.
- Capture deadline <=1.5s per tool call; fail-open failures/glob-only discoveries stay unknown/unproven.
- Review means tool-observed edits since first touch, not session-start or complete workspace attribution.
- Preserve root/owner/auth/read-only/revision fences; no bash/eval interception, Git baseline or retroactive capture.

## Phases

| Phase | Effort | Owner role | Status | Contract |
|---|---|---|---|---|
| 01 | 0.35d | Server lifecycle | pending | [Config and managed lifecycle](phase-01-config-and-extension-lifecycle.md) |
| 02 | 0.75d | Rust engine | pending | [Per-file engine and lazy comparison](phase-02-lightweight-per-file-engine.md) |
| 03 | 0.40d | OMP producer | DONE (2026-10-31 17:23:46 +07:00) | [Tool-event extension](phase-03-omp-tool-event-extension.md) |
| 04 | 0.50d | UI, integration, docs | pending | [Toggle and qualification](phase-04-settings-toggle-and-ui-qualification.md) |

## Task graph and ownership

`omp-tool-event-producer -> managed-extension-lifecycle -> server-session-changes-switch -> per-file-capture-engine -> lazy-view-comparison -> qualify-engine-protocol`.
`omp-tool-event-producer -> qualify-omp-producer` (independent producer regression branch).
`server-session-changes-switch -> settings-toggle-owner-binding`.
`settings-toggle-owner-binding + qualify-engine-protocol -> lazy-panel-and-triggers` (serializes shared wire-fixture cleanup).
All three qualification/UI branches join `qualify-integrated-session-changes -> document-lightweight-session-changes`.
Each task must compile/typecheck, pass focused tests, smoke its own deliverable and receive review before evidence-backed completion releases dependents; no descendant evidence may satisfy a predecessor gate.
Serialize shared build/check lanes at coherent task boundaries. One finalizer later runs cross-layer suites/live journeys; phase numbers group concerns, not execution order. The real Phase 03 asset precedes Phase 01 bundling.

## Related plans and readiness

[Prior Session Changes plan](../261030-1215-session-changes-panel/plan.md): **superseded/refactored in-place** for inventory, barrier and producer contracts; preserve unaffected security/viewer behavior. Informational history, not an execution dependency; do not edit/import its state.
Any concurrent writer of listed product paths must be serialized by coordinator before implementation.
Independent review: [cleared (0 blockers / 0 high / 0 medium)](reports/independent-plan-review.md) after [R1–R4 triage](reports/review-triage.md). Validation: prompt mode; user accepted reviewed plan and declined interview.
[Authoring report](reports/authoring-report.md) records structure and task graph; `tasks.json` hydrated and synced.

<!-- evcrate-progress:start -->
- document-lightweight-session-changes: pending
- lazy-panel-and-triggers: pending
- lazy-view-comparison: pending
- managed-extension-lifecycle: pending
- omp-tool-event-producer: completed
- per-file-capture-engine: pending
- qualify-engine-protocol: pending
- qualify-integrated-session-changes: pending
- qualify-omp-producer: completed
- server-session-changes-switch: pending
- settings-toggle-owner-binding: pending
<!-- evcrate-progress:end -->

## Release gates and rollback

Default OFF/startup reconciliation; safe install/remove/conflicts; zero unviewed content/diff work; first-touch correctness, subagent fencing and timeout provenance; target-server UI isolation; integrated live OMP and browser journey. Exact checks in phases.
Rollback operationally by turning OFF (reject, purge, safe remove); do not restore full-repo scans or imply old baselines survive cutover.

## Unresolved questions

None. Plan reviewed, validated, and hydrated; implementation and runtime qualification remain execution gates.
