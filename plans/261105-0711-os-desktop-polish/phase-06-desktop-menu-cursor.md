# P06 — Background menu and scoped native cursor

Status: **completed** · Priority: P2 · Estimated effort: **14h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **DesktopOwner**. Group: **G3: one independent node concurrent with P04/P05**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `scope-desktop-menus` — Deliver captured background menu and owned native cursors

- [x] <!-- evcrate-task:scope-desktop-menus --> Deliver captured background menu and owned native cursors

1. C8 dedicated focusable background component, not ancestor of window children. Existing marker/Radix coordinator owns pointer/Menu-key/Shift+F10 arrows/collision/Escape/outside/focus return; capture exact desktop/owner/context at open, revalidate selection and reject stale without B fallback.
2. New Terminal invokes supported New with C12 captured target/directory context, Apps/Palette shared actions; Desktop Appearance invokes app.settings.open settingsSection appearance. Executor already emits token; P07 owns actual Settings consumer. No direct section DOM hack.
3. Consume the completed P03 coordinator snapshot/subscription/privacy-dismiss seam; current modal prevents background opening. Add explicit owned portal container/attribute capability to existing wrapper without changing its callers' required props. No document.body universal scope; no root dispatcher dependency on new P06 exports.
4. Create two static native SVG default/pointer assets and cursor helper system|theme for explicit shell/owned portals; cleanup attrs, auto/pointer fallback and forced-colors system. No overlay/trails/per-mousemove state/dependencies; preserve text/all resize/move/grab/grabbing/drag and iframe semantics. P07 alone writes shell CSS/scoping.
5. Tests keyboard focus return, capture switch/removal/Cognito/modal/descendant exclusion, portal ownership cleanup/system fallback. No static copied theme-token or icon-name assertions. Actual native cursor and cross-origin right-click proof P08.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/DesktopContextMenu.tsx`
- `packages/ui/src/os/DesktopContextMenu.test.tsx`
- `packages/ui/src/lib/context-menu-coordinator.ts`
- `packages/ui/src/components/ui/ContextMenu.tsx`
- `packages/ui/src/os/cursor.ts`
- `packages/ui/src/os/cursor.test.ts`
- `packages/ui/src/os/assets/cursor-default.svg`
- `packages/ui/src/os/assets/cursor-pointer.svg`

**Acceptance:**
- Background-only menu captures exact context and cannot act behind privacy/modal or on unrelated owner.
- Scoped cursor capability opt-in system default; no semantic/body-wide override and no shared CSS write.
- Appearance action delivers typed revisioned request; actual reveal integration explicitly owned in P07.

**Future verification, not receipts:**
- After all G3 terminals coordinator runs pnpm --filter @dam-hopper/ui build; passing branch evidence before P07.
- pnpm --filter @dam-hopper/ui test src/os/DesktopContextMenu.test.tsx src/os/cursor.test.ts src/os/action-dispatch.test.ts src/os/shell-input-context.test.tsx src/lib/context-menu-coordinator.test.ts; mounted keyboard/context/owned portal and immediate ownership-transition smoke, independent review.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "scope-desktop-menus",
    "title": "Deliver captured background menu and owned native cursors",
    "blocked_by": [
      "capture-and-cache-input"
    ],
    "allowed_files": [
      "packages/ui/src/os/DesktopContextMenu.tsx",
      "packages/ui/src/os/DesktopContextMenu.test.tsx",
      "packages/ui/src/lib/context-menu-coordinator.ts",
      "packages/ui/src/components/ui/ContextMenu.tsx",
      "packages/ui/src/os/cursor.ts",
      "packages/ui/src/os/cursor.test.ts",
      "packages/ui/src/os/assets/cursor-default.svg",
      "packages/ui/src/os/assets/cursor-pointer.svg"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Background-only menu captures exact context and cannot act behind privacy/modal or on unrelated owner.",
      "Scoped cursor capability opt-in system default; no semantic/body-wide override and no shared CSS write.",
      "Appearance action delivers typed revisioned request; actual reveal integration explicitly owned in P07."
    ],
    "verification": [
      "After all G3 terminals coordinator runs pnpm --filter @dam-hopper/ui build; passing branch evidence before P07.",
      "pnpm --filter @dam-hopper/ui test src/os/DesktopContextMenu.test.tsx src/os/cursor.test.ts src/os/action-dispatch.test.ts src/os/shell-input-context.test.tsx src/lib/context-menu-coordinator.test.ts; mounted keyboard/context/owned portal and immediate ownership-transition smoke, independent review."
    ]
  }
]
```

## Risks, failure and rollback

Risk: ancestor trigger, stale context, menu command behind privacy, portal cursor globally overriding semantics. Dismiss stale menu/show reason, fallback system, never broaden body selector. No direct shell/canvas/style or Dock writes.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

After verified G3 barrier hand component/owned portal/cursor cleanup contract to P07. Existing coordinator interface remains source-compatible for Dock branch; concurrency cannot depend on new unfinished API.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
