# Phase 02 — Harden Git branch Select handoff

## Context links

- Parent: [plan](./plan.md)
- [Brainstorm](../reports/brainstorm-260718-0819-context-menu-radix-trigger-refactor.md)
- Existing lifted presenter: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchContextMenu.tsx`
- Shared wrapper: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/ui/ContextMenu.tsx`

## Overview

- Date: 2026-07-18
- Priority: P1
- Implementation status: Pending
- Review status: Not started
- Description: restore the lifecycle-safe right-click handoff from a Radix Select item to the already shared, lifted Radix menu.

## Key insights

- Branch options cannot own a persistent direct menu Root because Select can dismiss/unmount them.
- The lifted `GitBranchContextMenu` is already a shared Radix Root/Portal/Content presenter and supplies Radix pointer coordinates through its local trigger.

## Requirements

- Right-clicking a local branch opens one branch menu and closes the Select.
- It must not change the selected branch or initiate checkout.
- Keyboard `ContextMenu`/`Shift+F10` keeps working.
- The checked-out branch keeps a disabled Delete action with its existing title.
- Escape/outside/action dismissal clears menu state; focus returns to the Select trigger when practical.

## Architecture

Keep `GitBranchContextMenu` lifted beside `Select`. Local `SelectItem` event handling owns a narrow right-button handoff: suppress select/default behavior on right-button down, call the shared opener on right-button up, and retain the contextmenu path as a browser fallback. Both paths set the same single `contextMenu` state; no global handler or custom coordinate system.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchControl.tsx` — restore right-button `onPointerUp`; preserve keyboard and current Select semantics.
- Modify if required: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchContextMenu.tsx` — only focus/close robustness; do not duplicate positioning logic.
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchControl.test.tsx` or a focused companion integration test.

## Implementation steps

1. Restore the pre-regression right-button `onPointerUp` handoff for local branches, with `preventDefault` and `stopPropagation` only for button 2.
2. Keep `onPointerDown` suppression and `onContextMenu` fallback scoped to local Select items; route all three paths through `openBranchContextMenu`.
3. Verify React/browser event ordering produces one mounted presenter and no `onValueChange` checkout. Add a minimal idempotence guard only if a real duplicate is observed.
4. Retain the lifted presenter’s Radix portal/content, delete guard, and close callback. Add explicit focus restoration only if the integration test proves Select does not restore focus.
5. Add tests for right-pointer sequence, contextmenu fallback, keyboard invocation, disabled current branch, Escape/outside close, and delete-action handoff.

## Todo list

- [ ] Restore right-button pointer-up handoff.
- [ ] Keep Select value untouched during context menu open.
- [ ] Verify exactly one presenter and current-branch guard.
- [ ] Cover keyboard and dismissal/focus behavior.

## Success criteria

- Local branch menu works in the actual Select lifecycle, not only as an isolated presenter.
- No right-click checkout, no native browser menu, no duplicate presenter.
- Existing branch mutation/dialog flows remain unchanged after a Delete selection.

## Risk assessment

- Browser event ordering differs across engines. Keep `onContextMenu` fallback and verify Chromium; record any non-Chromium issue instead of adding broad document listeners.
- Hidden-trigger focus restoration may target an inert element. Prefer existing Select focus behavior; add an explicit trigger ref only if proved necessary.

## Security considerations

No new Git operation or authorization path. Preserve the current-branch delete guard and existing confirmation dialog.

## Next steps

Run the Phase 03 integration/browser matrix after both lifecycle fixes exist.
