# Phase 02 — Add touch regression coverage

## Context links
- Parent: [plan.md](./plan.md)
- Contract: `plans/reports/preflight-260812-0151-touch-long-press-right-click.md`
- Browser candidates: `packages/ui/browser-tests/consumer-context-menu.browser.tsx`, `global-native-context-menu-suppression.browser.tsx`, `viewport-context-menu.browser.tsx`
- Unit candidates only if needed: `packages/ui/src/components/ui/ContextMenu.test.tsx`, `ContextMenuCompatibility.test.tsx`, `packages/ui/src/components/organisms/ContextMenuConsumers.test.tsx`
- Architecture: `docs/system-architecture.md` §Context-menu placement invariant

## Overview
- **Date:** 2026-08-12
- **Description:** Prove one correct menu open, cancellation, targeting, and regression behavior for Explorer rows and editor tabs in Chromium.
- **Priority:** P2
- **Implementation status:** Completed 2026-08-12
- **Review status:** Approved — overall review 8.5/10; no blockers

## Key Insights
- Browser coverage is the authoritative boundary for Radix timing, portal geometry, focus, and consumer behavior; JSDOM cannot certify native touch event ordering.
- Existing browser config is Chromium-only. Synthetic pointer sequences exercise the app timer but are untrusted and do not prove a browser/OS-generated `contextmenu`.
- Editor scope is tabs only. Monaco text, Markdown/image/video preview, caret/selection, and preview actions remain explicitly untested and out of scope.

## Requirements
- Explorer file and folder holds open their existing distinct menus once and invoke the correct originating-row action once.
- Editor-tab hold opens Close/Close Other Tabs/Close All once and acts on the held tab, not the active or another tab.
- Hold movement, pointer-up, pointer-cancel, scroll, drag initiation, and unmount do not open a menu; a later native `contextmenu` cannot duplicate an open.
- Retain desktop mouse right-click, keyboard ContextMenu/Shift+F10, one-open coordination, portal/body placement, Radix focus, Escape/outside/scroll dismissal, and disabled/unmarked suppression.

## Architecture
Use the existing marked Radix trigger and menu action model. A test hold sends one primary touch/pen pointer sequence to the real Explorer row or tab, waits beyond 700 ms, then releases; no test helper or runtime adapter may introduce a second timer. A native-event/dedup test may dispatch the browser fallback after the hold, but must assert one menu/action.

## Related code files
- **Modify tests:** `packages/ui/browser-tests/consumer-context-menu.browser.tsx` for production Explorer and editor-tab fixtures; keep suppression and viewport suites as regression commands.
- **Conditional unit updates:** `packages/ui/src/components/ui/ContextMenu.test.tsx` or `ContextMenuCompatibility.test.tsx` only when browser coverage cannot isolate a proven shared defect.
- **Do not modify for coverage:** `packages/ui/src/components/ui/ContextMenu.tsx`, `FileTree.tsx`, `EditorTabs.tsx`, `EditorTab.tsx`, and menu action files unless Phase 01 proves a defect.

## Implementation Steps
1. Extend the existing Chromium consumer fixture (or add one narrowly named editor-tab browser fixture only if production mounting cannot be isolated) with real row/tab targets and action spies.
2. Hold an Explorer file and folder for at least 700 ms; assert one body-ported menu, correct menu labels, target-specific callback, and one callback after selecting an item.
3. Hold two editor tabs independently; assert the held tab's existing menu and Close/Close Other/Close All target, with one menu and one action.
4. Add cancellation cases for movement before 700 ms, pointer-up, pointer-cancel, scroll/drag, and unmount; assert no menu and no action.
5. Exercise marker/suppression, native fallback deduplication, Escape/outside/scroll close, mouse right-click, and keyboard invocation without changing production handlers.
6. If a failure is shared-runtime behavior rather than harness timing, first add the smallest unit regression, then make only the minimal source fix permitted by Phase 01.

## Todo list
- [x] Use one pointer id and primary touch/pen input per hold.
- [x] Assert `data-dam-hopper-context-menu-trigger` on configured real DOM targets.
- [x] Assert menu count is one and callbacks are exactly once.
- [x] Keep Monaco/preview out-of-scope assertions/documentation explicit.
- [x] Record synthetic-versus-native event coverage honestly; Chromium pointer sequences exercise app timing, not OS-native long-press ordering.

## Completion evidence — 2026-08-12
- Focused Chromium suites passed **17/17**; full UI unit tests passed **992/992**; serial full browser passed **120/120**.
- Coverage includes file/folder rows, real editor tabs, held-target actions, touch and pen, movement from `(120,120)` to `(240,240)`, pointer-up/cancel, scroll/drag, unmount, nested Git/close controls, native-fallback deduplication, mouse right-click, keyboard ContextMenu/Shift+F10, marker/suppression, portal, focus restoration, and dismissal.
- Parallel browser failures varied **117–119/120** and were confined to existing image/video readiness (`naturalWidth`/`readyState`) races; isolated media and serial runs passed. No deterministic touch failure or state leak was found.
- No Monaco, preview, new command, global listener, global timer, gesture dependency, or global `touch-action` was added.

## Success Criteria
- Focused Chromium tests cover Explorer row and editor-tab hold/open/cancel/target behavior.
- Existing mouse, keyboard, focus, dismissal, portal, and suppression tests remain green.
- No duplicate gesture implementation or dependency is added.

## Risk Assessment
- **High:** test may pass with untrusted synthetic events while a UA emits a competing native event; mitigation: fallback/dedup assertion plus physical follow-up.
- **Medium:** timing flake near 700 ms; mitigation: wait with margin, avoid fake timers in browser tests, and keep deterministic cancellation waits.
- **Medium:** virtualized rows or tab rerenders lose target; mitigation: assert direct DOM target and callback identity before/after hold.

## Security Considerations
Keep unmarked elements suppressed and configured triggers marked. Do not stop propagation globally or prevent pointer-down/move defaults solely for tests. No credentials, auth state, API payload, or user file content enters the fixture.

## Next steps
Regression phase complete. Phase 03 recorded the command matrix and retained physical Android Chrome/iOS Safari validation as a follow-up; the known parallel media flake remains documented rather than masked.

## Unresolved questions
- Which physical Android Chrome/iOS Safari versions are release blockers, and how does each order native `contextmenu`, pointer cancellation, and callouts?
- Should long-press on an unselected Explorer row preserve current selection or select before opening?
