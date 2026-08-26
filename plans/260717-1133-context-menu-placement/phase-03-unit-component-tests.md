# Phase 03 — Radix unit and component tests

## Context links

- Parent: [plan.md](./plan.md)
- Foundation: [phase-01](./phase-01-shared-context-menu-surface.md)
- Existing tests: `packages/ui/src/components/organisms/*ContextMenu*.test*`, `GitLogTree.test.ts`, `TerminalFloating*Panel.test.tsx`

## Overview

- Priority: P2
- Status: Done — 2026-07-17 23:17 +0700
- Effort: 2.5h
- Description: verify Radix wrapper defaults and preserve each menu's actions, triggers, and focus behavior.
- Review status: Not started

## Key insights

Radix owns placement arithmetic, so tests should validate portal/collision configuration and real trigger/content behavior instead of recreating Radix internals. Existing tests mostly cover guessed clamp constants, actions, or Escape.

## Requirements

- Wrapper tests assert `ContextMenu.Portal` content is under `document.body`, shared collision padding/side offset/max dimensions are applied, and Content/Item semantics are consistent.
- Component tests cover right-click, ContextMenu/Shift+F10, first-item focus, Arrow/Home/End navigation, Escape, outside pointer, scroll close, one-open-menu replacement, focus restoration, disabled items, and exactly-once action callbacks.
- Add trigger-compatibility tests for a react-arborist row, editor tab, Changed Files checkbox, Radix Select branch, and controlled diagnostics Root.
- Retain menu-specific action/selection tests for tree, history, commit, changed files, tabs, diagnostics, and branch.
- Remove tests that assert obsolete per-menu width/height clamp helpers.

## Architecture

Unit tests own wrapper defaults and state transitions. Component tests own React portals, Radix event wiring, focus, and dismissal. Browser tests in Phase 04 own real `backdrop-filter`, overflow clipping, collision, and zoom behavior.

## Related code files

Create:

- `packages/ui/src/components/ui/context-menu.test.tsx`
- Optional focused compatibility fixture under `packages/ui/src/components/ui/` if trigger adapters need isolated coverage.

Modify:

- Existing tests adjacent to Tree, GitLogTree, CommitDetails, ChangedFiles, EditorTabs, Diagnostics, and Branch menus.
- `TerminalFloatingFilePanel.test.tsx` and `TerminalFloatingToolPanel.test.tsx` only if a portal/offset fixture is useful.

Delete: obsolete clamp-helper tests owned by migrated menus.

## Implementation steps

1. Add wrapper tests for Radix Content portal, defaults, and close behavior.
2. Add trigger/category tests for pointer and keyboard invocation, including controlled roots.
3. Update consumer tests for action preservation, disabled behavior, focus restoration, and no duplicate callback.
4. Run `pnpm --filter @dam-hopper/ui test` and focused Vitest files; do not weaken assertions to accommodate shortcuts.

## Todo list

- [ ] Wrapper portal/collision/default tests.
- [ ] Trigger compatibility tests.
- [ ] Focus/ARIA/dismissal lifecycle tests.
- [ ] Consumer action/keyboard updates.
- [ ] Focused and package-wide Vitest run.

## Success criteria

Tests fail if a consumer loses Radix portal wiring, keyboard invocation, focus return, disabled semantics, or one-open-menu behavior; no tests depend on obsolete hard-coded dimensions.

## Risk assessment

- JSDOM may not expose Radix Popper CSS variables or layout: assert attributes/portal and leave exact rects to Chromium.
- Radix event timing can differ under StrictMode: assert cleanup and callback idempotence.

## Security considerations

Tests must preserve current context-menu suppression and avoid exposing filesystem/git action data beyond inert labels.

## Next steps

Use the passing Radix wrapper and compatibility tests to build the real Chromium fixture in Phase 04.

## Unresolved questions

- Confirm the selected Radix version exposes the required item types and controlled-root behavior before migration.
