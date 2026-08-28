# Phase 02 — Native smooth touch scroll

## Context links
- [Plan](plan.md)
- `packages/ui/src/lib/terminal-touch-scroll.ts:1-54`
- `packages/ui/src/components/organisms/TerminalPanel.tsx:315-335` (callsite `releaseTouchScroll = bindTerminalTouchScroll(...)`)
- `packages/ui/src/index.css` (global xterm overrides, if any)

## Overview
Date: 2026-08-28 · Priority: high · Status: pending · Owner: implementation agent

Restore native compositor scrolling for `.xterm-viewport` on coarse pointer so terminal scroll is as smooth as normal scroll containers (momentum/fling, rubber-band, 60fps). Current manual `scrollTop` per `touchmove` + `preventDefault` kills all of that.

## Key insights
- `bindTerminalTouchScroll` runs only when `matchMedia("(pointer: coarse)")` matches; it hijacks `touchmove` with `preventDefault` and assigns `viewport.scrollTop = startScrollTop + (startY - touch.clientY)`. This disables browser momentum, fling velocity, and overscroll — the exact jank reported.
- Normal components scroll smoothly because they keep native `overflow: auto/scroll` + compositor scrolling. Terminal should do same; xterm's `.xterm-viewport` is already `overflow-y: scroll`.
- No rAF batching, no velocity decay, no `scroll-behavior` — manual path cannot match native.
- Coarse-pointer guard means desktop is already native and must stay so.

## Requirements
- On coarse pointer (Android), dragging terminal viewport scrolls with native momentum, same kinematics as other scroll views.
- No `preventDefault` on `touchmove` of viewport; no per-frame `scrollTop` assignment.
- Preserve programmatic scroll from Phase 01 buttons (`scrollToTop/Bottom`, `scrollLines`).
- Desktop mousewheel/pointer scroll unchanged.
- Optional polish: `scroll-behavior: smooth` for programmatic jumps, `overscroll-behavior: contain` to avoid parent scroll chaining.

## Architecture
Two safe options; prefer A (YAGNI/KISS):

- **A (recommended): remove manual handler, add CSS.** Make `bindTerminalTouchScroll` a no-op (return `()=>{}` immediately) or delete its body; keep exported symbol to avoid churn, or delete file + callsite if preferred. Add one global rule (in `packages/ui/src/index.css` or injected after `term.open`):
  ```css
  .xterm-viewport {
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scroll-behavior: smooth;
  }
  ```
  No JS touch listeners. Native scrolling does the work.

- **B (if keep file): keep coarse-pointer early-return but remove all listeners.** Same CSS as A. No `addEventListener` for touch.

Do not add custom inertia JS — native is strictly better and less code.

## Related code files
- `packages/ui/src/lib/terminal-touch-scroll.ts` (edit to no-op)
- `packages/ui/src/components/organisms/TerminalPanel.tsx` (keep or remove `bindTerminalTouchScroll` import/callsite; if no-op, no change needed)
- `packages/ui/src/index.css` (add `.xterm-viewport` rule) — or inline `viewport.style.touchAction = "pan-y"` after mount

## Implementation steps
1. Change `bindTerminalTouchScroll` to immediately `return () => {}` (or delete body). Keep signature for compat. Remove `touchstart/touchmove/touchend/touchcancel` listeners and `preventDefault`/`scrollTop` logic.
2. Add CSS for `.xterm-viewport` as above (global CSS preferred so it applies to every terminal including keep-alive reparented hosts).
3. In `TerminalPanel.tsx`, either keep callsite (now no-op) or remove `releaseTouchScroll` + import if file deleted — keep minimal diff; verify no unused import lint.
4. Verify: coarse-pointer emulation + real Android — drag/flick viewport, compare to normal div scroll; confirm momentum and no keyboard open (Phase 01 still holds).

## Todo list
- [ ] Make `bindTerminalTouchScroll` no-op (remove manual scrollTop + preventDefault)
- [ ] Add `.xterm-viewport` CSS (`touch-action: pan-y`, `-webkit-overflow-scrolling: touch`, `overscroll-behavior: contain`, `scroll-behavior: smooth`)
- [ ] Verify no lint/type errors; run vitest + browser tests
- [ ] Manual momentum check on Android/coarse-pointer emulation

## Success criteria
- Terminal viewport touch scroll has native momentum/fling and matches smoothness of normal components (visual, no jank).
- No `preventDefault` on viewport `touchmove`; no JS-driven `scrollTop` per move.
- Programmatic button scroll still works; desktop unchanged; tests pass.

## Risk assessment
Low. Change is subtractive (remove JS, add passive CSS). Risk: if xterm viewport relied on manual handler for some edge device, native fallback still scrolls — no regression. Keep change behind coarse-pointer is unnecessary once CSS is passive for all.

## Security considerations
None. No input handling, no data.

## Next steps
Handoff via `/code plans/260828-1430-terminal-touch-keyboard-and-smooth-scroll/plan.md`.
