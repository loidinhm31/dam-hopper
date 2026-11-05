# P01 — Nonbreaking shared source preparation

Status: **completed** · Priority: P2 · Estimated effort: **8h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **IntegrationOwner**. Group: **G1, sequential**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `define-action-contracts` — Prepare pure catalog and additive context/layout contracts

- [x] <!-- evcrate-task:define-action-contracts --> Prepare pure catalog and additive context/layout contracts

1. Create actions.ts derived from APP_MANIFESTS with all C1 IDs, single scalar/extra binding sources and exact supported modes. Implement pure getActionDescriptor/resolveActionBinding now, against readonly structural settings projection; P03 consumes these functions, does not rewrite this file.
2. Add C1/C7/C10-C13 readonly context/request/result/terminal payload/chooser and presentation types to types.ts without changing existing UiConfig, intent requirements or live caller signatures. No breaking field removal, compatibility alias, adapter stub or alternate defaults authority.
3. Test pure presence-aware binding resolution (missing/default, null/unbound, configured replacement), scalar-vs-extra ownership, manifest exhaustiveness and exact context/payload types. Existing current source must remain compilable; freezing design is not permission to defer broken callers.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/actions.ts`
- `packages/ui/src/os/actions.test.ts`
- `packages/ui/src/os/types.ts`

**Acceptance:**
- Pure action functions work and additive types compile with all existing callers unchanged.
- C1/C7/C10-C13 interfaces fixed before feature concurrency; no DTO/intents breaking change in P01.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/actions.test.ts src/os/app-registry.test.ts; smoke descriptor resolution with explicit null/custom bindings.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "define-action-contracts",
    "title": "Prepare pure catalog and additive context/layout contracts",
    "blocked_by": [],
    "allowed_files": [
      "packages/ui/src/os/actions.ts",
      "packages/ui/src/os/actions.test.ts",
      "packages/ui/src/os/types.ts"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Pure action functions work and additive types compile with all existing callers unchanged.",
      "C1/C7/C10-C13 interfaces fixed before feature concurrency; no DTO/intents breaking change in P01."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/actions.test.ts src/os/app-registry.test.ts; smoke descriptor resolution with explicit null/custom bindings."
    ]
  }
]
```

## Risks, failure and rollback

Risk: premature breaking schema or interface-only scaffold. Keep preparatory additions pure, usable and fully checked; preserve current live behavior. Revert only coherent authorized prep if contracts disagree, never unrelated work.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

P02 receives verified pure catalog/additive types. No runtime preparation approval inferred; all other nodes remain pending.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
