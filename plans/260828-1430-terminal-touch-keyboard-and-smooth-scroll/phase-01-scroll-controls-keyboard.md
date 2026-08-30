# Phase 01 — Scroll controls no longer trigger keyboard

## Context links
- [Plan](plan.md)
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx:60-178`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx:126-149`
- `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx:52-60` (correct pattern)
- `packages/ui/src/lib/terminal-native-input-policy.ts` / `android-chrome-input-policy.ts`

## Overview
Date: 2026-08-28 · Priority: high · Status: DONE 2026-08-28 18:04:32 +07:00 · Owner: implementation agent

Prevent Android/coarse-pointer taps on terminal scroll controls from focusing xterm's hidden textarea or host, which opens soft keyboard. Desktop click/keyboard access unchanged.

## Key insights
- Current buttons use only `onMouseDown preventDefault` + `onClick`. Android touch sequence is `pointerdown → touchstart → touchend → mousedown → click`; blocking only `mousedown` does not prevent earlier `pointerdown`/`touchstart` from focusing or bubbling to xterm's viewport focus handler under overlay.
- `MobileTerminalCustomKeyboard` already does `onPointerDown preventDefault + onPress` — copy that pattern.
- `TerminalRuntimeOutput` host `onClick` focuses terminal when `suppressTerminalNativeInput` false; button clicks currently `stopPropagation` on `click` only, not on `pointerdown`.
- `android-chrome-input-policy` allows button focus (records `lastAllowedFocus`) — button focus itself doesn't open IME, but viewport/textarea focus under overlay does.

## Requirements
- Tapping toggle or any scroll button on coarse pointer does not focus xterm textarea, does not set `document.activeElement` to textarea, does not open IME.
- Buttons remain operable: toggle opens/closes, scroll actions call `scrollToTop/scrollLines/scrollToBottom`.
- Outside `pointerdown` still closes menu; `Escape` still closes.
- Keyboard nav (Tab/Enter/Space) still works on desktop; buttons stay accessible.

## Architecture
- Single file primary: `TerminalScrollButtons.tsx`. Add shared `handlePointerDown = (e) => { e.preventDefault(); e.stopPropagation(); }` and wire to `onPointerDown` (+ `onTouchStart` fallback) on all 5 buttons. Keep `onMouseDown` for desktop compat or replace entirely with pointer handler.
- Optionally set `touchAction: "manipulation"` and `userSelect: "none"` via class or inline to reduce double-tap zoom/selection.
- Do not change global IME policy; do not add `tabIndex=-1` that would remove keyboard access (pointer `preventDefault` already prevents pointer focus without harming tab order).

## Related code files
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` (host context, no edit expected — verify stopPropagation covers it)
- `packages/ui/src/lib/terminal-registry.ts` (scroll APIs, no edit)

## Implementation steps
1. Replace `onMouseDown={(e)=>e.preventDefault()}` on all buttons with `onPointerDown` that does `preventDefault + stopPropagation`; add `onTouchStart` same guard for older WebViews; keep `onClick` with `preventDefault+stopPropagation`.
2. Extract helper `preventPointerFocus` to avoid repetition; apply to toggle + 4 scroll buttons (keep `handleTerminalAction` for click, add pointer guard separately).
3. Verify toggle `aria-expanded/controls` still correct; no layout change.
4. Manual check: Android Chrome (or DevTools device + coarse-pointer emulation) — tap each button, assert no keyboard, `document.activeElement` is button or body, not textarea.

## Todo list
- [ ] Add pointer/touch guard to all 5 buttons
- [ ] Verify host click not triggered (stopPropagation on pointerdown)
- [ ] Run `packages/ui/src/components/organisms/TerminalScrollButtons.test.tsx` + browser test `terminal-scroll-buttons.browser.tsx`

## Success criteria
- On Android Chrome/coarse pointer, tapping any scroll control does not open soft keyboard and does not focus xterm textarea.
- Scroll actions still fire; toggle still toggles; Escape + outside pointerdown still close.
- Desktop mouse/keyboard unchanged; tests pass.

## Risk assessment
Low. Isolated to 5 buttons in one component; pointer guard is additive; no API change. Risk: over-blocking could break keyboard focus — mitigated by not setting `tabIndex=-1`.

## Security considerations
No input logging; no secrets; `preventDefault` scoped to controls only.

## Next steps
Phase 02 — native smooth scroll.
