---
title: "Radix context-menu trigger refactor: Explorer and Git branch"
status: agreed
created: 2026-07-18
scope: packages/ui
---

# Radix context-menu trigger refactor

## Problem

The completed Radix migration regressed two consumers:

- Explorer tree: a Radix root is recreated when opening updates `FileTree` parent state. The virtual row that owns the trigger can unmount before its menu remains visible.
- Git branch Select: a Select option is unmounted/dismissed while handing off right-click to its menu. Removing the `pointerup` fallback exposed that race.

Both must conform to the established Radix Context Menu foundation, retain action semantics, and avoid a new positioning system.

## Agreed scope

- In: Explorer `FileTree`/`TreeContextMenu`; Git `GitBranchControl`/`GitBranchContextMenu`; focused integration and browser coverage.
- Out: converting other already-migrated consumers; visual redesign; server/API changes; replacing Select; custom deterministic mobile gesture; changing tree drag behavior.

## Architecture decision

Use one conceptual pattern: domain target state plus shared `ContextMenu.Root`, `Trigger`, `Portal`, `Content`, and item wrappers. Radix owns placement, portal, collision avoidance, menu navigation, dismissal, and long-press behavior.

Two trigger bindings are intentionally allowed:

| Surface | Trigger binding | Why |
| --- | --- | --- |
| Explorer tree | Direct `ContextMenu.Trigger` `asChild` on the ref-forwarding `NodeRenderer` | The row can be a native Radix trigger once opening does not cause parent-owned menu state/rerender. Pass the selected node directly to item callbacks rather than storing it solely to open the menu. |
| Git branch Select | Controlled, lifted Radix presenter plus right-button `pointerup` handoff | A Select owns and dismisses its options. Closing it before a branch menu is visible unmounts a nested/direct trigger; the lifted presenter survives that lifecycle boundary. |

This is not two menu systems: both must use the same shared Radix wrapper and action/item semantics. The difference is only the lifecycle-safe way each host supplies the trigger.

## Rejected alternatives

1. One hidden synthetic presenter for both surfaces: uniform internal shape, but it weakens the native trigger path Radix intends for the virtual tree.
2. Direct nested context menu in `Select.Item`: aesthetically uniform, but vulnerable to Select dismissable-layer and unmount ordering.
3. Replace the branch Select: could enable a direct trigger, but is a disproportionate UX/accessibility rewrite for one context-menu action.

## Implementation considerations

- `TreeContextMenu` action handlers should receive the node target, or be built from it, so right-click opening does not require `FileTree` to set parent `menu` state.
- Preserve `NodeRenderer` ref composition: react-arborist drag ref, Radix trigger ref, style, selection, and existing click behavior must all reach the same row DOM element.
- Restore the Git local-branch right-button `onPointerUp` handoff alongside `onContextMenu`; deduplicate open requests so a browser firing both paths creates one menu.
- Keep current-branch deletion disabled and keep Select value changes from running during a context-menu interaction.
- Keep native browser-menu suppression local to tree rows and local branch options. Do not add a document-level suppression handler.
- Extract the repeated controlled/lifted presenter mechanics only if Git branch and terminal diagnostics can share it without flattening their domain-specific focus/close behavior. Do not introduce a global context-menu store.

## Acceptance criteria

- Explorer node right-click opens its correct file/directory actions at the pointer; actions apply to that exact node.
- Explorer keyboard `ContextMenu` and `Shift+F10` open a usable menu on the focused row; Escape/outside click/action dismissal work and focus is sensible.
- Git local branch right-click opens exactly one menu, does not checkout the branch, closes the Select, and preserves the delete guard for the checked-out branch.
- Git branch keyboard invocation opens the same actions and returns focus to the Select trigger on dismissal where browser focus permits.
- Context Menu content is body-portaled, collision-aware, and not clipped/offset by floating panel transforms, `backdrop-filter`, scrolling, or `overflow`.
- Mouse and keyboard behavior are release-blocking. Touch long-press is best-effort: manually smoke-test Radix behavior, but do not alter tree drag semantics or block desktop release.
- Add real integration coverage using react-arborist and Radix Select, not only plain-element trigger doubles; retain viewport/collision browser coverage.

## Evidence and touchpoints

- `packages/ui/src/components/ui/ContextMenu.tsx`: shared wrapper already forces `asChild`, body portal, collision padding, keyboard trigger support, and app-level coordination.
- `packages/ui/src/components/organisms/FileTree.tsx`: virtual node renderer and parent `menu` state/open path.
- `packages/ui/src/components/organisms/TreeContextMenu.tsx`: tree action construction and Radix content.
- `packages/ui/src/components/organisms/GitBranchControl.tsx`: Select lifecycle and local-branch event handoff.
- `packages/ui/src/components/organisms/GitBranchContextMenu.tsx`: lifted Radix presenter.
- Official Radix guidance: [Context Menu](https://www.radix-ui.com/primitives/docs/components/context-menu) documents trigger, portal, collision, focus, keyboard navigation, and long-press; [Select](https://www.radix-ui.com/primitives/docs/components/select) documents Select-managed item focus and dismissal.

## Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Tree row remount closes the menu | Do not update `FileTree` parent menu state merely to identify the opened node; test with real Arborist rows. |
| Pointer-up and contextmenu double-open branch actions | Make the open transition idempotent and assert one menu in integration/browser tests. |
| Touch long-press starts a tree drag | Smoke-test on a touch-capable environment; defer interaction-policy changes rather than changing drag behavior here. |
| Synthetic presenter expands across the app | Keep it constrained to hosts whose parent primitive owns/unmounts the visible trigger. |

## Next step

Create a focused implementation plan, then implement only the agreed files and validation coverage.
