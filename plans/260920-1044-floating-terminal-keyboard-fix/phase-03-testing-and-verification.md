# Phase 03 — Testing and verification

## Context links

- [Plan overview](./plan.md)
- [Phase 01](./phase-01-core-event-and-dismissal-fixes.md)
- [Phase 02](./phase-02-native-input-ime-and-focus.md)
- [Unit suite](../../packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx)
- [Chromium suite](../../packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx)

## Overview

- Priority: P1
- Status: In Review
- Effort: 2h
- Goal: lock observable input, focus, exactly-once, and dismissal behavior with focused jsdom and real Chromium coverage, then run the UI TypeScript build.

## Test strategy

Tests defend user-visible contracts, not source text, handler names, or arbitrary class strings. Exact transport call count and sequence are essential because duplicates are as harmful as missing input.

## Related code files

| File | Action | Coverage |
|---|---|---|
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` | Modify | Shell path stability, synchronous native focus, guard default behavior, session routing, beforeinput/composition. |
| `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` | Modify | Real click/pointer/keyboard activation, re-render survival, native focus/padding, browser InputEvent behavior. |

## Unit test steps

1. Update/remove the native-input mock so new semantic props and real event normalization are exercised. Keep transport mocked and reset all DOM/global state per case.
2. Do not make `requestAnimationFrame` run synchronously in the native-open assertion. Click Type and assert the input is focused immediately; separately retain the existing deferred trigger-focus restoration test.
3. Dispatch pointer/mouse down on the marked native wrapper padding. Assert `defaultPrevented === false`, host click remains isolated, and input focus remains/acquires.
4. Dispatch cancelable `beforeinput` events and assert exact writes:
   - `insertText`, data `a` -> `("session-1", "a")` once.
   - `deleteContentBackward` with unidentified/no useful keydown -> `("session-1", "\x7f")` once.
   - `insertLineBreak`/`insertParagraph` -> `("session-1", "\r")` once.
5. Exercise composition start, multiple interim updates, and composition end with non-ASCII text. Assert no interim writes or buffer reset and one final committed write.
6. Exercise identified desktop Enter/Backspace and assert default prevented plus one output even when a plausible follow-on input event is attempted.
7. Add a stateful shell harness in this same test file: an inside pointerdown replaces its child before reaching `document`; assert the panel remains open. Dispatch body pointerdown and assert dismissal still occurs.

## Chromium test steps

1. For custom Type, use `userEvent.click` on a text key and assert one write; this covers ordinary `click.detail >= 1` after pointerdown.
2. Dispatch an assistive-style `MouseEvent("click", { bubbles: true, detail: 1 })` without pointerdown and assert one write.
3. Focus a custom key and activate with Enter and Space; assert one write per action through native button click.
4. Trigger Shift/Caps and Symbols/Letters transitions with real pointer actions. After each DOM-changing action assert the panel/control remains visible; then press a text key and verify expected sequence once.
5. Open native Type and assert immediate focus. Click the wrapper padding (not the `<input>` pixels), then assert the input stays focused and terminal host click remains untouched.
6. Dispatch real Chromium `InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true })` sequences for insert text, backward delete, and line break. Assert prevent-default where supported and exact writes.
7. Dispatch composition start/update/end with Unicode text; assert interim silence and one final write.
8. Preserve outside pointer and Escape coverage: outside closes; Escape closes and restores invoking trigger focus.

## Verification commands

Run focused checks in this order:

```bash
pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/MobileTerminalAccessoryBar.test.tsx
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/mobile-terminal-accessory-bar.browser.tsx
pnpm --filter @dam-hopper/ui build
```

`@dam-hopper/ui` has no `check` script; its `build` script is `tsc -p tsconfig.json` and is the scoped TypeScript gate. Final integration may additionally run root `pnpm check`, which also builds native, lints all packages, and runs server tests.

## Manual mobile smoke

Desktop Chromium cannot prove OS software-keyboard invocation. On available devices before release:

- iOS WebKit: tap Type; keyboard appears immediately; type plain and composed/accented text; Backspace and Return work; tap input padding; keyboard stays open.
- Android Chrome/custom policy: custom keys, Shift, Symbols, Backspace, and Enter remain open and write once.
- Android browser/native path where available: Gboard text/composition, Backspace (`keyCode 229`/`Unidentified`), and Enter write once.

Record device/browser versions and observed results; absence of a device is reported, never replaced by an automated claim.

## Success criteria

- Focused unit and Chromium suites pass with no flaky timers or implementation-text assertions.
- UI `tsc` build passes.
- Every tested physical action writes the expected sequence exactly once to `session-1`.
- Custom panel survives modifier/layer re-renders; native input remains focused through open and padding interaction.
- Outside/Escape dismissal, trigger restoration, active-session routing, and existing layout assertions remain green.

## Risks

| Risk | Mitigation |
|---|---|
| Synthetic unit events do not reproduce browser ordering | Keep unit tests narrow; prove full sequences in Chromium. |
| Existing synchronous rAF stub masks the original bug | Queue/spy rAF for open-focus test; flush only for dismissal restoration. |
| Browser event support varies | Assert outputs first; condition default-prevention expectations only where the constructed event is cancelable/supported. Physical smoke covers mobile engines. |
| Test passes on programmatic `element.click()` only | Include `userEvent.click`, explicit `detail: 1` click without pointerdown, and keyboard activation. |

## Unresolved questions

None.
