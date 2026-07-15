# Phase 04 — Ghost Geometry and Explicit History List

## Context links

- [Parent plan](./plan.md)
- [Phase 03](./phase-03-suggestion-controller-and-history-search.md)
- [xterm interaction/geometry research](./research/researcher-02-xterm-interaction-geometry.md)
- [xterm Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/)

## Overview

- Date: 2026-07-16
- Description: passive cursor suffix plus deliberate accessible fuzzy-history workflow
- Priority: P1
- Implementation status: pending
- Review status: pending
- Effort: 14h

## Key Insights

- xterm has lifecycle/cursor cell data but no stable public rendered cursor rectangle.
- Proposed decorations carry upgrade/renderer risk; start with isolated validated measurement.
- Passive UI must not behave like a preselected menu.

## Requirements

- Ghost is unfocusable, aria-hidden, one-line suffix, and never covers typed input.
- Own only configured accept key when controller atomically confirms `canAccept`.
- Full accept sends exact suffix once; partial accept sends next defined token only; never executes.
- Every other key returns to xterm unchanged.
- Geometry adapter validates cursor/host rect and hides on mismatch; no scattered DOM selectors.
- Recompute once/frame on cursor/write/resize/scroll/zoom/font/reparent events; dismiss on hide/detach.
- Explicit list requires deliberate open/focus, full text, copy/use actions, measured clamp/flip, APG semantics.
- Mobile automatic ghost/list remains disabled and cannot leave stale desktop UI.

## Architecture

`TerminalPanel` installs one composed xterm key handler and one geometry adapter per live
terminal. The adapter prefers validated `terminal.textarea` measurement, with one isolated
screen-grid fallback. No proposed decoration by default. `TerminalSuggestionGhost` renders
the immutable snapshot. A separate focused dialog/popover owns fuzzy history; “Use” inserts
without Enter, “Copy” never mutates PTY.

## Related code files

- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalPanel.tsx` — controller, handler, lifecycle wiring
- Replace/refactor: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/atoms/TerminalSuggestionOverlay.tsx` — explicit list only
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` — explicit unsupported boundary
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-host-attachment.ts` — reparent invalidation
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-registry.ts` — host/session lifecycle callback
- Modify: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx` — compose with find/key routing
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-cursor-geometry-adapter.ts` — isolated measurement
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/atoms/TerminalSuggestionGhost.tsx` — passive suffix
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalHistoryList.tsx` — explicit workflow
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-cursor-geometry-adapter.test.ts` — pure/fake geometry
- Create: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalHistoryList.test.tsx` — a11y/interactions
- Delete: none until replacement coverage passes

## Implementation Steps

1. Lock full/partial accept keys after terminal/platform conflict audit.
2. Compose one pre-processing key handler with existing find/shortcut routing.
3. Implement suffix-only accept through shared PTY input; update controller before send.
4. Spike textarea measurement across DOM/WebGL, DPR, zoom, wrap, scroll, resize, and reparent.
5. Implement adapter with strict bounds validation, rAF coalescing, cleanup, and hide fallback.
6. Build passive ghost and narrow-pane clipping/fade behavior without multiline wrapping.
7. Build explicit focused history list with no implicit passive selection, copy/use, full text, and labels.
8. Add settings/help copy and explicit desktop/mobile capability state.

## Todo list

- [ ] Choose acceptance and explicit-list shortcuts
- [ ] Add key pass-through/acceptance tests
- [ ] Complete geometry spike and decision record
- [ ] Implement adapter and lifecycle cleanup
- [ ] Build passive ghost
- [ ] Build accessible explicit list
- [ ] Verify PaneContainer/find/reparent composition
- [ ] Verify mobile stays cleanly unsupported

## Success Criteria

- Passive Tab/Enter/Escape/Ctrl+R/paste/TUI keys are byte-identical at PTY.
- Accepted suffix is sent once, preserves prefix, and never sends Enter or Ctrl+U.
- Anchor stays within about 1 CSS pixel in validated browser matrix or ghost hides.
- Resize/split/reparent/scroll/zoom/font changes reposition next frame or dismiss.
- Narrow pane never clips interactive list controls; actual content height controls flip.
- Passive ghost is absent from accessibility tree; explicit list passes role/name/focus behavior.

## Risk Assessment

- Textarea placement is public surface but cursor-relative layout is not guaranteed.
- WebGL/reflow may invalidate measurement; release may use DOM renderer fallback.
- Plain Right/End can conflict with shell editors; default must follow validated decision.

## Security Considerations

UI must consume only Phase 03 gated snapshots. Click/use repeats atomic revision and prefix
checks. Full history text must not appear in diagnostics, telemetry, titles, or error logs.

## Next steps

Run Phase 05 browser and real-PTY release matrix; do not default-enable before it passes.

## Unresolved questions

- Accept key policy?
- Allow proposed decoration API if measurement fails?
- Require WebGL parity or permit automatic DOM-renderer fallback?
- Explicit history shortcut that does not collide with terminal apps?

