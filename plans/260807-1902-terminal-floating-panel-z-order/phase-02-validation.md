# Phase 02 — Validation

## Context Links

- Parent: [plan.md](./plan.md)
- Depends on: [Phase 01](./phase-01-implementation.md)
- Browser precedent: [terminal notification UI test](../../packages/ui/browser-tests/terminal-notification-ui.browser.tsx)
- Browser config: [vitest.browser.config.ts](../../packages/ui/vitest.browser.config.ts)

## Overview

- Date: 2026-08-07
- Priority: P2
- Description: prove real Chromium stacking/hit order and protect existing panel contracts.
- Implementation status: completed 2026-08-07 19:58 +07:00
- Review status: completed; focused gates passed, full check blocked by environment signing configuration

## Key Insights

- JSDOM can verify props/events; only Chromium should gate actual stacking and `elementFromPoint` hit order.
- Use deterministic overlap geometry and synchronous `act`; no arbitrary sleeps.
- Computed z-index proves layer values; `elementFromPoint` proves the user-visible winner.

## Requirements

- Test initial baseline, file pointer activation, tool pointer activation, and keyboard focus activation.
- Pointer test must target panel content, not only drag headers.
- Switch Git/Ports/Fleet while open; close/reopen both surfaces; activation remains valid.
- Confirm active panel stays below a `z-index:30` BrowserDebug-equivalent probe; `50` layers are therefore also safe.
- Keep existing IDE/compact tests green and run repository-appropriate checks.

## Architecture

```text
Chromium harness -> real TerminalWorkspaceShell + both panel organisms
                 -> force/measure overlap
interaction      -> React state update
computedStyle    -> 20/25 assertion
elementFromPoint -> selected panel assertion
z30 probe        -> higher-global-layer assertion
```

No mocked CSS stacking result and no timing-based polling.

## Related Code Files

- Create `packages/ui/browser-tests/terminal-floating-panels.browser.tsx` — integrated Chromium regression.
- Validate modified unit tests listed in Phase 01.
- Reference only `packages/ui/vitest.browser.config.ts` — no config edit expected.
- Reference only `packages/ui/browser-tests/terminal-notification-ui.browser.tsx` — reuse hit-test pattern; do not modify unless shared setup is truly needed.

## Implementation Steps

1. Build a minimal desktop Terminal shell harness with Files open, an active tool, focusable controls inside both contents, tool-switch controls, and close/reopen controls.
2. Clear relevant panel layout/open localStorage before each case so geometry is deterministic; mount imported stylesheet as existing browser tests do.
3. Assert both overlay roots initially compute to `20`.
4. Trigger `pointerdown` on exposed inner Files content; assert Files=`25`, Tool=`20`, then use an overlap point and `elementFromPoint` to confirm Files owns the hit.
5. Trigger inner Tool content; assert inverse values and hit owner. Focus descendants in each panel and assert the same transitions.
6. Switch active tool content (Git to Ports/Fleet) and assert tool-front ownership survives. Close/reopen active panels and assert baseline/activation can be re-established without stale ownership.
7. Place a deterministic `z-index:30` probe over the same point and assert it remains the hit target while a panel is active.
8. Run focused unit tests, the exact browser test, then package/repository checks. Record failures; do not weaken assertions or add sleeps.

## Todo List

- [x] Add Chromium harness and deterministic overlap.
- [x] Prove baseline and pointer-content activation.
- [x] Prove keyboard focus activation.
- [x] Prove tool switch and close/reopen lifecycle.
- [x] Prove z30 global layer wins.
- [x] Run unit, browser, and check commands.
- [x] Complete side-effect review.

## Success Criteria

- Regression test fails under current equal-z/DOM-order behavior and passes with Phase 01.
- Real hit testing selects the most recently activated panel and never outranks z30.
- All specified focused tests and checks exit zero without arbitrary waits.
- Existing desktop/IDE/compact expectations remain green.

## Risk Assessment

- Persisted layout can make overlap flaky: clear only feature-specific keys and measure DOM rectangles.
- Headless viewport differences: derive an actual intersection point; assert intersection exists before hit-testing.
- Direct event dispatch can bypass hit testing: use hit testing for winner assertions and dispatch only to reachable/exposed targets.
- Broad `pnpm check` may expose unrelated dirty-tree failures: report separately; still require focused feature tests to pass.

## Security Considerations

- Test fixtures contain no sensitive values, external navigation, server calls, or persisted user data.
- Cleanup localStorage and DOM after each case to prevent cross-test leakage.
- Verify z30 protection because BrowserDebug is a distinct iframe interaction/security surface.

## Preflight Contract

- Output: focus/interaction-aware panel stacking plus regression coverage.
- Acceptance: baseline roots; pointer/touch/content and keyboard focus activation; tool switch; close/reopen; desktop-only; higher layers win.
- Commands:
  - `pnpm --filter @dam-hopper/ui exec vitest run src/components/templates/TerminalWorkspaceShell.test.tsx src/components/organisms/TerminalFloatingFilePanel.test.tsx src/components/organisms/TerminalFloatingToolPanel.test.tsx src/components/pages/WorkspacePage.test.tsx`
  - `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-floating-panels.browser.tsx`
  - `pnpm check` (or package-scoped check first if iteration speed requires it)

## Side-Effect Review Checklist

- [ ] Escape still closes only intended open floating surfaces.
- [ ] Close clicks are not swallowed by activation capture.
- [ ] Header drag, resize handle, tabs, tree/editor/tool content remain interactive.
- [ ] Transparent bounds do not intercept terminal clicks.
- [ ] BrowserDebug `30`, suggestions/dialogs `50` remain above active panel `25`.
- [ ] Git/Ports/Fleet switching changes content/title without remount-driven stacking loss.
- [ ] Close/reopen clears stale owner; shell lifecycle resets state.
- [ ] IDE and compact/mobile snapshots/behavior unchanged.
- [ ] No persistence, API/server, auth, analytics, or dependency diff.

## Next Steps

After all gates pass, mark plan phases complete and hand off implementation summary with exact validation results. Architecture docs remain unchanged unless implementation reveals a new invariant.

## Unresolved Questions

Completed 2026-08-07 19:58 +07:00.

- Focused unit command: 4 files, 41/41 tests passed.
- Focused Chromium command: 1 file, 3/3 tests passed.
- `pnpm check`: web build, native build, and deb/rpm bundling completed; command failed because native release-signing setup is missing.
