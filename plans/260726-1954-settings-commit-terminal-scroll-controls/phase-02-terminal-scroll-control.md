# Phase 02 — Terminal scroll control

## Context links

- [Plan](plan.md)
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`

## Overview

Date: 2026-07-26 · Priority: medium · Status: completed 2026-07-26

## Key insights

The setting and scroll-step preference already persist server-side. The viewport host supplies the mobile bottom offset. Existing `onMouseDown` prevention protects terminal focus and must be retained.

## Requirements

- Replace four persistent circles with one low-profile bottom-right navigation trigger and expanding vertical rail.
- Retain top, up-by-step, down-by-step, and bottom operations; rail stays open after an action.
- Close on trigger, Escape, or outside pointer. Use lucide icons, 40px targets, explicit names, visible focus styles, and no new preference.
- Preserve `TerminalRuntimeOutput` positioning and coarse-pointer/mobile accessory behavior.

## Architecture

Keep state local to `TerminalScrollButtons`. Reuse one guarded action helper to retain event prevention and terminal lookup. Use a document-level close listener only while open and clean it up; restore focus behavior without stealing xterm focus.

## Related code files

- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
- `packages/ui/src/components/organisms/TerminalScrollButtons.test.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` (verify no functional change)
- existing browser test setup/config

## Implementation steps

1. Add local disclosure state, trigger, grouped rail, icons, and motion limited to existing styling primitives.
2. Preserve action callbacks and mouse-down focus prevention.
3. Implement Escape/outside-pointer close with cleanup and accessible expanded state.
4. Update unit tests for actions, state, labels, and focus protection; add a browser regression for keyboard/outside close and compact overlap.

## Todo list

- [x] Implement expandable pill/rail
- [x] Preserve behavior and mobile offset
- [x] Extend unit/browser tests
- [x] Run frontend release gate

## Validation evidence

- Focused terminal scroll unit tests: 2/2 passed.
- Filtered Chromium browser regression: 3/3 passed.
- UI production build completed successfully.

## Success criteria

The collapsed control is unobtrusive; every existing scroll action still works, terminal input stays focused, and dismissal works by all three specified paths.

## Risk assessment

Low functional risk; focus, document listeners, and compact layout are the regression points.

## Security considerations

No API, input, storage, or permission change.

## Next steps

Phase 02 is complete. Proceed to Phase 03 terminal commit status.
