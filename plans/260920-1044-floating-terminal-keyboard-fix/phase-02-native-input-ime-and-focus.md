# Phase 02 — Native input, IME, and focus

## Context links

- [Plan overview](./plan.md)
- [Root-cause report](../reports/debugger-260920-1046-floating-terminal-keyboard-root-cause.md)
- [Accessory bar](../../packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx)
- [Native input](../../packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx)

## Overview

- Priority: P1
- Status: Needs Fix (Deduplication Latch)
- Effort: 2.5h
- Goal: mount and focus native Type within the opening gesture, preserve focus from host-padding taps, and normalize mobile/IME events into terminal text, DEL, and CR exactly once.

## Architecture

Keep transport ownership in `MobileTerminalAccessoryBar`; keep browser-event normalization in `MobileTerminalNativeKeyboardInput`.

```text
trusted Type click
  -> synchronously commit native panel
  -> focus input before handler returns

native input events
  -> native-input adapter (keydown / beforeinput / composition)
  -> one terminal sequence callback
  -> terminalWrite(active session, sequence)
```

Recommended prop cutover: replace DOM-specific `onChange`/`onKeyDown` props with one semantic callback such as `onTerminalInput(sequence: string)`. The native component owns composition/buffer refs and maps browser events; the accessory bar only sends non-empty sequences for its captured `sessionId`.

## Related code files

| File | Action | Change |
|---|---|---|
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` | Modify | Synchronous open/focus, semantic native write callback, native-host guard exemption. |
| `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx` | Modify | Mark/focusable host; implement beforeinput, composition, and keydown fallback normalization. |
| `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` | Modify in Phase 03 | Focus timing, guard, IME, Android-style input, exact-write tests. |
| `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` | Modify in Phase 03 | Chromium focus, padding, beforeinput/composition behavior. |

## Implementation steps

### A. Gesture-safe opening

1. Split `toggleKeyboard` into explicit open and close branches using current `isKeyboardOpen`.
2. On native opening, synchronously commit `setIsKeyboardOpen(true)` (minimal `flushSync` from `react-dom` is appropriate because the input is conditionally mounted), then immediately call `keyboardInputRef.current?.focus()` before the trusted click handler returns.
3. Do not put focus in `requestAnimationFrame`, an effect, promise, or timer. Keep deferred focus only for existing post-dismiss trigger restoration.
4. On close, blur the input and close normally. Custom-keyboard opening needs no forced synchronous commit or input focus.
5. Preserve setting/policy changes that blur native input when custom mode becomes active.

### B. Native host pointer behavior

1. Give the native input wrapper a stable marker such as `data-native-keyboard-input`.
2. Prefer a wrapping `<label>` (or equivalent explicit forwarding) so tapping wrapper padding natively focuses the contained input.
3. In `guardPanelPointer`, detect a target inside this marked host. Stop propagation but do not call `preventDefault`; this preserves label/input default focus behavior.
4. Retain prevent-default and propagation guards for every other panel target so custom/special keys do not return focus to xterm.

### C. Input-event normalization

1. Make `beforeinput` authoritative for mobile edits when `InputEvent.inputType` is recognized:
   - `insertText` with non-null data -> emit that text and prevent the matching DOM mutation.
   - `deleteContentBackward` -> emit `"\x7f"` and prevent mutation.
   - `insertLineBreak` or `insertParagraph` -> emit `"\r"` and prevent mutation.
2. Keep keydown as desktop/legacy fallback only for identified `Backspace` and `Enter`. Prevent default there so a second beforeinput path cannot emit the same action.
3. Track composition explicitly. During composition/interim `insertCompositionText`, neither emit nor clear/reset the input. On composition end, emit committed Unicode once, then reset the proxy buffer only after composition has completed.
4. Retain a narrow input/change fallback for unhandled text insertion if needed by React/browser compatibility. Deduplicate events already consumed by beforeinput/composition and never clear `event.target.value` on each change.
5. Reset adapter refs/value on completed commit, close/unmount, or session-independent input reset without dispatching terminal bytes.
6. Remove obsolete `keyboardValueRef` and DOM event imports/handlers from the accessory bar once the adapter owns them.

## Event invariants

| Gesture/event | Output | Buffer/default behavior |
|---|---|---|
| Desktop letter | Character once | beforeinput consumed; stable proxy value |
| Android keydown `Unidentified` + `insertText` | Text once | beforeinput handles it |
| Android `deleteContentBackward` | `DEL` (`\x7f`) once | prevent DOM delete |
| Mobile line break/paragraph | `CR` (`\r`) once | prevent DOM insertion |
| Composition updates | Nothing | browser may maintain interim value |
| Composition end | Final Unicode once | clear only after commit |
| Desktop Backspace/Enter keydown | DEL/CR once | keydown prevented; no duplicate beforeinput |

## Success criteria

- Opening native Type leaves `document.activeElement` on the input before the interaction completes.
- Clicking/tapping input padding focuses or retains the input and does not propagate to the terminal host.
- Plain, Android-style unidentified, and composed Unicode text reach the active session once.
- Backspace and Enter work through both identified keydown fallback and mobile beforeinput.
- No per-keystroke composition-buffer clearing; no new global state or transport policy.

## Risks

| Risk | Mitigation |
|---|---|
| React synthetic beforeinput differs by browser | Read `nativeEvent` as `InputEvent`; retain narrow fallback and prove behavior in real Chromium. |
| Composition end followed by another insert event duplicates text | Mark the committed composition/event and assert exact call count with a realistic sequence. |
| `flushSync` expands into general synchronous rendering | Limit it to closed -> open native transition required to mount before focus. |
| Padding exemption weakens host isolation | Exempt only descendants of the marked native host; always stop propagation. |

## Unresolved questions

None.
