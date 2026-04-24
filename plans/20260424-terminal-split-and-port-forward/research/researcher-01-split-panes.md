# Research: Multi-Terminal Split Panes (F-14)

Date: 2026-04-24 | Model: claude-sonnet-4-6

---

## 1. Recommended Split Model

**Tree-of-panels (recursive), not fixed-grid.**

Justification: every major terminal (Warp, iTerm2, VS Code) uses a binary tree where branch nodes carry split direction and leaf nodes carry session(s); grid requires predefined dimensions and cannot express arbitrary nested splits without storing fractions per axis independently, which is harder to serialize and harder to manipulate at runtime.

Warp's published architecture (https://dev.to/warpdotdev/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds-2kon):
- `BranchNode { direction: "h"|"v", children: Node[] }` — always 2 children for binary split
- `PaneNode { id: string }` — leaf, maps to a terminal session

VS Code model: each editor/terminal group is a linear list of tabs; splits create new groups side-by-side. Groups arranged in a flat left/right or top/bottom list, NOT a recursive tree. Simpler but less flexible (can't do 3-way recursive).

**Recommendation for DamHopper:** recursive binary tree. `react-resizable-panels` nests `PanelGroup` inside `Panel` naturally — no library changes needed.

---

## 2. react-resizable-panels API (v4.x)

Source: https://github.com/bvaughn/react-resizable-panels | https://react-resizable-panels.vercel.app/

**Recursive split pattern** — embed a `PanelGroup` as the child of a `Panel`:

```tsx
<PanelGroup direction="horizontal">
  <Panel>
    {/* leaf: render terminal */}
    <XtermPane sessionId={node.sessionId} />
  </Panel>
  <PanelResizeHandle />
  <Panel>
    {/* branch: recurse */}
    <PanelGroup direction="vertical">
      ...
    </PanelGroup>
  </Panel>
</PanelGroup>
```

This is the intended usage; library does not prohibit nesting. Each `PanelGroup` manages its own resize state independently.

**Imperative API** — `PanelGroup` ref exposes `setLayout(sizes: number[])` for programmatic resize. `Panel` ref exposes `collapse()`, `expand()`, `resize(size)`. Useful for keyboard-triggered splits.

**Persistence** — `<PanelGroup autoSaveId="terminal-root">` writes `{ [autoSaveId]: { [groupId]: number[] } }` to `localStorage` automatically. BUT: this only persists *sizes*, not the tree shape. Tree shape must be persisted separately (see §4 schema).

**Conditional panels** — when panels are dynamically added/removed, supply `id` and `order` props to each `Panel` so the library can match persisted sizes correctly.

---

## 3. xterm.js Multi-Instance Lifecycle

Sources: https://xtermjs.org/docs/api/terminal/classes/terminal/ | https://github.com/xtermjs/xterm.js/issues/664

**Hosting N terminals:**
- One `Terminal` instance per PTY session. Instantiate once, keep alive for session lifetime.
- Call `terminal.open(containerElement)` exactly once to mount to DOM.
- `terminal.dispose()` tears down buffers, listeners, renderer — call only when session ends.

**fit addon + ResizeObserver pattern:**
```ts
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(containerEl);
fitAddon.fit(); // initial fit

const ro = new ResizeObserver(() => fitAddon.fit());
ro.observe(containerEl);
// cleanup: ro.disconnect() when unmounting
```
Call `fitAddon.fit()` after every DOM geometry change — panel resize, tab switch, window resize.

**Detach/reattach strategy (key finding):**
`terminal.open()` can only be called once. There is NO official `detach()` API.

The only safe pattern: **reparent the raw DOM element** (`terminal.element`) into the new container using `appendChild`. xterm.js owns the element; React must not manage it as a controlled DOM node.

```ts
// move terminal to new container after drag/split:
newContainerEl.appendChild(terminal.element!);
fitAddon.fit(); // must call after reparent
```

Use a React ref to hold the container `<div>`, and an imperative map (`Map<sessionId, Terminal>`) outside of React state to own terminal instances. Never store `Terminal` objects in React state (causes spurious re-renders and potential double-open).

**Visibility / hidden panels:** If a panel is hidden via CSS `display:none`, `fitAddon.fit()` returns wrong dimensions (0). Always call `fit()` after panel becomes visible, not before. Use `requestAnimationFrame` or a short delay if needed after show transitions.

---

## 4. Layout Persistence JSON Schema

Tree shape must be separately persisted from panel sizes (which `autoSaveId` handles).

```typescript
type SplitDirection = "horizontal" | "vertical";

interface SplitNode {
  type: "split";
  direction: SplitDirection;
  sizes: [number, number]; // percentage, sums to 100; mirrors PanelGroup layout
  children: [PaneNode | SplitNode, PaneNode | SplitNode]; // always binary
}

interface PaneNode {
  type: "pane";
  sessionIds: string[]; // tabs within this pane
  activeSessionId: string;
}

type LayoutNode = SplitNode | PaneNode;

interface PersistedLayout {
  version: 1;
  root: LayoutNode;
}
```

**Persistence key:** `dam-hopper:terminal-layout` in `localStorage`.

**Sizes field:** store sizes alongside tree node (not relying solely on `autoSaveId`) so a single JSON blob captures the full layout. On restore, pass `sizes` to `PanelGroup`'s `setLayout()` imperatively after render.

**Corruption guard:** wrap `JSON.parse` in try/catch; if schema version mismatch or invalid, fall back to a single `PaneNode` with existing sessions.

---

## 5. VS Code / Warp / iTerm2 Split Model Comparison

| App | Model | Drag-to-split | Max depth |
|-----|-------|---------------|-----------|
| VS Code terminal | Flat group list (not tree) | Drag tab to split zone shown on hover | Shallow (groups side-by-side only) |
| VS Code editor | Flat group list | Same | Shallow |
| Warp | Binary tree | Drag to edge hotzone | Unlimited |
| iTerm2 | Binary tree | Drag tab to edge | Unlimited |

**User mental model:** users expect drag-to-edge (drop zones appear at panel edges on drag) rather than a toolbar button. VS Code shows a blue zone indicator when hovering near panel edge during drag. Warp does the same.

**For DamHopper MVP:** keyboard-triggered split (`Ctrl+\`) is sufficient for phase 1. Drag-drop is a separate follow-up (requires a drag library, e.g. `@dnd-kit/core`, and drop-zone overlay rendering).

---

## 6. Keyboard Shortcuts & Conflicts

| Shortcut | Intended action | Conflict |
|----------|-----------------|----------|
| `Ctrl+\` | Split pane | VS Code uses `Ctrl+K \` (chord) for editor split. No direct conflict. Terminal itself: no conflict. Shell: `Ctrl+\` = SIGQUIT (sends to foreground process in PTY). **This is a real conflict.** |
| `Ctrl+Tab` | Switch tab | Browser-native: cycles browser tabs. Blocked in browser unless `preventDefault()` called inside the terminal container. Works only when terminal has focus AND the browser yields. **Unreliable.** |
| `Alt+Left/Right` | Previous/next pane | VS Code terminal uses this. No browser conflict. Recommended. |
| `Ctrl+Shift+5` | VS Code terminal split | Safe, no conflict. Familiar to VS Code users. |
| `Ctrl+Shift+\` | Split (alternative) | No known conflicts. Less memorable. |

**Recommendation:**
- Split: `Ctrl+Shift+5` (mirrors VS Code terminal exactly, avoids SIGQUIT issue)
- Navigate panes: `Alt+Left` / `Alt+Right` (VS Code compatible, no browser conflict)
- Switch tabs within pane: `Ctrl+Shift+[` / `Ctrl+Shift+]` (common in editors)
- Avoid `Ctrl+\` (SIGQUIT conflict in PTY) and `Ctrl+Tab` (browser conflict)

xterm.js `attachCustomKeyEventHandler` allows intercepting keys before PTY receives them — necessary for any shortcut that overlaps with terminal input.

---

## 7. Risks

1. **xterm.js resize race:** `fitAddon.fit()` called before container has final dimensions (e.g., during panel drag) sends wrong `TIOCSWINSZ` to PTY, corrupting line-wrapping. Mitigation: debounce `fit()` calls during active resize (100ms), or use `ResizeObserver` with `requestAnimationFrame` wrapper.

2. **Layout corruption on reload:** stored tree references `sessionId`s that no longer exist (server restarted, session dropped). Mitigation: on restore, cross-check `sessionIds` against live sessions from `/api/pty`; remove dead IDs; if a leaf becomes empty, remove the pane and re-balance the tree.

3. **Drag-drop lib choice:** `@dnd-kit/core` is the current standard (react-beautiful-dnd deprecated). But implementing drop-zones at panel edges (not just sortable lists) requires custom sensors + collision detection. Non-trivial effort — recommend deferring to a later phase.

4. **`terminal.open()` single-call constraint:** if a terminal pane is unmounted from React tree (e.g., layout re-render removes the container div), the `terminal.element` reference is lost. Must ensure container divs persist in the DOM even when panels collapse or re-order — use a portal or a fixed invisible container and move elements imperatively.

5. **React 19 concurrent mode + imperative xterm.js:** `StrictMode` double-invokes effects; could call `terminal.open()` twice. Use a `useRef` guard (`openedRef`) to ensure single open.

---

## Unresolved Questions

1. Does DamHopper's current `WsTransport` support multiplexing PTY output to the same session from multiple consumers (needed if the same terminal appears in two panes temporarily during drag)?
2. Is `@dnd-kit` already a dependency, or must it be added? Check `packages/web/package.json`.
3. What's the desired behavior when a leaf pane's last tab is closed — auto-collapse the panel or show an empty state?
4. Should layout be per-workspace or global? Current architecture stores workspace config server-side but UI state in localStorage — layout would go in localStorage keyed by workspace name.

---

## Sources

- https://github.com/bvaughn/react-resizable-panels
- https://react-resizable-panels.vercel.app/
- https://www.npmjs.com/package/react-resizable-panels
- https://xtermjs.org/docs/api/terminal/classes/terminal/
- https://github.com/xtermjs/xterm.js/issues/664
- https://www.npmjs.com/package/xterm-addon-fit
- https://dev.to/warpdotdev/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds-2kon
- https://docs.warp.dev/terminal/windows/split-panes
- https://code.visualstudio.com/docs/terminal/basics
