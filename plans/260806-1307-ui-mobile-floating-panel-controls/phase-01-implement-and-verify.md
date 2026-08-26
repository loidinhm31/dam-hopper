# Phase 01 — Implement and verify mobile controls

## Context links

- [Scout report](../reports/scout-260806-1307-mobile-floating-panel-controls.md)
- [Plan overview](./plan.md)
- `docs/frontend-components.md` mobile workspace shell section

## Overview

- Date: 2026-08-06
- Priority: normal
- Status: Completed
- Completed: 2026-08-06 13:48 Asia/Ho_Chi_Minh

## Key insights

- The existing selector is already the single mobile panel menu surface; extending it avoids duplicate navigation state.
- Radix Select must remain the source of menu/focus/dismissal behavior.
- Visual compactness and touch usability are separate: reduce padding/decoration, keep the interactive hit area usable.

## Requirements

1. Add thresholded pointer dragging to the existing mobile `Panels` trigger.
2. Clamp dragged coordinates to the viewport and re-clamp on resize.
3. Preserve click, keyboard, selection, dismissal, and focus behavior.
4. Make the trigger visually tighter without dropping below the existing touch target height.
5. Make the bottom `Keys` and `Kbd`/`Type` controls non-wrapping, tightly spaced, and accessible.
6. Add browser regression assertions for the new interaction/layout contract.

## Architecture

- Keep drag state local to `MobileWorkspaceShell`; no persistence or shared state is needed.
- Use pointer capture and cleanup on pointer-up/cancel/unmount.
- Use the existing `cn` styling and Lucide icons; no new dependency or global CSS required unless a measured browser constraint makes it necessary.
- Keep the accessory bar behavior/state unchanged; adjust only its control layout and presentation.

## Related code files

- `packages/ui/src/hooks/use-mobile-panel-trigger-drag.ts`
- `packages/ui/src/lib/mobile-panel-trigger-position.ts`
- `packages/ui/src/components/templates/MobileWorkspaceShell.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
- `packages/ui/browser-tests/mobile-workspace-shell.browser.tsx`
- `packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx`

## Implementation steps

1. Add local trigger drag state and pointer lifecycle handling with a small movement threshold.
2. Control menu opening so a tap opens Radix Select while a drag only repositions the trigger.
3. Clamp position to viewport edges and recalculate it on resize; keep safe-area-aware initial placement and terminal accessory clearance.
4. Tighten trigger classes and accessory-row/button classes; keep accessible names and pressed states.
5. Extend unit/browser coverage for drag-versus-tap behavior, viewport bounds, resize, and compact controls.
6. Run focused tests, package build, and lint; fix any failures before review.

## Todo

- [x] Implement trigger drag interaction.
- [x] Compact trigger and accessory controls.
- [x] Add/update focused tests.
- [x] Run validation commands.
- [x] Review changed diff for unrelated edits.

## Success criteria

- A touch/mouse drag moves the floating trigger without selecting a surface.
- The trigger cannot be dragged outside the viewport and stays visible after resize.
- A normal click/tap still opens the menu and existing keyboard behavior remains intact.
- Bottom controls fit in one compact row at narrow widths and retain accessible labels/pressed states.
- `pnpm --filter @dam-hopper/ui build`, focused tests, and lint pass.

## Risk assessment

- Medium: Radix Select trigger pointer handling can conflict with drag detection.
- Medium: viewport resize and terminal accessory clearance can cause overlap if clamping uses stale dimensions.
- Low: compact styling could make labels hard to read; preserve text/ARIA labels and verify at 320px.

## Security considerations

- No external input is persisted or sent to a server.
- Pointer handlers must be cleaned up to avoid stale document listeners or retained component state.

## Next steps

Phase completed after implementation, focused validation, and 9/10 review approval on 2026-08-06.

## Preflight and side-effect checklist

- [x] Auth/session/permissions reviewed — not applicable.
- [x] API/client compatibility reviewed — unchanged.
- [x] Database/schema/data integrity reviewed — no data changes.
- [x] Business logic reviewed — no semantic changes.
- [x] Security/privacy/logging reviewed — no new exposure.
- [x] Performance/concurrency reviewed — bounded pointer work and cleanup.
- [x] Docs/config/deployment reviewed — documentation wording only if behavior text changes.
