---
title: "Native smooth touch scroll"
description: "Deliver smooth coarse-pointer xterm touch scrolling without changing desktop terminal behavior."
status: completed
priority: P1
effort: 3h
branch: develop
tags: [feature, frontend, terminal, touch]
created: 2026-08-28
---

# Phase 02 — Native smooth touch scroll

## Context links
- [Plan](plan.md)
- `packages/ui/src/lib/terminal-touch-scroll.ts:1-54`
- `packages/ui/src/components/organisms/TerminalPanel.tsx:315-335` (callsite `releaseTouchScroll = bindTerminalTouchScroll(...)`)
- `packages/ui/src/index.css` (global xterm overrides, if any)

## Overview
Date: 2026-08-29 · Priority: high · Status: DONE 2026-08-29 16:48:06 +07:00 · Owner: implementation agent

Restore smooth coarse-pointer touch scrolling for xterm v6 while preserving desktop behavior. Because xterm scrollback is exposed through its buffer API, touch movement is translated into `terminal.scrollLines(rows)` rather than native `scrollTop` mutation.

## Key insights
- `bindTerminalTouchScroll` runs only when `matchMedia("(any-pointer: coarse)")` matches and translates touch deltas into line scrolling.
- Movement is buffered and flushed on animation frames; bounded velocity and exponential decay provide fling behavior without per-event layout work.
- `.xterm .xterm-viewport` and `.xterm .xterm-scrollable-element` use `touch-action: none`; overscroll containment, touch momentum, and smooth programmatic scrolling remain enabled.

## Requirements
- On coarse pointer (Android), dragging terminal viewport scrolls through xterm's `scrollLines` API with smooth buffered movement and bounded fling.
- Preserve programmatic scroll from Phase 01 buttons (`scrollToTop/Bottom`, `scrollLines`).
- Desktop mousewheel/pointer scroll unchanged.
- Keep touch handling scoped to terminal surfaces; no server/API behavior changes.

## Architecture

Keep the existing binding and callsite to minimize churn. `bindTerminalTouchScroll` attaches capture-phase passive touch listeners only on coarse pointers, computes pixel deltas, converts them to terminal rows, and applies `terminal.scrollLines(rows)` from rAF flushes. Inertia uses bounded velocity decay. CSS sets `touch-action: none` on xterm viewport/scrollable elements and keeps overscroll/momentum/smooth-scroll polish.

No native `scrollTop` assignment or `preventDefault` is used by the touch-scroll binding.

## Related code files
- `packages/ui/src/lib/terminal-touch-scroll.ts` — custom xterm v6 `scrollLines` touch binding.
- `packages/ui/src/components/organisms/TerminalPanel.tsx` — binding lifecycle callsite.
- `packages/ui/src/index.css` — xterm viewport/scrollable-element touch policy.

## Implementation steps
1. Translate touch movement into buffered xterm `scrollLines` calls with rAF batching and bounded fling decay.
2. Apply xterm viewport/scrollable-element touch CSS (`touch-action: none`, contained overscroll, touch momentum, smooth programmatic scrolling).
3. Keep the `TerminalPanel.tsx` binding lifecycle and Phase 01 scroll-button actions intact.
4. Validate with UI build, Vitest, focused Chromium browser regressions, and coarse-pointer mobile-emulation swipe evidence.

## Todo list
- [x] Implement xterm v6 custom `scrollLines` touch scrolling with bounded fling.
- [x] Add `.xterm` touch CSS (`touch-action: none`, overscroll containment, touch momentum, smooth scrolling).
- [x] Verify build and test gates.
- [x] Validate coarse-pointer Chromium swipe behavior.

## Validation evidence

- `pnpm --filter @dam-hopper/ui build` — PASS, `tsc -p tsconfig.json` exited 0 in 5.99s.
- `pnpm --filter @dam-hopper/ui test` — PASS, 208/208 files and 1351/1351 tests.
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/terminal-scroll-buttons.browser.tsx browser-tests/android-chrome-input-policy.browser.ts` — PASS, 2/2 files and 10/10 tests.
- Chromium mobile-emulation touchscreen swipe moved the xterm scrollbar from 280px to 158px; a temporary 2000px page spacer kept `scrollY` at 0 before and after the terminal swipe.
- Physical Android hardware validation was not performed; no benchmark or memory-leak run was requested.
## Success criteria
- Terminal touch scroll uses buffered xterm line scrolling with bounded fling and no per-move `scrollTop` mutation.
- No `preventDefault` on viewport `touchmove`; CSS touch policy remains explicit.
- Programmatic button scroll still works; desktop unchanged; tests pass.

## Risk assessment
Low. The implementation is scoped to coarse-pointer terminal touch handling and retains the existing xterm scroll API. Physical Android hardware validation remains a release follow-up because only configured Chromium mobile emulation was exercised.

## Security considerations
None. No input handling, no data.

## Next steps
Phase complete; physical Android hardware validation remains a release follow-up.
