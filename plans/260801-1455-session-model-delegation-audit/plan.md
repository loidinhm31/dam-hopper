---
title: "Session Model Delegation Audit"
description: "Add privacy-safe per-terminal Codex session and agent model/token auditing, gated by proven app-server compatibility."
status: in_progress
priority: P2
effort: 96h
branch: main
tags: [feature, backend, frontend, database, api, telemetry, experimental]
created: 2026-08-01
---

# Session Model Delegation Audit

## Overview

Extend `/usage` with permanent, compact Codex session/node summaries. OTel owns token facts; a bounded metadata-only Codex app-server adapter may own exact lineage only after Phase 01 proves the Codex 0.146.0 contract. Missing sources stay nullable and explicit. Never infer an edge or collect AI/terminal content.

## Architecture decisions

- Reuse `agent_runs` as root and child summary nodes. Add no summary table unless the 100k-node benchmark proves indexed `agent_runs` insufficient.
- One separately opted-in opaque marker is inherited by a terminal shell; registry maps marker to terminal run in memory. Raw markers/provider IDs never persist.
- OTel-only fallback is flat, labeled `lineage_unavailable`; app-server-only exact nodes use `token_data_unavailable`.
- Existing aggregate endpoint and raw-event retention remain unchanged. Closed node summaries persist until range/all deletion.
- Model identifiers are bounded opaque safe strings. No rank, routing recommendation, policy violation, productivity score, or cost estimate.

## Phases

| # | Phase | Depends on | Effort | Status |
|---|---|---|---:|---|
| 01 | [Codex 0.146.0 compatibility gate](./phase-01-codex-app-server-compatibility-gate.md) | None | 16h | Completed (FAIL) |
| 02 | [Opt-in terminal correlation and model types](./phase-02-opt-in-terminal-correlation-and-model-types.md) | 01 decision | 10h | Completed (2026-08-01; review approved 8.5/10) |
| 03 | [Metadata adapter and source join](./phase-03-metadata-adapter-and-source-join.md) | 01 pass, 02 | 16h | N/A (0.146.0 gate failed) |
| 04 | [`agent_runs` summary persistence](./phase-04-agent-run-summary-persistence.md) | 02; 03 if enabled | 16h | **Completed (2026-08-01; flat OTel-only fallback)** |
| 05 | [Protected session-audit API](./phase-05-protected-session-audit-api.md) | 04 | 10h | Pending |
| 06 | [Shared Usage session-audit UI](./phase-06-shared-usage-session-audit-ui.md) | 05 | 14h | Pending |
| 07 | [Release gates, tests, and docs](./phase-07-release-gates-tests-and-docs.md) | 01-06 | 14h | Pending |

## Hard gate and fallback

Phase 01 must prove passive visibility of standalone TUI sessions, exact root/child OTel identity mapping, child token semantics, and resume/fork/reconnect behavior. Any required failure stops exact-tree work. Continue only with flat OTel model/token rows and `lineage_unavailable`; do not create or guess parent edges.

## Dependencies

- Codex CLI/app-server 0.146.0 available only for the compatibility probe and pinned fixtures.
- Existing opt-in telemetry runtime, HMAC key ring, bounded worker, SQLite store, protected router, shared UI transport, and Usage tests.
- Architecture gate already recorded in `docs/system-architecture.md` and the plan architecture report.

## Completion gate

Backend + shared UI tests pass; representative 100k-node list/detail p95 stays below 200 ms; deletion/retention/replay are idempotent; browser accessibility flow passes; privacy canaries find no forbidden content or raw identifier in fixtures, DB, API, logs, or browser state.

## Validation Summary

**Validated:** 2026-08-01 (Asia/Saigon)
**Phase 01 review:** Approved 9/10; completed (FAIL gate) at 2026-08-01 (Asia/Saigon)
**Questions asked:** 8

### Confirmed Decisions

- Phase 01 failure: ship the flat OTel model/token fallback with `lineage_unavailable`; do not require remote mode or infer edges.
- Range deletion: remove permanent summaries whose observed lifetime overlaps the selected UTC range, matching the existing deletion promise.
- Historical terminal identity: project + start time + short derived ID; never persist command text or the current UI label.
- Existing `OTEL_RESOURCE_ATTRIBUTES`: fail closed and preserve the user value unchanged; mark correlation unavailable.
- Multi-terminal resume: one canonical tree may list all exact observed terminal associations without duplicating tokens.
- Live refresh: server capture is continuous; visible Usage UI polls about every 15 seconds and stops when hidden.

### Action Items

- [x] Phase 04 implementation models multiple terminal associations without duplicating root/node totals.
- [ ] Phase 05/06 implementation must apply overlap deletion and visible-page polling semantics.
- [ ] Phase 02/03 must preserve fail-closed behavior for pre-existing OTel attributes.

Phase 01 is complete with a failed Codex 0.146.0 compatibility gate. Phase 02 is complete (review approved 8.5/10) and limited to opt-in correlation/model types for the flat OTel fallback. Phase 03 is N/A; downstream work must retain `lineage_unavailable` and must not infer parent edges. Phase 04 is complete as flat OTel-only `agent_runs` persistence: no app-server adapter, exact parent edges, or inferred lineage are in scope.

Phase 04 acceptance evidence: ordered migration and idempotent upgrade coverage; replay-safe flat summary upserts with multi-terminal association coverage; stale/cumulative and model/semantic conflict handling; retention finalization before raw purge; overlap range/all deletion with associations; key-rotation path coverage; and indexed 100k-node list benchmark under the 200 ms p95 target. Migration SQL remains runtime-managed by the telemetry store migration runner. A failed key rotation may leave a temporary `.next` keyring file until a retry completes.

## Unresolved questions

- Range deletion default: architecture recommends session time overlap; confirm product wording before implementation.
- One provider root seen under multiple terminal markers: Phase 01 must define retained/current association semantics.
