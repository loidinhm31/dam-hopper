# Implementation Plan: Settings Page Sections Collapse by Default

- **Target**: Default collapse state for all accordion sections on the Settings page.
- **Worktree**: `/home/loidinh/WS/worktrees/dam-hopper-settings-collapse-by-default`
- **Branch**: `feat/settings-collapse-by-default`
- **Date**: 2026-10-05

---

## 1. Context & Objectives

Currently, `SettingsPage.tsx` renders 9 sections wrapped in `SettingsSectionAccordion`:
1. Appearance (`defaultOpen`)
2. Keyboard Shortcuts (collapsed)
3. Usage insights (`defaultOpen`)
4. Terminal Idle Suspend (`defaultOpen`)
5. Global Settings (`defaultOpen`)
6. Workspace Config (`defaultOpen`)
7. Maintenance (collapsed)
8. Import / Export Settings (collapsed)
9. Native Advisor (collapsed)

Five sections explicitly set `defaultOpen`, causing them to start expanded. The user requested:
"make all sections in Settings page collapse by default, create a new worktree for it"

### Goals
1. Remove `defaultOpen` from all sections in `SettingsPage.tsx` so all 9 sections collapse by default (`defaultOpen` defaults to `false` in `SettingsSectionAccordion`).
2. Verify that clicking any accordion header still smoothly expands and collapses that section.
3. Add and update automated tests in `SettingsPage.test.tsx` verifying all sections default to collapsed upon initial render and expand upon toggle.
4. Execute and verify all checks within the dedicated worktree `/home/loidinh/WS/worktrees/dam-hopper-settings-collapse-by-default`.

---

## 2. Proposed Changes

### File: `packages/ui/src/components/pages/SettingsPage.tsx`
- Remove `defaultOpen` prop from:
  - Appearance section (`<SettingsSectionAccordion title="Appearance" ...>`)
  - Usage insights section (`<SettingsSectionAccordion title="Usage insights" ...>`)
  - Terminal Idle Suspend section (`<SettingsSectionAccordion title="Terminal Idle Suspend" ...>`)
  - Global Settings section (`<SettingsSectionAccordion title="Global Settings" ...>`)
  - Workspace Config section (`<SettingsSectionAccordion title="Workspace Config" ...>`)
- Keep `SettingsSectionAccordion` component unchanged, preserving its optional `defaultOpen?: boolean` with default `false`.

### File: `packages/ui/src/components/pages/SettingsPage.test.tsx`
- Add unit tests verifying:
  - Initial render has all 9 accordion toggle buttons with `aria-expanded="false"`.
  - All 9 accordion panels have the `hidden` attribute.
  - Clicking any section header button toggles `aria-expanded="true"` and removes `hidden`.
  - Clicking again collapses the section back.
- Confirm existing tests for export/import and dialog interactions remain passing.

---

## 3. Verification Plan

1. **Unit Tests**:
   - Run `pnpm --filter @dam-hopper/ui test SettingsPage.test.tsx`.
   - Run full UI suite `pnpm --filter @dam-hopper/ui test`.
2. **Typecheck & Linter**:
   - Run `pnpm --filter @dam-hopper/ui check` or `pnpm check`.
   - Run `pnpm lint`.
3. **Worktree Isolation**:
   - Changes committed/staged in the worktree branch `feat/settings-collapse-by-default` without polluting `main`.
