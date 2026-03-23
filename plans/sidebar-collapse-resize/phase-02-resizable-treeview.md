# Phase 02 -- Resizable Terminal TreeView

> Parent: [plan.md](./plan.md)
> Dependencies: None (independent of Phase 01)
> Docs: [codebase-summary](../../docs/codebase-summary.md)

## Overview

- **Date**: 2026-03-24
- **Description**: Add draggable resize handle on right edge of terminal tree panel. Custom hook, no external deps.
- **Priority**: P2
- **Implementation status**: done (2026-03-24)
- **Review status**: done (2026-03-24)

## Key Insights

- Tree panel currently `w-56` (224px) with `shrink-0` in `TerminalsPage.tsx`
- Content area is `flex-1` -- auto-adjusts when tree width changes
- xterm `ResizeObserver` → `fitAddon.fit()` already in `TerminalPanel.tsx` -- will auto-refit
- No resize library in deps -- implement from scratch with mouse events

## Requirements

1. Draggable vertical resize handle between tree panel and content
2. Min: 160px, Max: 400px, Default: 224px
3. Handle: 4px hit area, 2px visual line on hover (primary color, 50% opacity)
4. During drag: `cursor-col-resize` + `select-none` on body
5. Persist width to localStorage

## Architecture

```
TerminalsPage
  ├── Sidebar (collapsed/expanded)
  ├── TreePanel div (style={{ width }})
  │   └── TerminalTreeView
  ├── ResizeHandle div (4px, cursor: col-resize)  ← NEW
  └── ContentArea (flex-1)
```

```
useResizeHandle(options) → { width, handleProps, isDragging }
  - mousedown on handle → track startX, startWidth
  - document mousemove → clamp(startWidth + deltaX, min, max)
  - document mouseup → cleanup, persist to localStorage
```

## Related Code Files

- `packages/web/src/pages/TerminalsPage.tsx` -- tree panel container (line ~223)
- `packages/web/src/hooks/useResizeHandle.ts` -- NEW
- `packages/web/src/components/organisms/TerminalPanel.tsx` -- ResizeObserver (auto-handles)

## Implementation Steps

### 1. Create useResizeHandle.ts

```typescript
interface UseResizeHandleOptions {
  min: number;
  max: number;
  defaultWidth: number;
  storageKey?: string;
}

interface UseResizeHandleReturn {
  width: number;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
  isDragging: boolean;
}
```

- `useState` for width, init from `localStorage.getItem(storageKey)` or `defaultWidth`
- `useRef` for `startX` and `startWidth`
- `onMouseDown`: record refs, add document listeners, add body classes
- `mousemove` handler: `newWidth = startWidth + (e.clientX - startX)`, clamp, setState
- `mouseup` handler: remove listeners, remove body classes, persist to localStorage
- `useEffect` cleanup: remove listeners on unmount
- Return `{ width, handleProps: { onMouseDown }, isDragging }`

### 2. Update TerminalsPage.tsx

- Import and call `useResizeHandle({ min: 160, max: 400, defaultWidth: 224, storageKey: "devhub:tree-width" })`
- Replace tree panel: `className="w-56 shrink-0 ..."` → `style={{ width }} className="shrink-0 ..."`
- Add resize handle div after tree panel:
  ```tsx
  <div
    {...handleProps}
    className="w-1 shrink-0 cursor-col-resize group relative hover:bg-[var(--color-primary)]/20"
  >
    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
  </div>
  ```
- When `isDragging`: add `select-none` to outermost container

## Todo

- [x] Create `useResizeHandle` hook
- [x] Integrate hook in TerminalsPage
- [x] Add resize handle element between tree and content
- [x] Verify xterm auto-refits on tree resize
- [x] Test min/max bounds
- [x] Persist width to localStorage

## Success Criteria

- Drag handle visible on hover as subtle blue line
- Smooth real-time resize during drag
- Width clamped to 160-400px range
- xterm terminals refit without flicker
- Width persists across navigation and restart

## Risk Assessment

- **Low**: Fast mouse movement could escape handle -- mitigated by document-level mousemove listener
- **Low**: Tree content may overflow at narrow widths -- `overflow-hidden` + `truncate` on tree items

## Security Considerations

None -- client-side UI only.

## Next Steps

Phase 03: Persistence & Polish
