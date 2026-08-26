# Phase 02 — Find Bar and TerminalPanel Lifecycle

## Context links

- Parent: [plan.md](./plan.md)
- Dependency: [phase-01](./phase-01-dependency-and-search-controller.md)
- Existing xterm owner: `packages/ui/src/components/organisms/TerminalPanel.tsx`
- Existing portal pattern: `TerminalSuggestionOverlay` portal in `TerminalPanel.tsx`
- Existing styles/tokens: `packages/ui/src/index.css`

## Overview

- Date: 2026-07-15
- Priority: P2
- Status: Completed
- Review status: Approved (9/10)
- Description: Add the accessible terminal-local find bar and attach it to the existing xterm/addon lifecycle without remounting terminals.
- Estimate: 3h

## Key Insights

- `TerminalPanel` already owns addon creation, output/replay ordering, terminal refs, portal target state, and disposal.
- `term.element` follows pane/tab reparenting; a sibling React overlay would not.
- `TerminalKeepAliveHost` intentionally keeps inactive terminals mounted and hidden; the bar must remain inside the terminal root and be harmless while hidden.

## Requirements

- Create `packages/ui/src/components/atoms/TerminalFindBar.tsx`.
- Render top-right inside the terminal element with query input, previous, next, status, and close controls.
- Use labels/tooltips/`aria-label`, visible focus styles, and an `aria-live` status region.
- On open, focus the input and select its current text.
- On query change, update the controller; Enter triggers next, Shift+Enter previous; Escape closes.
- Close/Escape clears the query/decorations and focuses the same xterm terminal.
- Empty state: `Type to search`; no match: `No matches`; match state: `current of total`.
- Stop event propagation from the find bar root and prevent navigation/close defaults where needed so UI events cannot reach xterm's input path.
- Use existing CSS variables and compact terminal styling; do not introduce a new palette or global modal.

## Architecture

```text
TerminalPanel effect
  → new SearchAddon()
  → new TerminalFindController(addon)
  → register controller + set term element

React snapshot subscription
  → createPortal(<TerminalFindBar ... />, term.element)

TerminalPanel cleanup
  → controller.dispose()
  → unregister controller
  → existing renderer/terminal disposal
```

Load the search addon after `term.open()` with the existing addons. Keep the controller in a ref/imperative registry, and use a subscription/snapshot bridge for React rendering rather than storing xterm objects in state. The first render must not assume `term.element` exists. The bar must not change PTY transport or output replay logic.

## Related code files

Modify:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx` — create/load controller, portal bar, cleanup, focus behavior.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-registry.ts` — expose controller if selected in Phase 01.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/index.css` — only if a small addon decoration/find-bar selector is needed.

Create:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/atoms/TerminalFindBar.tsx`.
- Optional `TerminalFindBar` markup test if the existing test style can cover it without adding a DOM testing stack.

Delete: none.

## Implementation Steps

1. Add stable refs for the controller and the terminal element.
2. Construct/load `SearchAddon` once in the existing guarded mount effect; create the controller before registering the terminal entry.
3. Extend registration so active-pane code can invoke `open()` for that session.
4. Add a React subscription bridge to re-render only the bar when controller state changes.
5. Render the bar through `createPortal` into `termElement`, alongside the suggestion portal.
6. Implement input, buttons, status, and close semantics with keyboard and pointer handling.
7. On close, call controller close then `term.focus()`; guard focus when disposed or mobile keyboard suppression is active.
8. Dispose controller and unregister it before `term.dispose()` in the existing cleanup path.
9. Confirm output/replay and suggestion behavior remain unchanged.

## Todo list

- [x] Create accessible `TerminalFindBar`.
- [x] Load SearchAddon exactly once per terminal.
- [x] Bridge controller snapshots to React.
- [x] Portal bar into `term.element`.
- [x] Restore focus on close/Escape.
- [x] Dispose controller with terminal.
- [x] Verify compact/mobile behavior does not open native keyboard unexpectedly.

## Completion Notes

Completed: 2026-07-15 16:35 Asia/Saigon

## Success Criteria

- The bar appears only after xterm is opened and can be portaled into the visible terminal root.
- Query/status/button state updates without remounting `TerminalPanel`.
- Close and Escape clear highlights and restore focus to the same terminal.
- Existing suggestion overlay and PTY lifecycle still function.
- UI package build passes.

## Risk Assessment

- Risk: state updates after terminal disposal. Mitigation: unsubscribe before disposal and guard snapshot callbacks.
- Risk: portal hidden by the keep-alive host. Mitigation: test after `terminal-host-attachment` moves the terminal; do not use a host-level overlay.
- Risk: active-match decoration loses contrast. Mitigation: use explicit dark-theme hex colors and validate in both renderers.

## Security Considerations

- Query and match status are transient browser state; do not persist or log them.
- Search decorations must not expose terminal content outside the terminal DOM subtree.

## Next steps

Wire Ctrl/Cmd+F through the active `PaneContainer` handler and close stale bars when sessions become inactive in Phase 03.
