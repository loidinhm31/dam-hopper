# P04 — Dock icons pins and Apps interactions

Status: **completed** · Priority: P2 · Estimated effort: **16h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **DockOwner**. Group: **G3: one independent node concurrent with P05/P06**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `persist-and-render-dock` — Deliver shared SVG dock pins Apps and menus

- [x] <!-- evcrate-task:persist-and-render-dock --> Deliver shared SVG dock pins Apps and menus

1. Create app-icons.tsx exhaustive static Record<OsAppId,LucideIcon> mapping, installed Lucide only, consistent 20px stroke/currentColor. Reuse Dock/launcher, P07 palette. Do not create app-icons.test.tsx or permanent icon/name-map/token-copy assertions; static types ensure completeness, integrated accessibility/visual checks ensure presentation.
2. Implement C6 canonical pin external snapshot/subscription, valid [] preservation, unknown filtering/dedup, storage-event cleanup; persistence import commits through dependency-safe notification seam without persistence->dock-pins->persistence cycle. Dock-only import updates same-tab mounted UI and other tabs; export canonical pins, old shortcut import ignored, safety journal untouched.
3. Render ordered pins then manifest-order running-unpinned across desktops deduped. Left content-height presentation consumes frozen appearance props without shared CSS writes. 44px target/20px icon; focused/running/minimized distinct accessible indicators. Fixed reachable Apps outside app overflow scroller.
4. Apps catalog pins unopened apps, Dock menu Open/Focus/pin/only supported New/qualified running windows. Shared executor; captured context/disabled reason, no Close/Kill/reorder/auto-hide. Existing coordinated menu wrapper API only, no dependency on P06 unfinished optional portal capability.
5. Mounted keyboard/accessibility tests actual pin action/open/menu/disabled/exact running focus: names and decorative icon semantics checked with real interaction, not duplicate name table. Storage denial/error preserves prior durable snapshot with visible unsaved state. Unpin running stays until final view close, no resource close/kill.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/app-icons.tsx`
- `packages/ui/src/os/Dock.tsx`
- `packages/ui/src/os/Dock.test.tsx`
- `packages/ui/src/os/dock-pins.ts`
- `packages/ui/src/os/dock-pins.test.ts`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/persistence.test.ts`
- `packages/ui/src/os/dock-context-menu.tsx`
- `packages/ui/src/os/dock-context-menu.test.tsx`
- `packages/ui/src/os/AppLauncher.tsx`
- `packages/ui/src/os/AppLauncher.test.tsx`

**Acceptance:**
- Mounted membership/order/empty/reload/import/export/error and keyboard Apps/menu behavior correct without resource mutation.
- Shared exhaustive SVG source and meaningful accessible focus/running/minimized interactions; permanent Apps reachable independent overflow.

**Future verification, not receipts:**
- All G3 writers must be implementation-terminal before one coordinator checks this branch; completion (not terminal alone) required before P07. pnpm --filter @dam-hopper/ui build
- pnpm --filter @dam-hopper/ui test src/os/dock-pins.test.ts src/os/persistence.test.ts src/os/Dock.test.tsx src/os/dock-context-menu.test.tsx src/os/AppLauncher.test.tsx; mounted pin/import/keyboard smoke and independent review.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "persist-and-render-dock",
    "title": "Deliver shared SVG dock pins Apps and menus",
    "blocked_by": [
      "capture-and-cache-input"
    ],
    "allowed_files": [
      "packages/ui/src/os/app-icons.tsx",
      "packages/ui/src/os/Dock.tsx",
      "packages/ui/src/os/Dock.test.tsx",
      "packages/ui/src/os/dock-pins.ts",
      "packages/ui/src/os/dock-pins.test.ts",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/os/dock-context-menu.tsx",
      "packages/ui/src/os/dock-context-menu.test.tsx",
      "packages/ui/src/os/AppLauncher.tsx",
      "packages/ui/src/os/AppLauncher.test.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Mounted membership/order/empty/reload/import/export/error and keyboard Apps/menu behavior correct without resource mutation.",
      "Shared exhaustive SVG source and meaningful accessible focus/running/minimized interactions; permanent Apps reachable independent overflow."
    ],
    "verification": [
      "All G3 writers must be implementation-terminal before one coordinator checks this branch; completion (not terminal alone) required before P07. pnpm --filter @dam-hopper/ui build",
      "pnpm --filter @dam-hopper/ui test src/os/dock-pins.test.ts src/os/persistence.test.ts src/os/Dock.test.tsx src/os/dock-context-menu.test.tsx src/os/AppLauncher.test.tsx; mounted pin/import/keyboard smoke and independent review."
    ]
  }
]
```

## Risks, failure and rollback

Risk: pins [] reset, import stale subscription, hidden write failure, Apps overflow trap. Keep journal namespace untouched; restore only failed pin snapshot honestly, never kill resource. No shared OsShell/os.css/ContextMenu wrapper writes.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

After all G3 terminals and coordinator compile/tests/smoke/review, transfer completed Dock/modules to P07. No internal dependent branch task waits on unchecked G3 work because branch is one node.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
