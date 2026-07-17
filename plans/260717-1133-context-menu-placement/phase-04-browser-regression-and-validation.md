# Phase 04 — Browser regression and validation

## Context links

- Parent: [plan.md](./plan.md)
- Browser config: `packages/ui/vitest.browser.config.ts:14-21`
- Existing browser test shape: `packages/ui/browser-tests/terminal-notification-ui.browser.tsx:27-48,86-139`
- Architecture invariant: `docs/system-architecture.md`

## Overview

- Priority: P2
- Status: Pending
- Effort: 3.5h
- Description: verify Radix's real portal, collision, containing-block escape, and release acceptance across viewport edges and zoom.
- Review status: Not started

## Key insights

Pure tests cannot detect `backdrop-filter` creating a containing block. A Chromium fixture with an offset filtered panel is required.

## Requirements

- Add a browser test auto-discovered by the existing UI browser configuration.
- Fixture includes absolute offset panel, `overflow: hidden`, and non-none `backdrop-filter`.
- Assert Radix Content is a direct body child, pointer-relative in open space, flips/shifts at right/bottom edges, stays within an 8px margin, and is not clipped by the panel.
- Assert second right-click reanchors, dynamic size repositions, action fires once, Escape/outside/scroll close, and keyboard invocation restores focus.
- Run at 80%, 100%, 125%, and 200% desktop zoom where harness supports it; use rect assertions with 1px tolerance.

## Architecture

`browser fixture → Radix ContextMenu.Trigger → Radix ContextMenu.Portal → Content collision → real CSS layout → bounding-rect assertions`. Validate Radix behavior rather than duplicating its placement algorithm.

## Related code files

Create:

- `packages/ui/browser-tests/viewport-context-menu.browser.tsx`

Modify if needed:

- `packages/ui/vitest.browser.config.ts` only if the new file is not auto-discovered.
- `docs/system-architecture.md` only if implementation reveals an invariant change.

Delete: none.

## Implementation steps

1. Build a minimal fixture using the shared Radix wrapper, not production panels, to isolate CSS behavior.
2. Add center/open-space and corner collision assertions.
3. Add filtered overflow ancestor assertion that would fail with inline fixed placement.
4. Add focus/dismissal/reanchor/resize checks.
5. Run `pnpm --filter @dam-hopper/ui test:browser`, package unit tests, lint, and type-check; record failures as blockers rather than weakening assertions.

## Todo list

- [ ] Radix body portal and clipping assertion.
- [ ] Four-edge collision cases.
- [ ] Dynamic-size/reanchor behavior.
- [ ] Keyboard/focus/dismissal behavior.
- [ ] Zoom matrix and full validation commands.

## Success criteria

The old implementation would fail the fixture because the menu is offset/clipped; the migrated implementation passes at all required edges and interaction paths.

## Risk assessment

- Browser zoom APIs vary by runner: keep core geometry independent and mark unsupported zoom levels explicitly.
- Flaky timing from layout/observer delivery: wait for stable rect changes, never arbitrary sleeps.

## Security considerations

No network or privileged actions. Browser test must use inert menu callbacks and synthetic labels only.

## Next steps

After all checks pass, request code review, compare implementation against the architecture invariant, and update the architecture doc only for intentional drift.

## Unresolved questions

- Confirm CI availability of Chromium at all requested zoom levels before making zoom matrix a blocking release gate.
