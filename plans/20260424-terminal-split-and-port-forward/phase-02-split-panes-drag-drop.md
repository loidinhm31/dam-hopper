# Phase 02 — Split Panes Drag-to-Split

## Context Links

- Parent plan: `plans/20260424-terminal-split-and-port-forward/plan.md`
- Depends on: `phase-01-split-panes-core.md` (SplitLayout, useTerminalLayout, terminalRegistry)
- Scout: `scout/scout-01-codebase-touchpoints.md`
- Research: `research/researcher-01-split-panes.md` §5 (VS Code/Warp model), §7 risk 3

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Description | Add drag-to-split UX: drag a tab to a pane edge to create a new split. Uses `@dnd-kit/core`. Drop zones appear as highlighted edges during drag. |
| Priority | P3 (post-MVP) |
| Implementation status | pending |
| Review status | pending |
| Effort | ~6h |

## Key Insights

- VS Code + Warp both show edge drop zones during tab drag; users expect blue-highlighted edge indicators (researcher-01 §5).
- `@dnd-kit/core` is the current standard (`react-beautiful-dnd` deprecated). Edge drop zones require custom collision detection — not just sortable list logic (researcher-01 §7 risk 3).
- Tab drag must NOT call `terminal.open()` again; reparent via `terminalRegistry` + `appendChild` (Phase 01 pattern, researcher-01 §3).
- Phase 01 `useTerminalLayout.splitPane(paneId, direction)` already handles tree mutation; Phase 02 only adds the drag trigger.
- `@dnd-kit` not confirmed in `packages/web/package.json` — **must install before starting** (scout §F-14 finding).

## Requirements

### Functional
1. Drag any session tab from a `PaneContainer` tab bar.
2. During drag, all pane containers show semi-transparent edge drop zones (top/bottom/left/right, 20px wide each edge).
3. Dropping on an edge calls `useTerminalLayout.splitPane(targetPaneId, direction)` and moves the dragged session into the new sibling pane.
4. Drop on "center" of pane: move tab into that pane (no split, just tab transfer).
5. If dragged tab was the only tab in its source pane, source pane auto-closes after transfer.

### Non-Functional
- Drop zones must not interfere with mouse-based pane resize handle from `react-resizable-panels`.
- Drag must work even when `PanelResizeHandle` is nearby.

## Architecture

### @dnd-kit Setup

```typescript
// Wrap SplitLayout in DndContext:
<DndContext
  sensors={sensors}              // PointerSensor with 8px activation distance
  collisionDetection={customEdgeCollision}
  onDragEnd={handleDragEnd}
>
  <SplitLayout ... />
</DndContext>
```

### Custom Collision Detection

`customEdgeCollision(args)`: for each droppable pane container, check pointer position relative to pane bounding rect. Return:
- `"top"` / `"bottom"` if within 20px of top/bottom edge → vertical split
- `"left"` / `"right"` if within 20px of left/right edge → horizontal split
- `"center"` if pointer inside pane but not near edge → tab transfer

### Drag Item Schema

```typescript
interface DragItem {
  type: "terminal-tab";
  sessionId: string;
  sourcePaneId: string;
}
```

### Drop Result Handling (`handleDragEnd`)

```typescript
function handleDragEnd({ active, over, collision }) {
  if (!over) return;
  const { targetPaneId, edge } = over.data.current;
  const { sessionId, sourcePaneId } = active.data.current;

  if (edge === "center") {
    moveTabToPane(sessionId, sourcePaneId, targetPaneId);
  } else {
    const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical";
    splitPane(targetPaneId, direction);
    // newly created sibling pane gets sessionId
    moveTabToNewSibling(sessionId, sourcePaneId);
  }
  if (sourcePane.sessionIds.length === 0) closePane(sourcePaneId);
}
```

### File-level Changes

| File | Action | Notes |
|------|--------|-------|
| `packages/web/package.json` | Modify | Add `@dnd-kit/core`, `@dnd-kit/utilities` |
| `packages/web/src/components/organisms/SplitLayout.tsx` | Modify | Wrap in `DndContext`; add `customEdgeCollision` |
| `packages/web/src/components/organisms/PaneContainer.tsx` | Modify | Add `useDroppable` per edge zone; render `EdgeDropZone` overlays during drag |
| `packages/web/src/components/organisms/TabBar.tsx` | Create | Extract tab bar from PaneContainer; wrap tabs in `useDraggable` |
| `packages/web/src/hooks/useTerminalLayout.ts` | Modify | Add `moveTabToPane(sessionId, fromPaneId, toPaneId)` |

## Related Code Files

- `packages/web/src/components/organisms/SplitLayout.tsx` — add `DndContext` wrapper (created in Phase 01)
- `packages/web/src/components/organisms/PaneContainer.tsx` — add `useDroppable` + `EdgeDropZone` overlays (modified in Phase 01)
- `packages/web/src/hooks/useTerminalLayout.ts` — add `moveTabToPane` (created in Phase 01)
- `packages/web/package.json:29` — add `@dnd-kit/core`, `@dnd-kit/utilities`

## Implementation Steps

1. Confirm `@dnd-kit/core` not in `package.json`; run `pnpm add @dnd-kit/core @dnd-kit/utilities`.
2. Create `packages/web/src/components/organisms/TabBar.tsx`: extract tab rendering from `PaneContainer`; wrap each tab `<div>` in `useDraggable({ id: sessionId, data: { type: "terminal-tab", sessionId, sourcePaneId } })`.
3. Add `moveTabToPane(sessionId, fromPaneId, toPaneId)` to `useTerminalLayout.ts`: remove sessionId from source pane's `sessionIds`, append to target pane's `sessionIds`, set `activeSessionId` on target.
4. Create `EdgeDropZone` component (inline in `PaneContainer.tsx`): positioned `absolute` divs at each edge (top/bottom/left/right, 20px thick); visible only when `isDragging` context is true; `useDroppable` id = `"${paneId}:top"` etc.
5. Implement `customEdgeCollision` in `SplitLayout.tsx`: pure function, returns closest edge droppable or "center" droppable.
6. Wrap `SplitLayout`'s returned JSX in `<DndContext sensors={[pointerSensor]} collisionDetection={customEdgeCollision} onDragEnd={handleDragEnd}>`.
7. Implement `handleDragEnd` in `SplitLayout.tsx` as described in Architecture section.
8. After any drag ends, call `fitAddon.fit()` on all terminals in affected panes (debounced 100ms via `terminalRegistry`).
9. Manual test: drag tab to right edge → horizontal split; drag to center → tab transfer; drag last tab → source pane closes.
10. `pnpm lint && pnpm build` green.

## Todo List

- [ ] Confirm + install `@dnd-kit/core` and `@dnd-kit/utilities`
- [ ] Create `TabBar.tsx` with `useDraggable` per tab
- [ ] Add `moveTabToPane` to `useTerminalLayout.ts`
- [ ] Create `EdgeDropZone` in `PaneContainer.tsx` (`useDroppable` per edge)
- [ ] Implement `customEdgeCollision` function
- [ ] Wrap `SplitLayout` in `DndContext`
- [ ] Implement `handleDragEnd` (split + move + auto-close)
- [ ] Call `fitAddon.fit()` after drag ends
- [ ] Manual test: split, tab transfer, auto-close
- [ ] `pnpm lint && pnpm build` green

## Success Criteria

- Drag tab to pane edge → blue edge highlight appears; drop → new split created with dragged session
- Drag tab to pane center → tab moves to that pane; no split
- Dragging last tab from a pane → source pane auto-closes after drop
- Panel resize handles from `react-resizable-panels` still function normally
- `fitAddon.fit()` called after drag completes; no zero-dimension terminals

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `@dnd-kit` custom collision detection complex for edge zones | Buggy drop targets | Start with simple quadrant detection (top 25% / bottom 25% etc.) before fine-tuning |
| Drag sensor activates on panel resize handle click | Accidental drag | Set 8px activation distance on `PointerSensor`; resize handles use `mouse:down` which differs |
| `terminal.element` moved to wrong container during drag animation | Flicker | Only reparent on `dragEnd`, not during drag; leave terminal in original container during flight |
| `@dnd-kit` peer dep conflicts with React 19 | Build failure | Check peer deps; `@dnd-kit/core` v6+ supports React 19 |

## Security Considerations

- Pure frontend; no server changes. No new attack surface.

## Next Steps

Phase 02 is independent post-MVP polish. After merge, split panes feature is complete. No backend unblocked by this phase.

## Unresolved Questions

1. `@dnd-kit/core` — what version? Verify React 19 compatibility before installing.
2. Should edge drop zone width be configurable (20px hardcoded now)?
3. What visual feedback during drag-over: border highlight, semi-transparent overlay, or arrow indicator?
