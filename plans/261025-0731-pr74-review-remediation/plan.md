---
title: "PR74 review remediation proposal"
description: "Repair thirteen reviewed content, navigation, lifecycle, release, and configuration boundary defects."
status: completed
priority: P1
effort: 76h
branch: feat/lsp-server-integration-reassess
tags: [bugfix, frontend, backend, api, auth]
created: 2026-10-25
---

# PR74 review remediation proposal

## Decision and authority
Proposed design revised to resolve validation items R1–R5; independent plan review completed and findings P1–P3 triaged and resolved. Phase 01 (Editor content integrity) completed/passed on 2026-10-26 00:15:00 +07:00 (5/15 durable tasks complete, 100% Phase 01 task progress; 1/4 phases complete, 25% phase-count progress; 19h/76h planned effort accounting). Phase 02 (Gateway coordinate proofs) marked DONE (accepted with deferred issues tracked for Phase 04; work cycle closed by coordinator direction with technical acceptance open pending Phase 04 integrated qualification) on 2026-10-26 07:30:00 +07:00 (8/15 durable tasks complete, ~53% task progress; 2/4 phases complete, 50% phase-count progress). Cycle 3 code review (`plans/reports/code-review-261026-0709-phase02-gateway-coordinate-proofs-cycle3.md`, score 6/10, 0 critical) confirmed static fixes for C1/W6 and production default feature exclusion; 7 warnings (W1, W3, W4, W5, W7, W8, W9) tracked as carryovers into Phase 04 integrated qualification. Phase 03 (Session lifecycle) marked DONE (accepted with deferred issues tracked for Phase 04 integrated qualification; work cycle closed by user approval with technical acceptance open pending Phase 04 integrated qualification) on 2026-10-26 08:35:00 +07:00 (11/15 durable tasks complete, ~73% task progress; 3/4 phases complete, 75% phase-count progress). Cycle 3 code review (Score 8/10, 0 critical) confirmed fixes for Cycle 2 findings; 3 medium warnings (W1 replay backpressure retry efficiency, W2 multi-document stdin stress testing, W3 ping keepalive precision) tracked as carryovers into Phase 04 integrated qualification. Phase 04 (Release and config boundaries) marked DONE (accepted with deferred issues 2026-10-26 14:35:00 +07:00) (15/15 durable tasks complete, 100% durable task progress; 4/4 phases complete, 100% phase-count progress; 76h/76h planned effort accounting). Cycle 3 code review confirmed score 8/10, 0 critical. Qualification gates (full container Playwright E2E execution, compiled release loopback qualification, and human visual sign-off) deferred to staging/CI gate; release hold maintained on branch `feat/lsp-server-integration-reassess`.

Repair F1–F13 from [consolidated triage](../reports/review-261025-0731-pr74.md), scoped to verified head `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against merge-base `45a51efe43ef6024dbd875d2498b456a7d4db110`. Reuse current queues, model registry, actor, publisher, query cache, and canonical protection helper; no generic framework, language additions, dependency bumps, native expansion, or auth redesign.

## Progressive disclosure
| Phase | Findings | Status | Progress | Detail |
|---|---|---|---|---|
| 01 Editor content integrity | F1/F5/F6/F7 | complete (passed 2026-10-26 00:15:00 +07:00) | 100% | [Design, tasks, regression matrix](./phase-01-editor-content-integrity.md) |
| 02 Gateway coordinate proofs | F3/F8/F9 | DONE (accepted with deferred issues 2026-10-26 07:30:00 +07:00) | 100% | [Immutable proofs, coordinates, cancellation](./phase-02-gateway-coordinate-proofs.md) |
| 03 Session lifecycle | F10/F11/F13 | DONE (accepted with deferred issues 2026-10-26 08:35:00 +07:00) | 100% | [Recovery, idle capacity, admission deadline](./phase-03-session-lifecycle.md) |
| 04 Release and config boundaries | F2/F4/F12 | DONE (accepted with deferred issues 2026-10-26 14:35:00 +07:00) | 100% | [Independent fixes and integrated handoff](./phase-04-release-and-config-boundaries.md) |

## Required invariants
- Composed decoding/materialization pipeline: disk bytes → `TextDecoder` (drops one leading BOM) → Monaco 0.55.1 `PieceTreeTextBufferBuilder` (hypothesized BOM extraction and EOL normalization to confirm against pinned source) → `model.getValue(preserveBOM=false)` → candidate semantic projection $P$. Prove line/UTF-16 coordinate mapping and edit commutation across fixture matrix before projection code.
- Double-stripping named STOP/GO outcome: if existing Monaco pipeline already double-strips 2-BOM disk files, projection follows model text; altering materialization is a scope change requiring user decision. Mixed-EOL save serialization preserves current behavior.
- Deterministic failing-before gates on verified baseline `b031e6a` via disposable worktrees with test overlays for F1, F3, F9, and F4 before repairs, followed by identical passing scenarios. Use deterministic async channel barriers, never timing guesses.
- Accepted clean reload reconciles retained model from accepted unchanged store content before editing; dirty reconnect/undo and mtime conflict semantics hold. Semantics OFF does not contain F1.
- Rejected sync immediately invalidates source-query eligibility; re-entry requires full text above 64 KiB.
- Coordinates, text SHA, version and open incarnation come from exact query snapshot, never live relabeling. Logical cancellation/deadline spans both child stages.
- Every replacement child obeys restart budget and replays accepted overlays before Ready; exhausted actors cannot revive from `didOpen`. Empty sessions evict after 60-second idle deadline under real socket Pings.
- Semantic upgrade claims evaluation has two-second fail-closed deadline.
- Publisher packages verified pinned engine tuple. Canonical config guards cover reachable Git mutation effects; semantics OFF does not contain F4. Failed OFF refreshes captured owner status and displays error.

## Dependency and ownership policy
Fifteen durable tasks; IDs/dependencies in phase fences are authoritative. Bounded representation prerequisite in F7 must pass before projection and dependent gateway work. Phase 03 and Phase 04 fixes have disjoint writable files; serialize overlapping writers. One implementer owns each claimed task; one integration coordinator owns architecture preflight, docs reconciliation, and cross-phase evidence.

Cross-plan overlap: [original 260901 plan](../260901-1000-lsp-server-integration/plan.md) shares implementation domains; its labels are not evidence closing these findings. Do not activate or edit that plan. Schema integrity is manually verified; task hydration is explicitly omitted during authoring. `capture-evidence.ts` writes `review.md` as `PENDING_HUMAN_REVIEW`; automated tests never substitute for human visual review. Integration task exclusively owns capture artifact directory `packages/ui/e2e/semantic-navigation/` with no-spec-edits constraint.

## Architecture and representation decision
Read [subsystem architecture](../../docs/architecture/semantic-websocket-gateway.md) and [system ownership](../../docs/system-architecture.md). Intended deltas are specified in phases, not applied to protected docs during planning. Future approved implementation updates docs before behavior changes, with final evidence reconciliation in Phase 04.

Preserve existing filesystem decoding, store content/savedContent, Monaco materialization/EOL, and save serialization. Semantic-only LF projection is conditional on pinned-source/fixture proof that line/UTF-16 coordinates and edit application commute. Disk BOM metadata is matched at pin intake once; literal editor `U+FEFF` remains data. No global store/model normalization or new save policy.

## Evidence and verification boundary
- Verified baseline: `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- Failing-before methodology: execute regression tests against disposable worktrees checked out at `b031e6a` with test overlays to record failing-before artifacts for F1, F3, F9, and F4.
- Disambiguate test environments: `server/tests/fixtures/lsp-test-server.mjs` is an isolated Node mock server for supervisor actor tests; dedicated `server/tests/semantic_lifecycle_replay.rs` exercises real-tuple replay (`PackagedToolchain`) and WebSocket Ping capacity checks.
- Containerized web E2E (`application-services.ts`/`image-builder.ts`) injects engine dynamically at container startup when `semanticEngine: true` is configured; provision and verify the fixture's exact path `artifacts/semantic-qualification/staged-engine` via `stage-semantic-engine.mjs` before E2E. Prescribe `E2E_CAPTURE=1` and require positive publication in `evidence.json`. Extracted release qualification runs compiled tarball with staged engine on loopback.
- Every phase command is planned future verification. Final approval requires regression evidence, scoped compile checks, real Linux-server/web journey, independent review, and explicit human sign-off.

## Rollback and operational containment
PR #74 is unmerged; release hold is primary containment. F1 and F4 are reachable with semantics OFF. Operational containment runbook for environments running branch `feat/lsp-server-integration-reassess`:
1. Maintain release hold; do not merge or deploy PR #74 until all thirteen repairs pass qualification.
2. For F1: preserve/export unsaved drafts before browser reload or downgrade; never force-save over external modifications.
3. For F4: avoid worktree deletion or discard operations on worktrees hosting canonical configuration.
4. Rollback target: rollback to verified unaffected base `45a51efe43ef6024dbd875d2498b456a7d4db110`. Guidance documented in `docs/deployment-guide.md`.

## Validation Summary
**Validated:** 2026-10-25 · **Questions asked:** 0; repository/evidence questions resolved directly. **Status:** VALIDATED / READY FOR REVIEW.

### Confirmed Decisions
- Composed decoding/materialization pipeline explicated; double-stripping resolved via named STOP/GO outcome (projection follows model text; altering materialization is a scope change).
- Deterministic failing-before evidence required on verified baseline `b031e6a` via disposable worktrees with test overlays for F1, F3, F9, and F4.
- Test environments disambiguated (mock server vs real tuple in dedicated test file `semantic_lifecycle_replay.rs`; failed-OFF E2E spec `semantic-failed-off.spec.ts`).
- Operational containment detailed for F1 and F4 outside semantics OFF (release hold, draft export, rollback to `45a51ef`).
- Independent plan review completed by `evc-code-reviewer` (`plans/reports/code-review-261025-1825-pr74-remediation-plan.md`); all three findings triaged and resolved.

### Action Items — resolution of required contract revisions
- [x] **R1 — Composed representation pipeline & matrix:** Explicated disk bytes → TextDecoder → Monaco buffer builder → model.getValue() → projection pipeline in Phase 01 `semantic-text-representation` and Phase 02 pin/proof consumers. Mandated fixture matrix (0/1/2 disk BOM, literal editor U+FEFF, all EOL forms, UTF-16/astral coordinates, multi-edits, CR/LF adjacency, flush/undo) with named double-strip STOP/GO outcome and STOP checkpoint.
- [x] **R2 — Deterministic failing-before gates:** Added baseline `b031e6a` failing-before requirements and disposable worktree methodology for F1 (`reconcile-clean-reload`), F3 (`preserve-query-snapshot-proof`), F9 (`retain-logical-navigation-cancellation`), and F4 (`guard-git-protected-config-effects`) using deterministic async barriers, not timing guesses.
- [x] **R3 — Exact test paths, ownership, and qualification boundaries:** Assigned dedicated test file `server/tests/semantic_lifecycle_replay.rs` for real-tuple replay and WebSocket ping capacity checks in Phase 03. Assigned `packages/ui/e2e/semantic-navigation/semantic-failed-off.spec.ts` to `refresh-failed-off-status`. Explicitly assigned capture-evidence output directory to `integrate-remediation-evidence` and kept earlier task capture disabled (`E2E_CAPTURE=0`). Bound container fixture to exact path `artifacts/semantic-qualification/staged-engine`.
- [x] **R4 — Operational containment outside semantics OFF:** Specified release hold, draft preservation/export before reload/downgrade (no force-save), avoidance of config worktree operations, and rollback target `45a51ef` for F1/F4 in Phase 01/04 risks and `docs/deployment-guide.md`.
- [x] **R5 — Plan-wide propagation, independent review, and revalidation:** Propagated R1–R4 into `plan.md` and phases 01–04. Obtained independent plan-only review by `evc-code-reviewer` (`plans/reports/code-review-261025-1825-pr74-remediation-plan.md`). Triaged and resolved all three findings (P1: capture output ownership; P2: `E2E_CAPTURE=1` and publication receipt; P3: `artifacts/semantic-qualification/staged-engine` staging path). Revalidated plan.

### Review Findings Triage (from `plans/reports/code-review-261025-1825-pr74-remediation-plan.md`)
- **P1 (Medium) — Final evidence owner cannot write its required capture artifacts:** **Accepted & Resolved.** Added `packages/ui/e2e/semantic-navigation/` to `allowed_files` of `integrate-remediation-evidence` in Phase 04 with a strict constraint that no test spec or application source code is edited. Removed `E2E_CAPTURE=1` from `refresh-failed-off-status` to keep capture writes strictly exclusive to the integration coordinator.
- **P2 (Medium) — Prescribed acceptance command can pass without publishing evidence:** **Accepted & Resolved.** Prescribed `E2E_CAPTURE=1` in Phase 04 acceptance commands. Defined executable observation point: inspect `evidence.json` for fresh `run_id`, matching `git_head` and `source_fingerprint`, and `functional_outcome: "passed"`. Retained `PENDING_HUMAN_REVIEW` boundary.
- **P3 (Medium) — Container qualification prerequisite ignores existing runtime engine injection:** **Accepted & Resolved.** Bound container E2E qualification to the fixture's exact path `artifacts/semantic-qualification/staged-engine` consumed by `application-services.ts`. Required explicit pre-run staging and verification via `stage-semantic-engine.mjs`. Preserved separate extracted release tarball qualification.

## Unresolved questions
None requiring a user choice. Phases 01, 02, 03, and 04 implementation and testing completed under work cycle reviews (Phase 02 accepted with deferred review warnings W1, W3, W4, W5, W7, W8, W9; Phase 03 accepted with deferred review warnings W1, W2, W3; Phase 04 accepted with deferred issues 2026-10-26 14:35:00 +07:00 after Code Review Cycle 3 score 8/10, 0 critical). Full containerized E2E/live-TSLS qualification, human visual review in review.md, and branch merge/release remain gated under the active release hold.
