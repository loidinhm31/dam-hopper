# Phase 01 — Stabilize Explorer tree trigger ownership

## Context links

- Parent: [plan](./plan.md)
- [Brainstorm](../reports/brainstorm-260718-0819-context-menu-radix-trigger-refactor.md)
- [Research](./research/researcher-01-radix-lifecycle-and-test-surface.md)
- Architecture: [Context-menu placement invariant](../../docs/system-architecture.md)

## Overview

- Date: 2026-07-18
- Priority: P1
- Implementation status: Done
- Review status: Approved
- Completed: 2026-07-18 10:25:14 +0700
- Description: keep the native Radix trigger on the Arborist row stable by removing FileTree parent menu state from the opening path.

## Key insights

- `NodeRenderer` is already a ref-forwarding, DOM-prop-forwarding leaf suitable for the shared `asChild` trigger.
- `setMenu` is needed only because actions look up the active node after opening. That state update can recreate virtual tree children while the menu is opening.

## Requirements

- Right-click a file or directory row opens its Radix menu at the pointer.
- `ContextMenu` and `Shift+F10` work on the focused tree row.
- All existing actions retain exact target, disabled state, dialog/upload/download behavior, and error handling.
- Preserve Arborist drag ref, row style, selection, activation, and Git decoration behavior.

## Architecture

`TreeContextMenu` remains the Radix Root/Trigger/Portal/Content owner. Each rendered row supplies callbacks closed over `props.node.data`; those callbacks mutate parent state only after a user selects an action. Opening must not call `setMenu` or any equivalent FileTree state setter.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx` — remove open-path `ContextMenuState`; pass node-targeted action closures per row; simplify node context event plumbing.
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TreeContextMenu.tsx` only if handler signatures need target arguments; preserve its pure item builder.
- Modify/create tests in `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/` for real tree trigger lifecycle.

## Implementation steps

1. Trace every `menu.node` action consumer: copy paths, new item, rename, delete, download, and upload.
2. Refactor each action to accept an `FsArborNode` target (or bind it in a per-row closure) instead of reading open-state selection.
3. Remove `ContextMenuState`, `menu`, and `setMenu` from the menu-open/close path; retain independent dialog, rename, upload, toast, and operation-error state.
4. Remove `onOpen`/`onClose` and `onNodeContextMenu` plumbing that only writes parent menu state. Do not remove the DOM `onContextMenu` forwarding Radix needs.
5. Confirm the same leaf DOM element receives Arborist drag ref, Radix ref/event props, class/style, and no wrapper element is introduced.
6. Add a focused test that opens a menu on a virtualized row, confirms it stays mounted, and invokes an action against that row’s id.

## Todo list

- [x] Decouple tree actions from open-state node storage.
- [x] Preserve direct `asChild` row trigger/ref composition.
- [x] Test file and directory action targeting.
- [x] Test keyboard invocation and dismissal.

## Success criteria

- No parent menu-state update occurs when merely opening/closing a tree context menu.
- Menu remains visible through the initial render and actions receive the originating node.
- Tree drag/drop and activation regression tests stay green.

## Risk assessment

- Ref/action composition can break Arborist drag or Radix events. Mitigate with an actual ref-forwarding row test, not a plain button fixture.
- Target-bound callbacks may become stale after file refresh. Use the node snapshot only for initiating the existing operation; preserve current failure feedback.

## Security considerations

No new backend capability. Preserve existing server-side filesystem sandboxing; do not derive unchecked paths outside existing operation helpers.

## Next steps

Complete Phase 02 before broad validation because Git branch has a separate Select lifecycle.
