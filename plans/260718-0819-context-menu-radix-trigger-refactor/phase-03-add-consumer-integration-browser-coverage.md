# Phase 03 — Add consumer integration and browser regression coverage

## Context links

- Parent: [plan](./plan.md)
- Existing wrapper coverage: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenu.test.tsx`
- Existing geometry suite: `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/viewport-context-menu.browser.tsx`
- Architecture test boundary: [docs/system-architecture.md](../../docs/system-architecture.md)

## Overview

- Date: 2026-07-18
- Priority: P1
- Implementation status: Done
- Review status: Approved 2026-07-18 13:43:29 +0700
- Description: close the coverage gap with tests that exercise the Arborist-row and Radix-Select lifecycles that plain trigger fixtures missed.

## Key insights

- Wrapper tests already prove portal/collision/keyboard behavior generically.
- The regression happened at consumer ownership boundaries, so unit fixtures containing plain buttons/divs are insufficient.

## Requirements

- Tests use the actual `FileTree`/Arborist row composition or the smallest fixture that imports the production row/menu wiring—not a plain trigger substitute.
- Tests render real `GitBranchControl` + `SelectItem` interaction with mocked data/mutations only at network boundaries.
- Browser coverage retains body-portal, edge collision, filtered overflow, keyboard focus/navigation, and action/dismissal checks.
- Touch long press gets a manual best-effort smoke note; headless Linux cannot validate the gesture, so no deterministic mobile gesture test or drag policy change.

## Architecture

Keep testing layers separate:

1. JSDOM: target/action state, event ordering, disabled state, one-menu coordination.
2. Chromium: rendered portal geometry, focus, collision, actual pointer coordinates.
3. Manual touch smoke: confirm long press does not introduce an obvious regression when a touch-capable desktop is available; do not encode platform-specific timing or rely on headless Linux.

## Related code files

- Modify/create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/*ContextMenu*.test.tsx` — tree and branch consumer integration.
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenuCompatibility.test.tsx` only to remove/augment insufficient compatibility spikes.
- Modify/create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/*context-menu*.browser.tsx` — production-composition fixture or dedicated tree/branch browser fixtures.
- Validate: `/mnt/data/ws/sharing/dam-hopper/packages/ui/package.json` scripts and existing `viewport-context-menu.browser.tsx`.

## Implementation steps

1. Add an Explorer integration harness with real production `TreeContextMenu` and ref/event forwarding; mock filesystem query/mutations only as required to mount FileTree deterministically.
2. Assert right-click selects no unrelated node, menu stays mounted after opening, and representative file/directory actions use the originating id.
3. Render `GitBranchControl` with real Select primitives and mock Git hooks; drive pointer-down/up/contextmenu and keyboard interactions.
4. Assert no `onValueChange`/checkout on right-click, single menu visibility, checked-out delete disabled, and close/action behavior.
5. Extend Chromium tests to hit the two production compositions where feasible; otherwise keep the wrapper geometry fixture and document why JSDOM owns lifecycle coverage.
6. Run focused Vitest, browser suite, UI type/build checks, and lint. Report unrelated pre-existing failures separately.
7. Manually smoke-test touch long-press against a real tree/Select if a touch-capable environment is available; record outcome without changing drag semantics.

## Todo list

- [x] Add real tree lifecycle integration coverage.
- [x] Add real Select-item handoff coverage.
- [x] Extend/retain Chromium portal geometry and focus coverage.
- [x] Run focused and package validation commands.
- [x] Record manual touch-smoke result or environment limitation.

## Validation

- Production `FileTree` / Arborist coverage: verified against the real consumer row composition, not a plain trigger substitute.
- Production `GitBranchControl` / `SelectItem` coverage: verified through the real Select ownership path with mocked data and mutation boundaries only.
- Shared context-menu dynamic positioning fix: covered in the consumer integration and Chromium geometry checks.
- Focused tests/build results: passed for the targeted consumer and browser validation set used for this phase.
- Touch long-press: not run; environment is headless Linux, so the gesture cannot be validated deterministically here.
- Coverage boundary: consumer integration is the regression guard; Chromium keeps the browser geometry/focus path honest.

## Success criteria

- Tests fail against the known regressions and pass after Phases 01–02.
- No test relies exclusively on a plain button/div trigger to represent the two consumers.
- Browser suite verifies menus remain body-portaled and within viewport at edges/zoom.

## Risk assessment

- Arborist/Select can require browser-only layout APIs in JSDOM. Add narrow environment shims or a browser fixture; do not mock away the trigger lifecycle.
- Browser automation may not expose long-press reliably, and the headless Linux CI path has no touch surface. Keep it manual best-effort rather than introducing timing-sensitive tests.

## Security considerations

Use inert action callbacks and mocked mutation boundaries. Do not run destructive filesystem/Git actions in browser tests.

## Next steps

Request code review after implementation, compare the diff to the architecture invariant, and update the invariant only for intentional drift.
