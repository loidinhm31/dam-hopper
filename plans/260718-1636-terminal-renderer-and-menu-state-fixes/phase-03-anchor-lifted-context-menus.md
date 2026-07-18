# Phase 03 — Anchor lifted context menus through triggers

## Context links

- Parent: [plan](./plan.md)
- Source: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchContextMenu.tsx`
- Source: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.tsx`

## Parallelization info

Independent. May run with Phases 01 and 02. Phase 04 waits for it.

## Overview

- Priority: P2
- Status: Pending
- Review: Pending
- Goal: prevent Radix opening a menu before it receives the synthetic trigger event and coordinates.

## Key insights

Both presenters mount `open=true`, then dispatch `contextmenu` in an effect. The event itself already provides the intended opening mechanism.

## Requirements

- Preserve branch Select handoff and terminal diagnostics export behavior.
- Preserve close callback, focus restoration, shared menu coordination, and coordinates.
- Add regression tests at the presenter boundary.

## Architecture

Each presenter remains controlled, but initializes closed. Its existing synthetic event invokes `onOpenChange(true)` and supplies the pointer anchor. The shared ContextMenu primitive remains unchanged.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchContextMenu.tsx`
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/GitBranchContextMenu.test.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.tsx`
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.test.tsx`

## File ownership

Exclusive to this phase: all four related files above.

## Implementation steps

1. Initialize both presenter open states as false.
2. Retain the existing event effect and controlled close path.
3. Test synthetic opening, dismissal, and the absence of the pre-interaction warning.
4. Retain the existing GitBranchControl integration test as compatibility coverage without editing it.

## Todo list

- [ ] Start menus closed.
- [ ] Add presenter regression coverage.

## Success criteria

- Menus open at supplied coordinates after trigger processing.
- No top-left pre-interaction warning.
- Branch actions and terminal diagnostics dismissal still work.

## Conflict prevention

Do not modify shared ContextMenu or GitBranchControl; their files belong to other phases.

## Risk assessment

Low. If synthetic events fail under a browser variant, the menu remains closed; focused browser validation catches that.

## Security considerations

No security boundary changes.

## Next steps

Run Phase 04 after all parallel phases complete.
