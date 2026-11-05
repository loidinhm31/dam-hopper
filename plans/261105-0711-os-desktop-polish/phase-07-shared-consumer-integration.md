# P07 — Sequential shell palette and Appearance integration

Status: **completed** · Priority: P2 · Estimated effort: **20h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **IntegrationOwner**. Group: **G4, checked sequential nodes after all three G3 completions**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `integrate-shell-layout` — Wire floating dock work area background menu and cursor

- [x] <!-- evcrate-task:integrate-shell-layout --> Wire floating dock work area background menu and cursor

1. Wire completed Dock/Apps/menu/cursor and live C4 appearance to shell/CSS. Gutter =44+2*dockPadding+2*dockOuterSpacing; left-only centered content-height dock with app overflow and fixed Apps. Radius independent of geometry; work area leaves topbar/dock; actual browser support remains separate.
2. Insert dedicated background trigger sibling behind windows via completed canvas interface, not ancestor. Own portal cursor scope explicit; preserve text/resize/move/grab/drag and forced-colors. Do not move root keyboard installation into shell or duplicate completed action/intent executor.
3. Preserve P05 presentation slots and P03 frame cached-resolution behavior; available reference inventory before any changed exports. Complete mounted shell integration with current store state, not stale effect closures. Test actual layout/menu context and root lifecycle, not mocked executor success.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/DesktopCanvas.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/src/os/os.css`
- `packages/ui/browser-tests/os-shell.browser.tsx`

**Acceptance:**
- Floating dock reservation/maximized canvas/menu/cursor work together; root keyboard authority untouched.
- No app descendant desktop trigger, body cursor override or regenerated resource host.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/window-ops.test.ts src/os/shell-input-context.test.tsx; pnpm --filter @dam-hopper/ui test:browser browser-tests/os-shell.browser.tsx; mounted menu/maximize/gutter smoke.

### `integrate-settings-palette` — Wire manifest palette and repeat-delivered Appearance consumer

- [x] <!-- evcrate-task:integrate-settings-palette --> Wire manifest palette and repeat-delivered Appearance consumer

1. CommandPalette consumes shared descriptors/executor/icons and current configured hints/disabled reasons; remove own generic launcher/hardcoded terminal hint/default profile. P02 already owns actual Settings shortcut rows/null/conflicts; do not leave those migrations here.
2. C13 SettingsApp reacts to fresh Appearance deliveryId on new/existing singleton, selects General even from Devices, passes request to SettingsPage. Page controls Appearance open/onOpenChange and stable ref scroll/focus after mount; accordion supports controlled option while other consumers remain uncontrolled. Repeated request after manual collapse opens/focuses again; consumed token prevents unwanted refetch reopening.
3. Tests new/existing/minimized Settings, Devices->Appearance, manual collapse->new same-section request, local collapse afterward, no route/profile target/source-selector mutation. No text/label query click as implementation. Palette tests select real action/disabled context/current hints and shared icon meaningful semantics in keyboard interaction.
4. Final reference search removes obsolete exported aliases only where already owned; unknown additional caller requires allowlist revision before write. No deferred compile diagnostics from prior nodes tolerated.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/os/CommandPalette.tsx`
- `packages/ui/src/os/CommandPalette.test.tsx`
- `packages/ui/src/os/apps/SettingsApp.tsx`
- `packages/ui/src/os/apps/SettingsApp.test.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/components/pages/SettingsPage.test.tsx`
- `packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.tsx`
- `packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.test.tsx`

**Acceptance:**
- Desktop Appearance actually opens/focuses expanded section on every explicit request, without changing Settings target or Preferences Source.
- Palette uses sole executor/configured hints for all manifest apps; no obsolete launcher/ambient fallback.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/os/CommandPalette.test.tsx src/os/apps/SettingsApp.test.tsx src/components/pages/SettingsPage.test.tsx src/components/pages/settings-page/SettingsSectionAccordion.test.tsx; mounted Devices/collapse/repeat Appearance and palette smoke.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "integrate-shell-layout",
    "title": "Wire floating dock work area background menu and cursor",
    "blocked_by": [
      "persist-and-render-dock",
      "present-maximized-work-area",
      "scope-desktop-menus"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/src/os/os.css",
      "packages/ui/browser-tests/os-shell.browser.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Floating dock reservation/maximized canvas/menu/cursor work together; root keyboard authority untouched.",
      "No app descendant desktop trigger, body cursor override or regenerated resource host."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/window-ops.test.ts src/os/shell-input-context.test.tsx; pnpm --filter @dam-hopper/ui test:browser browser-tests/os-shell.browser.tsx; mounted menu/maximize/gutter smoke."
    ]
  },
  {
    "id": "integrate-settings-palette",
    "title": "Wire manifest palette and repeat-delivered Appearance consumer",
    "blocked_by": [
      "integrate-shell-layout"
    ],
    "allowed_files": [
      "packages/ui/src/os/CommandPalette.tsx",
      "packages/ui/src/os/CommandPalette.test.tsx",
      "packages/ui/src/os/apps/SettingsApp.tsx",
      "packages/ui/src/os/apps/SettingsApp.test.tsx",
      "packages/ui/src/components/pages/SettingsPage.tsx",
      "packages/ui/src/components/pages/SettingsPage.test.tsx",
      "packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.tsx",
      "packages/ui/src/components/pages/settings-page/SettingsSectionAccordion.test.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Desktop Appearance actually opens/focuses expanded section on every explicit request, without changing Settings target or Preferences Source.",
      "Palette uses sole executor/configured hints for all manifest apps; no obsolete launcher/ambient fallback."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/os/CommandPalette.test.tsx src/os/apps/SettingsApp.test.tsx src/components/pages/SettingsPage.test.tsx src/components/pages/settings-page/SettingsSectionAccordion.test.tsx; mounted Devices/collapse/repeat Appearance and palette smoke."
    ]
  }
]
```

## Risks, failure and rollback

Risk: requested string unchanged means no reopen, accordion initializer mistaken for navigation, target/source mutated by UI hack, root authority duplicated. Roll back coherent wiring/token consumer, preserve resources/config/journal; never label existing failed prerequisite acceptable.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

P08 begins only after both G4 nodes have passing applicable compile/test/smoke/review. Integrated qualification adds evidence, does not repair a knowingly compile-broken dependency chain.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
