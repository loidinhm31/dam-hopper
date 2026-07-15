# Phase 02 — Wire Terminal Title Context Menus

## Context Links

- [Overview](./plan.md)
- [Phase 01](./phase-01-shared-session-export-controls.md)
- [Frontend component guide](../../docs/frontend-components.md)

## Overview

- **Date:** 2026-07-15
- **Priority:** P1
- **Status:** Pending
- **Goal:** route right-clicks from every individual terminal title to the shared menu in traditional and runtime modes.

## Key Insights

- Traditional titles are `DraggableTab` labels under `TabBar`; inactive tabs must export themselves without becoming active.
- Runtime titles are `RuntimeSessionLeaf` labels, including leaves nested under service groups. Compact runtime also has an active-session title header.
- Existing `EditorTabContextMenu`/`TreeContextMenu` define viewport clamping, outside-click dismissal, Escape handling, roles, and CSS tokens.
- Context-menu logic must not interfere with drag, select, close, split, or terminal focus behavior.

## Requirements

- Right-click a traditional terminal tab title and open `Export Diagnostics` for that exact tab.
- Right-click a runtime session leaf and open the same item for that exact leaf, including nested sessions.
- Support the compact runtime active-session title when a mouse context-menu event exists; touch long-press is a non-goal.
- Call `preventDefault()` and `stopPropagation()` so browser menus, tab selection, and drag state do not override the target.
- Menu position must use fixed coordinates clamped to the viewport; outside click and Escape close it.
- Preserve existing click, keyboard select, close, drag/reorder, split, and mobile sheet behavior.

## Architecture

```text
Traditional: MultiTerminalDisplay -> SplitLayout -> PaneContainer -> TabBar -> tab title
Runtime: ActiveTerminalRuntimeDisplay -> Navigator -> Group -> Item -> session leaf
Both: onOpenDiagnosticsMenu(sessionId, clientX, clientY) -> WorkspacePage
```

Use a narrow callback prop. Do not copy export mutation logic into the terminal trees.

## Related Code Files

### Modify — Traditional

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/SplitLayout.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TabBar.tsx`

### Modify — Runtime

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigator.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorGroup.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` — inspect only; change only if the final title hit-area belongs here.

### Create/Delete

- Create: none beyond Phase 01.
- Delete: none.

## Implementation Steps

1. Define one callback signature carrying session ID and client coordinates.
2. Pass it through `MultiTerminalDisplay`, recursive `SplitLayout`, `PaneContainer`, and `TabBar`.
3. Attach `onContextMenu` to the title/label hit area, not close/split controls or terminal canvas.
4. Pass the callback through runtime display, navigator, group, and item layers.
5. Attach it to each `RuntimeSessionLeaf`; ensure service-group child leaves report their own IDs.
6. Attach the same behavior to the compact active-session header when `activeSessionId` exists.
7. Render the single shared context menu at workspace root so mode switches or nested overflow do not clip it.

## Todo List

- [ ] Traditional inactive and active tab titles report exact IDs.
- [ ] Runtime top-level and nested leaves report exact IDs.
- [ ] Compact runtime title supports mouse context menu.
- [ ] Context menu remains above overflow/split layers.
- [ ] Drag/select/close/focus behavior is unchanged.

## Success Criteria

- Right-clicking `bash A` never exports active `bash B`.
- Both modes display one visually consistent `Export Diagnostics` menu.
- Runtime service-group children and free terminals work.
- Switching modes retains the chosen time window and leaves no stale menu.

## Risk Assessment

- **Prop-chain omissions:** one branch may silently miss the callback. Cover every recursive/render branch with tests.
- **Drag conflict:** context menu may start or end drag. Stop propagation and validate DnD interaction manually.
- **Clipping:** absolute menu inside pane overflow may be hidden. Use fixed positioning at workspace root.
- **Stale target:** session can exit while menu is open. Allow export to fail clearly or disable if target no longer resolves; never substitute another session.

## Security Considerations

- Display only the existing action label and safe session label; no output preview.
- Do not loosen auth or expose a new endpoint.
- Keep session ID internal to request scope; do not add it to analytics/logs unnecessarily.

## Next Steps

- Add interaction/request tests, visual review, and documentation correction in Phase 03.

## Unresolved Questions

- None.
