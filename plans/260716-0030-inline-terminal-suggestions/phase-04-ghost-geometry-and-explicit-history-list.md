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
- Implementation status: completed 2026-07-16 09:34 +07
- Review status: approved 2026-07-16 09:34 +07
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

- [x] Choose acceptance and explicit-list shortcuts
- [x] Add key pass-through/acceptance tests
- [x] Complete geometry spike and decision record
- [x] Implement adapter and lifecycle cleanup
- [x] Build passive ghost
- [x] Build accessible explicit list
- [x] Verify PaneContainer/find/reparent composition
- [x] Verify mobile stays cleanly unsupported

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

## Completion

**Completed:** 2026-07-16 09:34 +07
**Review:** Approved

- The geometry adapter now measures the public xterm textarea before using a single
  validated screen-grid fallback. It coalesces cursor, parsed-write, resize, scroll,
  viewport, and font invalidations; buffer uncertainty, detach, and disposal hide it.
- The passive ghost is host-relative, aria-hidden, non-interactive, one line only,
  and clips/fades instead of wrapping. It renders only when a validated anchor and
  suffix are both present.
- `Alt+Right` inserts the full safe suffix; `Alt+Shift+Right` inserts its next token;
  `Ctrl+Alt+H` deliberately opens the history dialog. Acceptance clears the ghost
  atomically before the suffix is written, and no action sends Enter.
- Existing find/shared shortcuts and pane routing remain composed after suggestion
  handling. Geometry invalidates on terminal host reattachment.
- The dialog has focus, name, description, full command text, filtering, Copy, and
  Use controls. Use inserts only single-line commands; multiline commands are copy-only.
- Coarse-pointer and native-keyboard-suppressed sessions fail closed for automatic
  suggestions and do not retain desktop ghost geometry.

## Decision record

- Use measured textarea geometry with an isolated `.xterm-screen` grid fallback;
  do not enable the proposed xterm decoration API.
- Reserve `Alt+Right` and `Alt+Shift+Right` only while the controller can atomically
  accept the current ghost; otherwise native pane/terminal routing receives them.
- Use `Ctrl+Alt+H` for explicit history because it is deliberate and does not alter
  native Tab, Enter, Escape, Ctrl+R, paste, or TUI input.
- Automatic UI must remain disabled on coarse-pointer/mobile surfaces pending unified
  input routing; the explicit desktop dialog is separate from passive suggestion state.

## Next steps

Run Phase 05 browser and real-PTY release matrix; do not default-enable before it passes.

## Unresolved questions

None for Phase 04. Phase 05 must validate the selected measurement strategy across
the release browser/renderer matrix before any default enablement.
