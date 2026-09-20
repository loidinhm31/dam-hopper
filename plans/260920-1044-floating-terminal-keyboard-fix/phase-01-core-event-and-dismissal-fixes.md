# Phase 01 — Core event and dismissal fixes

## Context links

- [Plan overview](./plan.md)
- [Root-cause report](../reports/debugger-260920-1046-floating-terminal-keyboard-root-cause.md)
- [Floating shell](../../packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx)
- [Custom keyboard](../../packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx)

## Overview

- Priority: P1
- Status: Complete
- Effort: 1.5h
- Goal: keep interactions inside controls/panel classified as inside even after React replaces their target nodes, and make native button `click` the single custom-key activation authority.

## Key decisions

1. Use the dispatch-time event path. `PointerEvent.composedPath()` retains the panel and control roots even if the original button/span becomes detached before document bubbling finishes.
2. Use native button semantics instead of timestamp/pointer-ID deduplication. `pointerdown` only protects terminal focus; `click` calls `onPress(key)` for ordinary `detail >= 1`, programmatic/keyboard `detail === 0`, and assistive activation.
3. Remove the custom `onKeyDown` activation override. Native `<button>` Enter/Space already produces one click; retaining both risks duplicate terminal bytes.

## Related code files

| File | Action | Change |
|---|---|---|
| `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx` | Modify | Replace live-DOM `contains(event.target)` dismissal test with composed-path membership. |
| `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx` | Modify | Make `onClick` unconditional activation; make `onPointerDown` prevention-only; remove redundant keyboard activation code/helper if unused. |
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` | Modify in Phase 03 | Unit regression for a target detached during pointer bubbling. |
| `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` | Modify in Phase 03 | Real click/tap/keyboard and modifier/layer re-render regression. |

## Implementation steps

1. In the shell document `pointerdown` listener, capture `event.composedPath()` once.
2. Build the current accepted roots from `controlsRef.current` plus non-null `outsideRefs` entries. Return without dismissal when any accepted root occurs in the path by identity (`path.some(entry => entry === root)`). Do not rely on the current root containing the possibly detached target.
3. Keep outside behavior unchanged: a path containing neither root invokes `onDismiss()` once; Escape still prevents propagation and invokes `onEscape()`.
4. In each custom key button, keep `onPointerDown={event => event.preventDefault()}` solely to avoid focus transfer back to terminal/xterm.
5. Change `onClick` to call `onPress(key)` for every click; delete the `event.detail === 0` filter.
6. Delete the explicit Enter/Space `onKeyDown` callback and rely on button activation. Preserve `type="button"`, ARIA label/pressed state, styles, and key/layout selection.
7. Do not apply the change to `MobileTerminalSpecialKeys`; it is outside this reported Type-keyboard defect.

## Required regressions

- A pointerdown whose handler replaces the originating child still sees the original panel root in `composedPath()` and does not dismiss.
- A true outside pointerdown dismisses once.
- Pointerdown plus standard click invokes a custom key once, not twice.
- A `click` with `detail: 1` and no preceding pointerdown invokes once (assistive fallback model).
- Enter and Space on a focused custom button invoke once via native click.
- Shift, Caps, Symbols/Letters, and shifted text re-renders do not close the panel; the following key still reaches the active session.

## Success criteria

- Custom touch/mouse/assistive/keyboard activations each produce exactly one expected terminal sequence.
- State-changing keys leave Type visible and usable.
- Outside click and Escape dismissal semantics remain intact.
- No timer-based deduplication, global gesture state, new dependency, or transport change.

## Risks

| Risk | Mitigation |
|---|---|
| Preventing pointerdown suppresses click in a browser | Chromium test uses a full pointer/click action; physical mobile smoke covers Safari/Android. If observed, use minimal pointer/click dedup state rather than restoring the detail filter. |
| Stale/null refs appear in the path test | Ignore null roots; compare root identity only. |
| Native keyboard activation fires both keydown code and click | Remove custom keydown activation entirely. |

## Unresolved questions

None.
