---
title: "Production idle-suspend diagnostics"
description: "Add producer-owned semantic evidence and a bounded one-shot local incident bundle for production idle-suspend failures."
status: in-progress
priority: P2
effort: 110h
branch: feat/terminal-idle-suspend
tags: [feature, backend, cli, security, diagnostics]
created: 2026-09-12
---

# Production idle-suspend diagnostics

## Objective

Make one manual `dam-hopper diagnose --json` invocation reconstruct an idle-suspend attempt across coordinator, helper, audits, systemd, and current host evidence without another daemon, upload, terminal output, arbitrary commands, or policy change. Root yields full helper evidence; non-root yields an honest partial bundle without sudo.

## Read first

1. [Frozen design contract](design-contract.md) — paths, versions, schemas, source matrix, privacy, durability, correlation, bounds, exits, compatibility.
2. [Approved brainstorm](../reports/brainstorm-260911-2355-production-idle-suspend-diagnostics.md).
3. [Producer/audit research](research/researcher-01-event-audit-contract.md) and [collector/CLI research](research/researcher-02-collector-cli-contract.md).
4. [Completed idle-suspend prerequisite](../260910-1604-agent-activity-idle-suspend/plan.md).

## Non-goals

No observer service, continuous telemetry, UI, alerting, automatic upload, external AI credential, terminal/PTY content, shell/operator command, public tuning flags, arbitrary destination, heuristic root-cause classifier, new systemd unit, or default `empty-fleet`/enablement change.

## Ordered phases

| Phase | Status | Progress | Estimate | Dependency |
| --- | --- | ---: | ---: | --- |
| [01 — Frozen architecture, schemas, source/privacy/durability matrix](phase-01-freeze-architecture-contracts.md) | approved/completed (2026-09-12) | 100% | 12h | None |
| [02 — Canonical event writer, identity, sequence, correlation foundation](phase-02-canonical-event-foundation.md) | completed (2026-09-13) | 100% | 16h | 01 approved |
| [03 — Coordinator/manual/automatic instrumentation and restart-safe IDs](phase-03-server-coordinator-instrumentation.md) | DONE (2026-09-13) | 100% | 18h | 02 |
| [04 — Helper audit milestones and protocol-safe propagation](phase-04-helper-milestone-enrichment.md) | pending | 0% | 18h | 02–03 correlation contract |
| [05 — Bundle model, bounded readers, redaction, correlation/gap engine](phase-05-bundle-correlation-engine.md) | pending | 0% | 20h | 01–04 schemas stable |
| [06 — Linux CLI, role-aware adapters, atomic output and exits](phase-06-linux-cli-integration.md) | pending | 0% | 16h | 05 |
| [07 — Cross-layer security/fault gates, architecture verification, docs/rollout](phase-07-security-verification-rollout.md) | pending | 0% | 10h | 01–06 |

**Total: 110h.** Phase estimates sum to frontmatter effort.

**Current plan status:** IN PROGRESS — Phase 01 completed 2026-09-12; Phase 02 completed 2026-09-13 (reviewed 9.5/10); Phase 03 **DONE (2026-09-13; 100%; reviewed 9.3/10; 170/170 tests passed)**. Phases 04–07 remain pending for helper audit enrichment, bundle engine, and CLI rollout.
## Phase 01 completion record

- **Completed:** 2026-09-12.
- **Approval:** The architecture contract passed the three-cycle approval workflow; the terminal advisor lifecycle is complete, and the third reviewer scored **10/10 with no findings**.
- **Boundary:** Phase 01 includes no runtime Rust, test, or deployment changes. Phase 02 may now implement the frozen contract; later phases remain pending.

## Phase 02 completion record

- **Completed:** 2026-09-13.
- **Approval:** Canonical event schema, identity, sequence, and writer foundation implemented and reviewed (9.5/10). 143/143 tests pass.
- **Progress:** 100% (6/6 todo items).
- **Evidence:** Focused canonical event tests 11/11, server-audit compatibility 1/1, and the full `idle_suspend::` module 143/143 passed; [test report](../reports/tester-260913-1637-phase02-canonical-event-foundation.md) · [code review](../reports/code-review-260913-1639-phase02-event-writer.md).
- **Boundary:** Phase 02 creates `event.rs`, adds exports in `idle_suspend/mod.rs`, and tests in `idle_suspend/tests.rs`. Coordinator and helper runtime remain untouched for Phases 03 and 04.

## Phase 03 completion record

- **Completed:** 2026-09-13.
- **Status:** DONE (100%; 6/6 todo items).
- **Review score:** 9.3/10.
- **Tests passed:** 170/170.
- **Evidence:** Deterministic coordinator, unit, and integration validation passed; [code review](../reports/code-review-260913-1807-phase03-coordinator-instrumentation.md).
- **Boundary:** Phase 03 wires canonical writer through AppState and coordinator, adds AttemptContext, replaces epoch-N with UUID correlation, and instruments authoritative transitions without per-sample overhead. Helper audit remains untouched for Phase 04.

## Ownership and sequencing

- Phase 01 owns architecture/source-contract review; no production code starts before approval.
- Phase 02 owns event types/writer/identity. Phase 03 exclusively owns `coordinator.rs` instrumentation. Phase 04 exclusively owns helper audit/server/protocol compatibility.
- Phase 05 owns pure bundle/read/redaction/correlation logic. Phase 06 owns Linux host adapters, CLI dispatch, output filesystem behavior, and deployment path exposure.
- Phase 07 runs deterministic cross-layer gates, then architecture-to-code review before live docs/rollout edits. One integration owner resolves shared `mod.rs`/exports serially.

## Release gates

- Correlated successful and rejected automatic/manual chains; UUID reused as helper request ID; restarts, gaps, orphans, legacy IDs, malformed/rotated/dropped evidence stay incomplete.
- Fixed 60-minute/10,000-record/8-MiB bounds; source applicability/status/historicity explicit; latest/current evidence never presented as history.
- Root/non-root mode, atomic `0600` output, stdout-only path, exit `0/2/1`, no sudo/network egress/source mutation proven through injected seams.
- Redaction corpus excludes tokens, credentials, argv/env, terminal data, socket addresses, inhibitor identity, raw IPC/helper/systemd/journal detail.
- Read-only Linux smoke only after deterministic gates; no test manipulates real RTC, suspend, services, or production audits.

## Rollback

Protocol remains v1 and existing timing/manual/helper records remain readable. Rollback disables new writers/CLI and restores prior binaries/assets; it never deletes evidence. New collector treats legacy/mixed deployments as partial, and old readers may ignore additive helper milestones while retaining established action records.

## Unresolved questions

None. Phase 01 validation failures block downstream work and must amend/reapprove the design contract rather than invent behavior during implementation.
