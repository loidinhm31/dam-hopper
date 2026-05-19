# Phase 04: Advanced Terminal Docking

## Context Links

- Overview: [./plan.md](./plan.md)
- Current layout hook: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/hooks/useTerminalLayout.ts`
- Current split layout: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/SplitLayout.tsx`
- Current pane host: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/PaneContainer.tsx`
- Current tab bar: `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/TabBar.tsx`

## Overview

Priority: P1  
Status: Pending  
Goal: make terminal split drag/drop feel like useful docking, not hidden edge zones.

## Key Insights

- Existing drag/drop supports dragging terminal tabs to pane center or edges.
- Current UX problem: invisible zones, weak previews, no tab reorder, and docking intent is hard to predict.
- Existing binary split tree is sufficient for v1 advanced docking.
- Keep terminal lifecycle untouched. Docking should only move session IDs and active pane state.

## Requirements

- Dock previews:
  - center = move tab here
  - left/right = split horizontally
  - top/bottom = split vertically
  - insertion between tabs = reorder/insert tab
- Drop labels should be readable during drag.
- Drag overlay should include terminal label and source pane context.
- Empty panes should accept drops and show actions.
- Docking operation must be atomic from UI state perspective:
  - remove from source
  - insert/move into target
  - split when needed
  - close source if empty and not root-only
  - focus target pane
  - activate dropped session
- Persist layout after docking.
- Fit affected terminals after state settles.

## Architecture

Refactor layout state updates toward intent-based actions:

```ts
type DockTarget =
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; edge: "top" | "bottom" | "left" | "right" }
  | { kind: "tab-index"; paneId: string; index: number };
```

Add `dockSession(sessionId, sourcePaneId, target)` to `useTerminalLayout`.

Implement helper behavior in pure functions where possible:

- `removeSessionFromPane`
- `insertSessionIntoPane`
- `moveSessionToIndex`
- `splitPaneWithSession`
- `collapseEmptySourcePane`

Keep dnd-kit collision detection but improve target IDs and overlays:

- `pane:{paneId}:center`
- `pane:{paneId}:edge:{edge}`
- `tabs:{paneId}:index:{index}`

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/types/terminal-layout.ts`: add docking target types if shared.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/hooks/useTerminalLayout.ts`: add atomic docking actions and tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/SplitLayout.tsx`: parse docking targets and delegate to layout action.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/PaneContainer.tsx`: replace simple drop strips with labeled preview zones.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/TabBar.tsx`: add insertion droppables and stronger drag handle affordance.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/web/src/components/organisms/terminal-dock-preview.tsx` if preview rendering exceeds roughly 80 lines.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/web/src/lib/terminal-layout-docking.test.ts` or hook-level tests if pure helpers are extracted.

## Implementation Steps

1. Extract pure layout helpers from `useTerminalLayout.ts` as needed for testing.
2. Add insert/reorder support:
   - prevent duplicates in target pane
   - preserve order when moving within same pane
   - set dropped session active
3. Add `dockSession()` with center, edge, and tab-index target support.
4. Update `SplitLayout.handleDragEnd()` to parse new target IDs and call `dockSession()`.
5. Replace `PaneDropZones` visual behavior:
   - show full-pane overlay only while dragging
   - show five labeled zones
   - highlight current zone with strong border/fill
6. Add tab insertion droppables in `TabBar`:
   - before first tab
   - between tabs
   - after last tab
7. Update drag overlay:
   - include terminal label
   - include hint like "Drop to dock terminal"
8. Fit all terminals after docking with existing registry loop.
9. Add layout tests for:
   - move to center
   - split left/right/top/bottom
   - reorder in same pane
   - move to tab index in another pane
   - close empty source pane
   - keep empty target pane usable

## Todo List

- [ ] Add docking target model.
- [ ] Add atomic `dockSession()` action.
- [ ] Add tab insertion targets.
- [ ] Add labeled pane docking previews.
- [ ] Add layout helper tests.
- [ ] Verify fit/focus after docking.

## Success Criteria

- User can predict drop result before releasing pointer.
- Dragging to edges creates correct split.
- Dragging to center moves tab into pane.
- Dragging within tab bar reorders tabs.
- Dragging to another tab bar inserts at selected position.
- Source pane closes only when it becomes empty and safe to collapse.
- Empty panes remain useful as drop/new-terminal targets.

## Risk Assessment

- Complex DnD can regress terminal input pointer behavior. Mitigation: overlays only enable pointer events while dragging.
- Binary split trees can produce surprising order when splitting "left" vs "right". Mitigation: define child order explicitly in helper tests.
- Reparented xterm elements are sensitive to remounts. Mitigation: do not touch `TerminalPanel` lifecycle.

## Security Considerations

- No backend or command execution changes.
- DnD only rearranges existing in-memory/localStorage layout metadata.

## Next Steps

Phase 05 verifies behavior and updates docs.
