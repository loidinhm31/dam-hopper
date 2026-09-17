---
title: Unified multi-profile workbench implementation plan
description: Complete explicit-ownership cutover with independent connections, preserved server authority and real qualification gates.
status: in-progress
priority: P1
effort: TBD
branch: main
tags: [frontend, backend, api, auth, native, refactor]
created: 2026-09-16
---

# Unified multi-profile workbench

## Goal and scope

Implement one shared workbench with simultaneous supported profile connections and `Profile → Project` navigation. Focus changes navigation, never authority. Capture profile, generation and endpoint/root binding for every remote operation; preserve server configuration, PTY persistence, workflow history, authorization and platform restrictions.

Based on [the requested preplan](../reports/preplan-260916-2135-unified-profile.md). This package preserves its nine feature phases and thirteen scenarios, adds a contract-freeze phase and resolves execution dependencies. No backend workspace UUID/catalog redesign, cross-server filesystem move or distribution, global active-profile fallback, app-per-profile remount, or automatic mutation replay.

**Status:** IN PROGRESS — Phases 00–06 complete; Phases 07–09 pending; 7/10 phases complete; 70%; updated 2026-09-17.

## Phases

| Phase | Deliverable | Dependency | Status / progress |
|---|---|---|---|
| [00 — Contract freeze](phase-00-contract-freeze.md) | Scope, callers/stores inventory, shared contracts and G0 | None | Completed (G0 frozen) — 2026-09-17 / 100% |
| [01 — Ownership and connections](phase-01-explicit-ownership-and-connections.md) | Runtime/API/transport/query/event cutover | G0; 02A auth contract | Completed — 2026-09-17 / 100% |
| [02 — Shell and profiles](phase-02-unified-shell-and-profile-migration.md) | Independent auth/controls, grouped navigation, fresh resource reset, host bootstrap | G0; 01 interfaces | DONE — 2026-09-17 / 100% |
| [03 — Files, editor, search and Git](phase-03-files-editor-search-and-git.md) | Qualified models/targets, exact async effects, federated partial results | G0; 01/02; 07 media interface | DONE — 2026-09-17 / 100% |
| [04 — Terminals and workflow](phase-04-terminals-workflow-and-navigation.md) | Shared keep-alive, qualified layouts/history/links/notifications/diagnostics | G0; 01/02 | DONE — 2026-09-17 / 100% |
| [05 — Agents, ports and Browser](phase-05-agents-ports-and-browser.md) | Explicit catalogs/targets, safe capture and atomic incarnation handoff | G0; 01/02; 04/07 contracts | DONE — 2026-09-17 / 100% |
| [06 — Preferences, Settings and host](phase-06-preferences-settings-usage-and-host.md) | Independent sources/targets, usage/metrics and safe destructive intent | G0; 01/02 | DONE — 2026-09-17 / 100% |
| [07 — Media and encryption](phase-07-media-isolation-and-encryption.md) | Cookie namespace v2, original-owner cleanup, generation-bound secrets | G0; 01; 03 target contract | Pending / 0% |
| [08 — Native scopes](phase-08-native-scope-concurrency.md) | Concurrent admitted SSH scopes, atomic IPC, one Browser lease | G0; 01/02; 05 target contract | Pending / 0% |
| [09 — Integration and qualification](phase-09-integration-and-qualification.md) | G1 caller cutover; S01–S13 real evidence; G2 release gate | Web 01–07; native adds 08 | Pending / 0% |

## Current status — 2026-09-17

- **Phase 00:** DONE — G0 contract freeze and caller inventory approved/frozen (100%).
- **Phase 01:** DONE — explicit ownership and connection foundation complete (100%).
- **Phase 02:** DONE — unified shell, independent connections and profile migration complete (2026-09-17; 100%).
- **Phase 03:** DONE — files, editor, search and Git complete (2026-09-17; 100%).
- **Phase 04:** DONE — terminal continuity, workflow and owner-directed navigation complete (2026-09-17; 100%).
- **Phase 05:** DONE — agents, ports and Browser implementation, capability isolation and incarnation-safe handoff complete (2026-09-17; 100%).
- **Phase 06:** DONE — preferences, Settings, usage and host implementation complete (2026-09-17; 100%).
- **Next phase:** **Phase 07 — Media isolation and encryption**.

## Read before implementation

1. [Design contracts](design-contracts.md): identities, lifecycle, auth, queries/events and exact storage cutover.
2. [Execution map](execution-map.md): producer/consumer joins, shared-file ownership, sequencing, compatibility and rollback.
3. [Coverage and decisions](coverage-and-decisions.md): every feature mapped to phase/scenario; analysis and tradeoffs.
4. [Verification matrix](verification-matrix.md): pending evidence ledger, security negatives and prerequisite distinctions.
5. [Frontend audit](research/frontend-source-audit.md), [security/native audit](research/security-native-source-audit.md), [planning validation](reports/plan-validation.md).
6. [Command entry](cmd-plan.md) and [proposed architecture](../../docs/system-architecture.md#proposed-unified-profile-workbench-2026-09-16-not-implemented).

## Critical gates

- **G0:** frozen contracts, not completed Phase 01. Independent feature work starts here; shared files have one writer.
- **G1-Web / G1-Native:** complete shipped-target callers/hosts migrated, no ambient path; native additionally requires Phase 08. Enable simultaneous startup only after its target gate.
- **G2-Web / G2-Native:** qualified web may release independently; native remains blocked until its target runtime/security gates pass. Shared failures block all affected targets.
- Breaking protocol: require authenticated `workbenchProtocol: 2` before WS/features, media-v2-only and mandatory artifact incarnation. Old clients/servers unsupported; deploy matching versions.
- Duplicate URLs remain separate frontend owners, not isolated remote tenants. Old browser resource state is deliberately dropped, not migrated or backed up; profiles/auth/native/server data preserved.

## Planning provenance

Hard-planning command and planning skill loaded explicitly from installed OMP files; command workflow followed with available tools because no native slash-command invocation tool is exposed. Source report, current code/docs, two focused scout audits and package scripts informed this plan. Active-plan helper ran but could not persist because `EVCRATE_SESSION_ID` is unset; use this directory explicitly when resuming. Existing older backend-workspace proposal remains separate, not a dependency.

## Validation Summary

**Validated:** 2026-09-16; four primary questions plus one clarification. [Full decisions](validation-decisions.md).
- Profile-only ownership retained; no backend workspace redesign.
- User chose fresh browser resource state: no legacy archive/quarantine/restore.
- User chose new contracts only: breaking frontend/backend upgrade, no old protocol branches.
- User chose per-platform release: web can ship qualified; native awaits its own proof.
- All affected phase/contracts/qualification sections revised; no implementation started.

## Unresolved questions

No product/design choice deferred. Execution prerequisites: disposable MongoDB/auth users, browser media/capture/cookie controls, Windows runner/device and disposable SSH endpoints. Availability is unverified. Validation complete; do not implement as part of this planning task.
