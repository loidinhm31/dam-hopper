# Phase 01 — Split Panes Core (Tree + Persistence + Keyboard)

## Context Links

- Parent plan: `plans/20260424-terminal-split-and-port-forward/plan.md`
- Scout: `scout/scout-01-codebase-touchpoints.md`
- Research: `research/researcher-01-split-panes.md`
- Pattern refs: `packages/web/src/components/organisms/MultiTerminalDisplay.tsx`, `TerminalPanel.tsx`, `IdeShell.tsx`
- Hook ref: `packages/web/src/hooks/useTerminalManager.ts`

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Description | Implement recursive binary-tree split layout in terminal zone using `react-resizable-panels`. Keyboard shortcuts, localStorage persistence, xterm.js imperative lifecycle. No drag-drop (Phase 02). |
| Priority | P2 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~10h |

## Key Insights

- `react-resizable-panels@4.9.0` installed but **zero imports** in `packages/web/src/` (scout §F-14). Start clean — no migration.
- `terminal.open()` can be called exactly once per `Terminal` instance. Reparent via `containerEl.appendChild(terminal.element)`. Never store `Terminal` in React state (researcher-01 §3).
- `MultiTerminalDisplay` uses `display:none`/`display:flex` toggling (not unmount) for keep-alive. Split layout must preserve this pattern (scout §Key findings).
- `fitAddon.fit()` returns wrong dims if container is hidden; always call after panel becomes visible, debounced 100ms (researcher-01 §7 risk 1).
- `PanelGroup autoSaveId` persists sizes only; tree shape must be stored separately as `dam-hopper:terminal-layout` JSON (researcher-01 §4).

## Requirements

### Functional
1. `Ctrl+Shift+5` splits focused pane vertically (default); add horizontal modifier later.
2. `Alt+Left` / `Alt+Right` cycle focus between panes.
3. `Ctrl+Shift+[` / `Ctrl+Shift+]` switch tabs within focused pane.
4. Layout (tree shape + sizes) persists in `localStorage` key `dam-hopper:terminal-layout`.
5. On reload, dead `sessionIds` purged; empty panes collapsed; tree re-balanced.
6. All existing `useTerminalManager` session state and tab logic preserved.
7. Closing last tab in a pane: collapse that pane and re-balance tree.

### Non-Functional
- Zero xterm.js double-open (StrictMode guard via `openedRef`).
- `fitAddon.fit()` debounced 100ms on all resize events.
- Keyboard shortcuts intercepted via `attachCustomKeyEventHandler` (not DOM `keydown`) to prevent PTY bleedthrough.

## Architecture

### Layout Data Model

```typescript
// packages/web/src/types/terminal-layout.ts  (new file)
type SplitDirection = "horizontal" | "vertical";

interface SplitNode {
  type: "split";
  direction: SplitDirection;
  sizes: [number, number]; // percentages, sum=100
  children: [LayoutNode, LayoutNode]; // always binary
}

interface PaneNode {
  type: "pane";
  id: string;           // stable pane UUID, NOT sessionId
  sessionIds: string[];
  activeSessionId: string;
}

type LayoutNode = SplitNode | PaneNode;

interface PersistedLayout {
  version: 1;
  root: LayoutNode;
}
```

### Imperative Terminal Registry

```typescript
// packages/web/src/lib/terminal-registry.ts  (new file)
// Module-level singleton: Map<sessionId, { terminal: Terminal, fitAddon: FitAddon }>
// NOT in React state.
export const terminalRegistry = new Map<string, TerminalEntry>();
```

### Control Flow: Split Action

```
user presses Ctrl+Shift+5
  → attachCustomKeyEventHandler returns false (consume event)
  → useTerminalLayout.splitPane(focusedPaneId, "vertical")
    → insert SplitNode into tree above focused PaneNode
    → new sibling PaneNode starts empty (no active session yet)
    → tree saved to localStorage
    → React re-renders SplitLayout
      → react-resizable-panels renders new PanelGroup
      → useEffect calls fitAddon.fit() on all visible panes (debounced)
```

### Control Flow: xterm.js Reparent

```
SplitLayout renders PaneContainer for each PaneNode
  → PaneContainer holds <div ref={containerRef}>
  → useEffect: if terminal.element in registry, appendChild(terminal.element)
  → fitAddon.fit() after reparent (requestAnimationFrame + 100ms debounce)
```

### File-level Changes

| File | Action | Notes |
|------|--------|-------|
| `packages/web/src/types/terminal-layout.ts` | Create | PersistedLayout, SplitNode, PaneNode types |
| `packages/web/src/lib/terminal-registry.ts` | Create | Module-level `terminalRegistry` Map |
| `packages/web/src/hooks/useTerminalLayout.ts` | Create | Tree CRUD + localStorage persistence |
| `packages/web/src/components/organisms/SplitLayout.tsx` | Create | Recursive PanelGroup renderer |
| `packages/web/src/components/organisms/PaneContainer.tsx` | Create | Leaf pane: tabs bar + xterm container |
| `packages/web/src/components/organisms/MultiTerminalDisplay.tsx` | Modify | Replace stacked-divs with `<SplitLayout>` |
| `packages/web/src/components/organisms/TerminalPanel.tsx` | Modify | Write to `terminalRegistry` on open; read from it on reparent |
| `packages/web/src/hooks/useTerminalManager.ts` | Modify | Expose `focusedPaneId`, `setFocusedPaneId`; wire keyboard handler |

## Related Code Files

- `packages/web/src/components/organisms/MultiTerminalDisplay.tsx:1` — replace body; keep-alive toggle pattern must survive
- `packages/web/src/components/organisms/TerminalPanel.tsx:65` — `new Terminal(...)` + FitAddon instantiation; add registry write
- `packages/web/src/components/organisms/TerminalPanel.tsx:~90` — `ResizeObserver` + 200ms debounce pattern; mirror in SplitLayout
- `packages/web/src/hooks/useTerminalManager.ts:1` — `openTabs`, `activeTab`, `mountedSessions`, `MAX_MOUNTED=5`; add pane focus state
- `packages/web/src/hooks/useTerminalTree.ts:1` — read-only; no changes
- `packages/web/package.json:29` — `react-resizable-panels@4.9.0` confirmed present

## Implementation Steps

1. Create `packages/web/src/types/terminal-layout.ts` with `SplitNode`, `PaneNode`, `PersistedLayout` types.
2. Create `packages/web/src/lib/terminal-registry.ts` — module singleton `Map<string, {terminal, fitAddon}>`. Export `registerTerminal(id, t, fa)`, `getTerminal(id)`, `removeTerminal(id)`.
3. Create `packages/web/src/hooks/useTerminalLayout.ts`:
   - `loadLayout()`: `JSON.parse(localStorage.getItem("dam-hopper:terminal-layout"))`, validate `version===1`, fallback to single `PaneNode` on error.
   - `saveLayout(root)`: serialize + `localStorage.setItem`.
   - `splitPane(paneId, direction)`: find PaneNode by id, replace with SplitNode containing original + new empty PaneNode.
   - `closePane(paneId)`: remove PaneNode, collapse parent SplitNode to sibling, re-balance.
   - `updateSizes(nodeId, sizes)`: update `sizes` on matching SplitNode.
   - Expose `{ root, splitPane, closePane, updateSizes, focusedPaneId, setFocusedPaneId }`.
4. Create `packages/web/src/components/organisms/SplitLayout.tsx`:
   - Recursive renderer: if `node.type === "split"` → `<PanelGroup direction={node.direction}>` with two `<Panel>` + `<PanelResizeHandle>` children recursed.
   - If `node.type === "pane"` → `<PaneContainer node={node} />`.
   - On `PanelGroup` resize: call `updateSizes` debounced 100ms.
5. Create `packages/web/src/components/organisms/PaneContainer.tsx`:
   - Renders tabs bar (session tabs, close button).
   - Renders `<div ref={containerRef}>` as xterm host.
   - `useEffect`: for active session, check `terminalRegistry.get(sessionId)`, `containerRef.current.appendChild(terminal.element)`, `fitAddon.fit()` after `requestAnimationFrame`.
   - `attachCustomKeyEventHandler` on each terminal: handle `Ctrl+Shift+5` (split), `Alt+Left`/`Alt+Right` (pane focus), `Ctrl+Shift+[`/`]` (tab switch); return `false` to consume.
   - `onClick` on container: `setFocusedPaneId(node.id)`.
6. Modify `packages/web/src/components/organisms/TerminalPanel.tsx`:
   - After `term.open(container)`, call `registerTerminal(sessionId, term, fitAddon)`.
   - On cleanup, call `removeTerminal(sessionId)`.
   - Add `openedRef = useRef(false)` guard before `term.open()` to handle StrictMode double-invoke.
7. Modify `packages/web/src/components/organisms/MultiTerminalDisplay.tsx`:
   - Replace stacked-absolute-div body with `<SplitLayout root={root} ... />`.
   - Pass `useTerminalLayout()` output as props.
   - Keep `mountedSessions` from `useTerminalManager` for keep-alive (terminals stay mounted even if pane is hidden).
8. Modify `packages/web/src/hooks/useTerminalManager.ts`:
   - Add `focusedPaneId` / `setFocusedPaneId` state.
   - On layout restore: cross-check `sessionIds` vs live `openTabs`; prune dead ids.
9. Manually test: open 3 sessions → split → reload → layout restored → `fitAddon.fit()` called → no double-open.
10. Run `pnpm lint` and `pnpm build` — zero errors.

## Todo List

- [ ] Create `terminal-layout.ts` types
- [ ] Create `terminal-registry.ts` singleton
- [ ] Create `useTerminalLayout.ts` hook (load, save, split, close, updateSizes)
- [ ] Create `SplitLayout.tsx` recursive renderer
- [ ] Create `PaneContainer.tsx` (tabs, xterm host, keyboard handler)
- [ ] Modify `TerminalPanel.tsx` (registry write, openedRef guard)
- [ ] Modify `MultiTerminalDisplay.tsx` (replace body with SplitLayout)
- [ ] Modify `useTerminalManager.ts` (focusedPaneId, layout cross-check)
- [ ] Manual smoke test: split, reload, keyboard nav
- [ ] `pnpm lint && pnpm build` green

## Success Criteria

- `Ctrl+Shift+5` creates split pane; second pane visible side-by-side
- Layout JSON in `localStorage["dam-hopper:terminal-layout"]` reflects tree shape
- Reload restores layout; dead sessionIds pruned without crash
- `Alt+Left`/`Alt+Right` moves focus between panes; terminal receives input in focused pane
- No xterm double-open warning in console (StrictMode tested)
- `fitAddon.fit()` called after every resize; no zero-dimension flicker

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `terminal.open()` called twice in StrictMode | Broken terminal | `openedRef` guard; single-open assertion |
| Container div unmounted mid-render, `terminal.element` reference lost | Blank pane | Keep all pane containers in DOM (display:none), never unmount |
| `fitAddon.fit()` dims=0 when panel hidden | Wrong PTY window size | Only call fit after `display` is non-none; use `requestAnimationFrame` |
| Tree re-balance produces invalid state on concurrent close | Layout corruption | Immutable tree updates via functional setState; validate on load |
| `useTerminalManager` `MAX_MOUNTED=5` conflicts with many panes | Silent session loss | Keep MAX_MOUNTED logic; warn user when limit reached |

## Security Considerations

- No server-side changes; pure frontend. Layout JSON in localStorage: parse defensively (try/catch + schema validation) to prevent XSS via tampered localStorage values.

## Next Steps

Phase 01 merged → Phase 02 (drag-to-split) can begin. Phase 02 requires `@dnd-kit/core` — confirm installed before starting.

## Unresolved Questions

1. Behavior when last tab in a pane closes: auto-collapse pane or show empty state with "+" prompt?
2. `MAX_MOUNTED=5` in `useTerminalManager` — should it scale with pane count, or stay fixed?
3. Is layout per-workspace or global? Current plan: single `localStorage` key (global). Multi-workspace users may want per-workspace.
