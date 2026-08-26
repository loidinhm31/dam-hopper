# Radix lifecycle and test surface research

## Scope

Explorer `FileTree` and local branches in `GitBranchControl`; no broad consumer migration.

## Findings

1. `ContextMenu.Trigger` in `packages/ui/src/components/ui/ContextMenu.tsx` always uses `asChild`, adds keyboard dispatch, and forwards refs. `NodeRenderer` also forwards refs and DOM props. A direct tree trigger is feasible only while opening does not force its virtual row to remount.
2. `FileTree` currently calls `setMenu({ node })` from both `onNodeContextMenu` and `TreeContextMenu.onOpen`. Every action callback reads that parent state. This couples pointer opening to a parent rerender of the virtualized `Tree`; remove this open-path dependency by binding the row node into the action callbacks.
3. `GitBranchControl` already intentionally lifts `GitBranchContextMenu` outside Radix Select. Its `onPointerUp` right-button fallback existed before commit `2a014b0` and was removed; the current contextmenu-only handoff can lose to Select dismissal/unmount timing.
4. The shared architecture invariant explicitly allows this branch exception. A global menu store, custom positioner, or Select replacement is unnecessary.
5. Existing shared/browser tests cover plain triggers and viewport geometry, not a real Arborist + FileTree lifecycle or a local `SelectItem` right-click handoff. New integration tests must cover those seams.

## External guidance

- [Radix Context Menu](https://www.radix-ui.com/primitives/docs/components/context-menu): Trigger wraps the target; Root supports controlled state; Portal defaults to body; Radix owns collision, focus, keyboard navigation, dismissal, and long press.
- [Radix Select](https://www.radix-ui.com/primitives/docs/components/select): Select controls focus/navigation of its items and portals content. Treating an item as an independently persistent overlay owner is unsafe when Select closes.

## Recommendation

- Explorer: keep a direct, native Radix trigger around the ref-forwarding row. Make menu actions target-bound rather than parent-menu-state-bound.
- Branch: retain the controlled/lifted Radix presenter; restore the old right-button `pointerup` handoff and verify it does not select/checkout the branch.
- Do not extract a generic lifted presenter unless branch and diagnostics share exactly the same lifecycle/focus contract after the regression tests exist.

## Unresolved questions

- Touch long-press is best-effort. Verify manually without changing tree drag semantics.
