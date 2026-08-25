# Phase 02 — Interaction and Responsive Tests

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-compact-selector-and-header.md)
- [Shell unit tests](../../packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx)
- [Workspace unit tests](../../packages/ui/src/components/pages/WorkspacePage.test.tsx)
- [Compact media-query tests](../../packages/ui/src/hooks/compact-workspace-media-query.test.ts)
- [Existing browser workspace test](../../packages/ui/browser-tests/workspace-page-notification-navigation.browser.tsx)
- [Browser test config](../../packages/ui/vitest.browser.config.ts)

## Overview

- **Date:** 2026-08-06
- **Description:** Prove selector behavior, accessibility, compact geometry, and desktop non-regression with project-native tests.
- **Priority:** P2
- **Implementation status:** Complete
- **Review status:** Complete

## Key Insights

- Current shell tests are SSR-oriented; keep cheap markup/state-contract checks there.
- Real Radix portal, focus, Escape, outside click, and viewport geometry belong in the existing Chromium Vitest browser runner.
- Existing workspace notification browser test already exercises desktop vs compact shell branching; preserve it as regression evidence rather than introducing another browser tool.

## Requirements

- Unit/SSR: active content, inactive `hidden`/`inert`, menu trigger contract, all surface source data, no bottom nav/companion subtitle, toolbar-actions row, empty fallback.
- Browser: initially closed; pointer and keyboard open; every production label represented/reachable (Explorer, Search, Editor, Terminal, Browser, Git, Project, Fleet, Ports); current item selected; choosing another surface updates visible content and closes; Escape and outside click dismiss without changing surface and return focus (or equivalent Radix contract assertion).
- Responsive: Chromium viewport passes at 320, 375, and 666 px; trigger/menu stay within viewport and safe corner; active content remains usable; no horizontal overflow; critical bottom controls not hidden.
- Desktop regression: at width above 1280 or through existing mocked branch test, `IdeShell`/`TerminalWorkspaceShell` remain selected and floating Panels trigger absent.
- Reduced motion: emulate preference and verify no required state depends on animation.

## Architecture

Test layers: SSR verifies deterministic markup and empty/header rules; Chromium mounts interactive shell harness with controlled active state and authentic Radix portal; existing WorkspacePage tests protect active-id fallback and shell branching. No backend fixture or PTY needed.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx` — update former bottom-tab expectations; add empty/header/toolbar contracts.
- **Create:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/mobile-workspace-shell.browser.tsx` — interaction, focus/dismiss, and viewport harness.
- **Modify only if needed:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/workspace-page-notification-navigation.browser.tsx` — explicit desktop/compact branch assertion, no notification behavior rewrite.
- **Reference/run:** `WorkspacePage.test.tsx`, `compact-workspace-media-query.test.ts`.
- **Delete:** none.

## Implementation Steps

1. Update shell SSR assertions from tab buttons/`aria-pressed`/companion copy to trigger, active label, absence of bottom nav/subtitle, hidden/inert sections, compact toolbarActions, and empty state.
2. Add a browser harness with two or more surfaces and controlled state. Query by accessible roles/names, not implementation classes.
3. Cover closed/open, current state, pointer selection, keyboard selection/typeahead, Escape, outside click, and focus return. Iterate every supplied test surface to prevent unreachable overflow items.
4. Parameterize viewport checks for 320/375/666 widths. Assert trigger/content rectangles fit viewport, no document horizontal overflow, and active content/fixture bottom control remains actionable; capture screenshots for visual review.
5. Exercise desktop branch above 1280 with the existing WorkspacePage browser pattern or retain current passing branch coverage if already explicit. Assert no compact trigger.
6. Run targeted tests during iteration; use `debugger` gate for any failure and fix root cause before broad validation.

## Todo list

- [x] SSR contracts updated
- [x] Open/closed and active-state browser coverage added
- [x] Selection, Escape, outside-click, and focus behavior covered
- [x] Empty surfaces and optional toolbar covered
- [x] 320/375/666 layout evidence captured
- [x] Desktop branch regression passes

## Success Criteria

- Tests fail against old bottom-grid UI and pass against selected floating-menu behavior.
- No flaky timing/screenshot-only assertions; semantics and geometry are deterministic.
- Existing compact fallback and notification navigation regressions remain green.

## Risk Assessment

- **Portal queries:** use browser document roles and async state assertions.
- **Viewport flakiness:** assert bounds/overflow first; screenshots are supporting evidence, not sole gate.
- **Over-mocking:** mount real `MobileWorkspaceShell` + Select; use WorkspacePage mocks only for desktop branch ownership.

## Security Considerations

- Browser tests use synthetic labels/content only. Never ingest `/tmp` browser-debug artifact bodies or page HTML.
- No network, auth token, session, filesystem, or backend test data required.

## Next steps

- Run Phase 03 quality/side-effect gates; update the existing compact component contract if implementation is accepted.

## Completion Evidence

- Targeted SSR/unit command passed: 3 files, 21 tests.
- Targeted Chromium command passed: 2 files, 7 tests, including compact interaction/responsive coverage and desktop notification-navigation regression.
- No visual snapshots or accessibility snapshots claimed; assertions are semantic/interaction/geometry checks.

## Unresolved Questions

- None beyond the parent plan's panel-scope assumption.
