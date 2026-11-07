# P09 — Maintained documentation and honest final handoff

Status: **completed** · Priority: P2 · Estimated effort: **8h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **DocsOwner / IntegrationOwner finalizer**. Group: **G6, two checked sequential nodes after G5**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `document-delivered-contracts` — Document delivered architecture configuration and user behavior

- [x] <!-- evcrate-task:document-delivered-contracts --> Document delivered architecture configuration and user behavior

1. After separate implementation authorization and exclusive docs handoff, read final source/current receipts. Explain all17 app Open/Focus and supported New real choosers/cancel/collision/selection, lossless folder New, scalar/map/null/TOML/source/reset/Cognito, Fleet retirement/inert old Android patch, browser-local pins/journal exclusion.
2. Document root guard order/lazy lifecycle/privacy held releases/page-wide font/browser-reserved limits, deep-link authorization seam, repeated Appearance navigation with selectors preserved, dock ranges/geometry/menu/cursor/iframe and runtime continuity guarantees actually evidenced.
3. Only delivered behavior moves planned system-architecture section to current design, to extent receipts support; parent planned-doc section remains unchanged by THIS planning revision. Scoped roadmap/changelog state distinguishes implementation/live/production human acceptance. No predecessor status rewrite.
4. Explain bounded global journal lock/limits/exact provenance/indefinite uncertainty/no safe reset/retry and browser/storage/alias limits; downgrade explicit chords before old binary, preserve safety metadata. No actual Git/hydration/resource operation authorized by docs.

**Exact writable paths** (modify existing/create new; no deletes):
- `docs/system-architecture.md`
- `docs/configuration-guide.md`
- `docs/frontend-components/terminal-and-ide.md`
- `docs/frontend-components/workbench.md`
- `docs/project-roadmap.md`
- `docs/CHANGELOG.md`

**Acceptance:**
- Maintained docs accurately match final delivered source and expose uncertainty/ownership/browser/human limits.
- No planned behavior mislabeled shipped or inherited release gate silently closed.

**Future verification, not receipts:**
- Compile N/A only for documentation-only diff with recorded reason; retain product test receipts rather than claim rerun. Coordinator checks links/fields against source and actual P08 reports, user-flow walkthrough smoke and independent docs review before next node.

### `reconcile-final-handoff` — Reconcile all acceptance receipts and final permission boundaries

- [x] <!-- evcrate-task:reconcile-final-handoff --> Reconcile all acceptance receipts and final permission boundaries

1. Reconcile every task/AC1-10 with actual implementation terminal, applicable passed compile/tests/smoke/review evidence and exact artifacts. Missing failed/live/infra/human gates listed, no narrowed acceptance; PENDING_HUMAN_REVIEW never production ready.
2. List changed files/ownership releases/canonical plan/remaining inherited gates and exact rollback/storage/source/ID/uncertainty limitations. Task completion vs implementation code completion vs release/human acceptance separate. No implementation approval from this planner/reviewer result.
3. No task engine/state hydration/native APIs/Git finalization; any later installed-helper operation belongs authorized single coordinator, not handwritten state. Return precise commands/exits/results and unanswered questions only if real.

**Exact writable paths** (modify existing/create new; no deletes):
- `plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md`

**Acceptance:**
- Final report distinguishes actual delivered code/tests/live/human status with all failures/gates preserved.
- No hidden implementation/Git permission, no fabricated receipt or precursor-plan completion.

**Future verification, not receipts:**
- Report-only compile N/A with reason; no source changed, reference retained applicable product checks honestly. Coordinator cross-checks actual receipts/all AC rows, handoff-link walkthrough smoke and independent report review; missing required evidence blocks completion.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "document-delivered-contracts",
    "title": "Document delivered architecture configuration and user behavior",
    "blocked_by": [
      "capture-visual-human-ledger"
    ],
    "allowed_files": [
      "docs/system-architecture.md",
      "docs/configuration-guide.md",
      "docs/frontend-components/terminal-and-ide.md",
      "docs/frontend-components/workbench.md",
      "docs/project-roadmap.md",
      "docs/CHANGELOG.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Maintained docs accurately match final delivered source and expose uncertainty/ownership/browser/human limits.",
      "No planned behavior mislabeled shipped or inherited release gate silently closed."
    ],
    "verification": [
      "Compile N/A only for documentation-only diff with recorded reason; retain product test receipts rather than claim rerun. Coordinator checks links/fields against source and actual P08 reports, user-flow walkthrough smoke and independent docs review before next node."
    ]
  },
  {
    "id": "reconcile-final-handoff",
    "title": "Reconcile all acceptance receipts and final permission boundaries",
    "blocked_by": [
      "document-delivered-contracts"
    ],
    "allowed_files": [
      "plans/261105-0711-os-desktop-polish/reports/implementation-handoff.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Final report distinguishes actual delivered code/tests/live/human status with all failures/gates preserved.",
      "No hidden implementation/Git permission, no fabricated receipt or precursor-plan completion."
    ],
    "verification": [
      "Report-only compile N/A with reason; no source changed, reference retained applicable product checks honestly. Coordinator cross-checks actual receipts/all AC rows, handoff-link walkthrough smoke and independent report review; missing required evidence blocks completion."
    ]
  }
]
```

## Risks, failure and rollback

Risk: documentation overclaims delivery, report pending human counted production pass, inherited gate dropped. Correct only selected inaccurate changes; unresolved product discrepancy returns exclusive owner for code repair, not paper-only acceptance.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

Return canonical path and honest authorized-scope completion. Separate implementation, release, human and Git permissions; never automatic commit/push/PR.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
