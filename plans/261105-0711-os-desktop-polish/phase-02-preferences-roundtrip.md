# P02 — Coherent preference schema and consumer cutover

Status: **completed** · Priority: P2 · Estimated effort: **22h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **PreferencesOwner**. Group: **G2a, sequential after verified P01; NOT parallel with P03**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `persist-preference-pipeline` — Atomically migrate preference schema persistence callers and tests

- [x] <!-- evcrate-task:persist-preference-pipeline --> Atomically migrate preference schema persistence callers and tests

1. In this single node migrate client UiConfig, presence-aware defaults, store state/hydration/offline snapshot/source-unset/source-removed/reset/lastSavedSettings and Rust schema/API/global writer/tests together. All C4 fields/snake_case/ranges, nullable established bindings except validated nonempty Cognito, palette/focus and extra-only map are end-to-end. Do not complete on source schema alone.
2. Known-path null -> TOML empty string before generic null dropping; decode empty to JSON null; missing -> descriptor default, omitted PATCH unchanged. Per-entry appShortcuts merge in pending 500ms batch AND server merge; {} no-op, map-level null/malformed/scalar-owned/unknown rejected. Reset explicit defaults/null extras; finite ranges preserve zero. API->disk->restart/read regression incl unrelated null/update.
3. Remove Fleet constant/type/store/hydration/default/UI row/terminal list/Rust mapping and affected fixture/literal assertions now. Own both known browser fixture files and server/src/api/tests.rs (nullable project_panel_shortcut assertion), config tests and settings_import_export. Retained Android unknown Fleet patch inert through serde tolerance, no deprecated field/mobile rewrite.
4. Migrate nullable consumers in same node: Settings capture accepts null/unbind/reset and exact conflict feedback; keyboard matcher/hook getter and terminal helper option signatures accept null without default resurrection; arbiter accepts nullable palette/focus and removes hardcoded OR/default shadowing; root font path respects null but retains current behavior until atomic P03 authority transfer. Existing Monaco getter compiles via changed hook signature; no second input authority introduced.
5. Reuse captured source/client/generation/edit revision fences; source switch cancels only undispatched edits, stale failure cannot overwrite newer source/edit. Replace default/wording-only tests with roundtrip, debounce, rollback, null, old-chord and failure behavior. All known source and test references compile before dependency completion.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/api/client.ts`
- `packages/ui/src/lib/ui-config.ts`
- `packages/ui/src/lib/ui-config.test.ts`
- `packages/ui/src/stores/settings.ts`
- `packages/ui/src/stores/settings.test.ts`
- `packages/ui/src/lib/shortcuts.ts`
- `packages/ui/src/lib/shortcuts.test.ts`
- `packages/ui/src/hooks/use-shortcuts.ts`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx`
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.test.tsx`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts`
- `packages/ui/src/os/input-arbiter.ts`
- `packages/ui/src/os/input-arbiter.test.ts`
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `server/src/config/schema.rs`
- `server/src/config/global.rs`
- `server/src/config/tests.rs`
- `server/src/api/config.rs`
- `server/src/api/tests.rs`
- `server/tests/settings_import_export.rs`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`
- `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx`

**Acceptance:**
- No known nullable/Fleet consumer or Rust test literal deferred; source schema/callers/tests coherent together.
- Null/missing/PATCH/reset/map merge and source edit fences survive real persistence boundaries; Cognito remains dismissible.
- Remapped/unbound palette/focus no hardcoded default OR; terminal/font nullable consumers preserve supported scope.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/stores/settings.test.ts src/lib/ui-config.test.ts src/stores/workbench-selections.test.ts src/lib/shortcuts.test.ts src/lib/terminal-keyboard-shortcuts.test.ts src/os/input-arbiter.test.ts src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx src/components/organisms/TerminalPanel.test.tsx src/embed/dam-hopper-app.test.tsx
- cargo check --manifest-path server/Cargo.toml; cargo test --manifest-path server/Cargo.toml config::tests; cargo test --manifest-path server/Cargo.toml api::tests; cargo test --manifest-path server/Cargo.toml --test settings_import_export
- pnpm --filter @dam-hopper/ui test:browser browser-tests/project-worktree-target.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx; owner-bound API patch/read, TOML empty, restart/read smoke before completing node.

### `expose-appearance-controls` — Expose source-managed dock and cursor controls

- [x] <!-- evcrate-task:expose-appearance-controls --> Expose source-managed dock and cursor controls

1. Add existing-style labeled bounded dockPadding/itemSpacing/outerSpacing/radius controls and System/Theme cursor choice. Use completed store/source pipeline; show disconnected/unset/source-removed/error states; never localStorage preferences.
2. Edit/reset/zero/bounds/save failure tests; explain local pins versus source preferences. Keep Settings target independent. No live shell wiring here; controls themselves are usable and independently checked.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`
- `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`

**Acceptance:**
- C4 ranges/defaults/zero/reset reach source pipeline; errors and source disabling honest.

**Future verification, not receipts:**
- Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.
- pnpm --filter @dam-hopper/ui test src/components/organisms/SettingsAppearanceSection.test.tsx; smoke edit/reset/unset source controls.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "persist-preference-pipeline",
    "title": "Atomically migrate preference schema persistence callers and tests",
    "blocked_by": [
      "define-action-contracts"
    ],
    "allowed_files": [
      "packages/ui/src/api/client.ts",
      "packages/ui/src/lib/ui-config.ts",
      "packages/ui/src/lib/ui-config.test.ts",
      "packages/ui/src/stores/settings.ts",
      "packages/ui/src/stores/settings.test.ts",
      "packages/ui/src/lib/shortcuts.ts",
      "packages/ui/src/lib/shortcuts.test.ts",
      "packages/ui/src/hooks/use-shortcuts.ts",
      "packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx",
      "packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.test.tsx",
      "packages/ui/src/lib/terminal-keyboard-shortcuts.ts",
      "packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts",
      "packages/ui/src/os/input-arbiter.ts",
      "packages/ui/src/os/input-arbiter.test.ts",
      "packages/ui/src/embed/dam-hopper-app.tsx",
      "packages/ui/src/embed/dam-hopper-app.test.tsx",
      "server/src/config/schema.rs",
      "server/src/config/global.rs",
      "server/src/config/tests.rs",
      "server/src/api/config.rs",
      "server/src/api/tests.rs",
      "server/tests/settings_import_export.rs",
      "packages/ui/browser-tests/project-worktree-target.browser.tsx",
      "packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "No known nullable/Fleet consumer or Rust test literal deferred; source schema/callers/tests coherent together.",
      "Null/missing/PATCH/reset/map merge and source edit fences survive real persistence boundaries; Cognito remains dismissible.",
      "Remapped/unbound palette/focus no hardcoded default OR; terminal/font nullable consumers preserve supported scope."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/stores/settings.test.ts src/lib/ui-config.test.ts src/stores/workbench-selections.test.ts src/lib/shortcuts.test.ts src/lib/terminal-keyboard-shortcuts.test.ts src/os/input-arbiter.test.ts src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx src/components/organisms/TerminalPanel.test.tsx src/embed/dam-hopper-app.test.tsx",
      "cargo check --manifest-path server/Cargo.toml; cargo test --manifest-path server/Cargo.toml config::tests; cargo test --manifest-path server/Cargo.toml api::tests; cargo test --manifest-path server/Cargo.toml --test settings_import_export",
      "pnpm --filter @dam-hopper/ui test:browser browser-tests/project-worktree-target.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx; owner-bound API patch/read, TOML empty, restart/read smoke before completing node."
    ]
  },
  {
    "id": "expose-appearance-controls",
    "title": "Expose source-managed dock and cursor controls",
    "blocked_by": [
      "persist-preference-pipeline"
    ],
    "allowed_files": [
      "packages/ui/src/components/organisms/SettingsAppearanceSection.tsx",
      "packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "C4 ranges/defaults/zero/reset reach source pipeline; errors and source disabling honest."
    ],
    "verification": [
      "Coordinator after implementation terminal: pnpm --filter @dam-hopper/ui build; run focused tests below, behavior smoke and passing independent implementation review; record commands, exit codes and reports before completion.",
      "pnpm --filter @dam-hopper/ui test src/components/organisms/SettingsAppearanceSection.test.tsx; smoke edit/reset/unset source controls."
    ]
  }
]
```

## Risks, failure and rollback

Risk: Option alone loses null on disk, map shallow merge drops entries, stale rollback changes B, partial Fleet removal breaks tests. Block on any applicable failure, roll back whole schema/caller/persistence node only; preserve config backups and journal. Explicit chords before downgrade.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

Only after both nodes evidence-backed complete may P03 start. Backend not independent on unfinished source contracts; no P02||P03 claim.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
