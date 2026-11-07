# P05 — Canvas work-area maximize and browser support tiers

Status: **completed** · Priority: P2 · Estimated effort: **18h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **GeometryOwner**. Group: **G3: one independent node concurrent with P04/P06**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `present-maximized-work-area` — Deliver canvas maximize continuity and viewport tiers

- [x] <!-- evcrate-task:present-maximized-work-area --> Deliver canvas maximize continuity and viewport tiers

1. C7 canvas sibling maximized plane to tile/float layers with stable presentation slots and tiled placeholders. Reparent presentation slot, not resource React root; inset 0 actual canvas, no viewport fixed or absolute frame constrained inside nested tile.
2. Preserve tile tree, restorePlacement, saved floatBounds across maximize/restore/resize/minimize/desktop moves. Runtime host/claim single; no second editor/terminal/browser. Browser host already completed in P03 tracks slot movement; do not modify its source in this branch.
3. Use window innerWidth/innerHeight with cleanup for support tier only; canvas ResizeObserver still geometry authority. Preserve existing viewport hook public shape, 1024x640 supported despite smaller reserved canvas. No future required shell prop; existing OsShell caller compiles unchanged until P07 wiring.
4. Behavior tests nested tile and floating maximize/restore/bounds/stacking/exclusive slot. Assert same runtime object with no extra terminal transport attachment/replay/reset, Monaco dirty/selection/undo lifetime and iframe no navigation where reliable browser test layer supports; full real resource proof P08. Do not certify continuity by DOM identity alone.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/DesktopCanvas.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/src/os/window-ops.ts`
- `packages/ui/src/os/window-ops.test.ts`
- `packages/ui/src/os/maximized-presentation.test.tsx`
- `packages/ui/src/os/use-os-viewport.ts`
- `packages/ui/src/os/use-os-viewport.test.ts`

**Acceptance:**
- Tiled/floating maximize fills canvas with chrome available and restores exact saved placement.
- Browser support uses browser dimensions, window geometry canvas; 1024x640 valid.
- Presentation transitions preserve runtime/claim lifetime; no reload/recreation to repair geometry.

**Future verification, not receipts:**
- After all G3 writers terminal coordinator runs pnpm --filter @dam-hopper/ui build; no dependency completion before passing branch evidence.
- pnpm --filter @dam-hopper/ui test src/os/window-ops.test.ts src/os/maximized-presentation.test.tsx src/os/use-os-viewport.test.ts src/os/resource-registry.test.ts; nested maximize/restore/resize smoke and independent review. Real iframe heap/xterm/Monaco continuity P08 additional gate.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "present-maximized-work-area",
    "title": "Deliver canvas maximize continuity and viewport tiers",
    "blocked_by": [
      "capture-and-cache-input"
    ],
    "allowed_files": [
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/src/os/window-ops.ts",
      "packages/ui/src/os/window-ops.test.ts",
      "packages/ui/src/os/maximized-presentation.test.tsx",
      "packages/ui/src/os/use-os-viewport.ts",
      "packages/ui/src/os/use-os-viewport.test.ts"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Tiled/floating maximize fills canvas with chrome available and restores exact saved placement.",
      "Browser support uses browser dimensions, window geometry canvas; 1024x640 valid.",
      "Presentation transitions preserve runtime/claim lifetime; no reload/recreation to repair geometry."
    ],
    "verification": [
      "After all G3 writers terminal coordinator runs pnpm --filter @dam-hopper/ui build; no dependency completion before passing branch evidence.",
      "pnpm --filter @dam-hopper/ui test src/os/window-ops.test.ts src/os/maximized-presentation.test.tsx src/os/use-os-viewport.test.ts src/os/resource-registry.test.ts; nested maximize/restore/resize smoke and independent review. Real iframe heap/xterm/Monaco continuity P08 additional gate."
    ]
  }
]
```

## Risks, failure and rollback

Risk: nested tile containing block, destructive remount or saved bounds rewrite, canvas mistaken for browser support. Stop failed transition, preserve existing host, restore original slot/placement; no resource kill/recreate. No OsShell/os.css/persistence/host/menu writes.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

After verified G3 barrier transfer DesktopCanvas/WindowFrame to P07 only; prior atomic input migration intact, no reintroducing frame OS dispatcher.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
