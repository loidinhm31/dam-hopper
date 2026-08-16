# Phase 02 — Focused Test Coverage and Validation

## Context Links

- [Plan overview](./plan.md)
- [Phase 01](./phase-01-persistence-helper-and-host-integration.md)
- [Workspace-mode unit-test style](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/workspace-mode.test.ts)
- [Terminal persistence unit tests](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-pin-persistence.test.ts)
- [Chromium remount fixture](/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/terminal-pin-persistence.browser.tsx)
- [Browser test config](/mnt/data/ws/sharing/dam-hopper/packages/ui/vitest.browser.config.ts:310)

## Overview

- **Date:** 2026-08-16
- **Priority:** P2
- **Status:** Completed
- **Goal:** prove helper safety and actual visible global restoration with the repository's native Vitest and Chromium setup.

## Key Insights

- Unit tests can inject a minimal Storage implementation and prove validation/fail-open behavior without DOM coupling.
- Existing browser tests mount React fixtures, use `act`, clear web storage in setup/teardown, and remount to prove the global preference in Chromium.
- The smallest relevant gates are `pnpm --filter @dam-hopper/ui test -- markdown-view-mode-persistence` (or Vitest's project-equivalent targeted path), `pnpm --filter @dam-hopper/ui test:browser -- markdown-view-mode-persistence`, and `pnpm --filter @dam-hopper/ui build`.

## Requirements

- Add focused Vitest cases for supported modes, missing/invalid value default, storage-key usage, and throwing `getItem`/`setItem`.
- Add a Chromium fixture that mounts `MarkdownHost` with lightweight callbacks and verifies mode button `aria-pressed`, remount recovery for all modes, and sharing across project/workspace identities.
- Avoid testing Monaco internals; assert visible button state and expected editor/preview pane visibility only where necessary.

## Architecture

Tests remain at two seams: pure helper tests own scalar validation/error branches; browser fixture owns React initialization, click behavior, remount, cross-project/workspace sharing, and accessible selector state. Browser storage is cleared per test, so cases are independent.

## Related Code Files

- **Create:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/markdown-view-mode-persistence.test.ts`.
- **Create:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/markdown-view-mode-persistence.browser.tsx`.
- **Modify only if fixture support requires it:** `MarkdownHost.tsx`; do not add app-level integration plumbing.

## Implementation Steps

1. Build an in-memory storage fake exposing value inspection and a throwing variant; verify values round-trip as one current-version global value.
2. Parameterize valid-mode tests across Edit, Split, and Preview; verify missing/invalid values default to Split.
3. Test invalid scalar values; assert no throw and Split fallback.
4. Create a Chromium React fixture modeled on terminal pin persistence, with distinct project/workspace-like `tabKey` props and a controlled remount helper.
5. For each mode, click by accessible button name, assert selected `aria-pressed`, switch identities, remount, then assert the same global mode is visible everywhere.
6. Run targeted unit and browser commands, then the UI build. Record exact pass/fail output in the implementation handoff; do not claim a full browser reload test unless the fixture exercises localStorage across fresh page load or a manual reload is performed.

## Todo List

- [x] Add helper unit suite.
- [x] Add Chromium remount/global-sharing suite.
- [x] Assert accessible pressed state for all modes.
- [x] Run focused unit test.
- [x] Run focused Chromium test.
- [x] Run UI build and inspect diff for scope.

## Success Criteria

- Unit tests cover valid modes, invalid/missing/blocked storage, and the versioned global key.
- Chromium test proves each mode restores after component remount and a close/reopen-equivalent remount.
- Browser test verifies buttons' `aria-pressed` state, exactly one selected mode, no initial write, in-place identity switching, and cross-project/workspace sharing.
- UI package build passes; no API, store, backend, database, auth, config, or deployment files change.

## Risk Assessment

- **Browser test accidentally lazy-loads Monaco:** retain an assertion surface that does not require editor initialization, or mock only the host boundary using established project practice.
- **False reload confidence:** remount and in-place rerender prove the component lifecycle; the helper's localStorage load path is covered, but no full-page reload claim is made by the automated browser test.
- **Flakiness:** use accessible selectors and React `act`; no arbitrary waits.

## Security Considerations

- Test fixtures must use synthetic identities and content only. Clear the exact new localStorage key before/after every case.
- Do not expose persisted mode values in logs or snapshots beyond test assertions.

## Next Steps

After validation, review the diff against the Phase 01 boundary and hand off for normal code review. No follow-on work is required.
