# Code Review: Floating Terminal Keyboard Input Fix

**Score:** 8.5/10
**Date:** 2026-09-20
**Reviewer:** KeyboardFixReviewer

## Code Review Summary

### Scope
- Files reviewed:
  - `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx`
  - `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx`
  - `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
  - `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx`
  - `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx`
  - `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx`
- Lines of code analyzed: ~519 lines modified/added across 6 files.
- Review focus: Floating terminal dismissal, custom-key activation deduplication, native keyboard mounting & synchronous focus, IME composition handling, pointer guards, unit & browser test suites.
- Updated plans:
  - `plans/260920-1044-floating-terminal-keyboard-fix/plan.md`
  - `plans/260920-1044-floating-terminal-keyboard-fix/phase-01-core-event-and-dismissal-fixes.md`
  - `plans/260920-1044-floating-terminal-keyboard-fix/phase-02-native-input-ime-and-focus.md`
  - `plans/260920-1044-floating-terminal-keyboard-fix/phase-03-testing-and-verification.md`

### Overall Assessment
Substantial, well-targeted bug fix resolving multi-layer event coordination issues on mobile and desktop surfaces:
- Event path traversal (`composedPath()`) cleanly resolves panel dismissal on React node re-renders.
- Custom keyboard single activation authority on `onClick` with `preventDefault()` on `pointerdown` eliminates race conditions and duplicate bytes.
- Native keyboard opening synchronously commits mounting with `flushSync` and acquires focus during user gesture, fixing the mobile virtual keyboard trigger issue.
- Decoupling DOM input logic into `MobileTerminalNativeKeyboardInput` with `onTerminalInput(sequence)` cleans up `MobileTerminalAccessoryBar`.

One significant edge-case bug identified in `MobileTerminalNativeKeyboardInput`: latching boolean flags (`beforeInputHandledRef`, `compositionCommittedRef`) remain set when `beforeinput` cancels DOM mutation or when no `input` event follows `compositionend`, silently swallowing subsequent inputs (such as paste, autofill, or voice typing).

---

### Critical Issues
None (no security vulnerabilities, data leaks, or fatal crashes).

---

### High Priority Findings

#### 1. Latching deduplication refs swallow subsequent paste and fallback inputs
- **File:** `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx:54, 96, 108-117`
- **Root cause:**
  - In `handleBeforeInput`:
    ```tsx
    if (event.cancelable) event.preventDefault();
    beforeInputHandledRef.current = true;
    onTerminalInput(data);
    ```
    When `event.preventDefault()` cancels the `beforeinput` event, the browser does NOT mutate the DOM and does NOT dispatch an `input` / `change` event.
    Consequently, `beforeInputHandledRef.current` remains `true` indefinitely.
  - When the user subsequently pastes text (which fires `beforeinput` with `inputType: "insertFromPaste"`, unhandled by `handleBeforeInput`), the browser mutates the input and fires `onChange`.
  - In `handleChange`:
    ```tsx
    if (beforeInputHandledRef.current) {
      beforeInputHandledRef.current = false;
      previousValueRef.current = event.target.value;
      return;
    }
    ```
    Because `beforeInputHandledRef.current` was still `true` from the previous keystroke, `handleChange` discards the entire pasted text!
  - The same bug applies to `compositionCommittedRef.current` when the browser does not dispatch an `input` event after `compositionend`.
- **Impact:** Any paste, voice input, autofill, or fallback input occurring after a normal typed character is silently dropped.
- **Fix:** Scope deduplication to the current microtask tick so synchronous `input` events are deduplicated while asynchronous future user actions are never suppressed:
  ```tsx
  // in handleBeforeInput:
  if (event.cancelable) event.preventDefault();
  beforeInputHandledRef.current = true;
  queueMicrotask(() => {
    beforeInputHandledRef.current = false;
  });
  onTerminalInput(data);

  // in handleCompositionEnd:
  if (data) {
    compositionCommittedRef.current = true;
    queueMicrotask(() => {
      compositionCommittedRef.current = false;
    });
    onTerminalInput(data);
  }
  ```

---

### Medium Priority Improvements

#### 2. Native input ignores `insertFromPaste` and `insertFromDrop` in `handleBeforeInput`
- **File:** `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx:49-75`
- **Root cause:** `handleBeforeInput` only checks `insertText`, `deleteContentBackward`, `insertLineBreak`, and `insertParagraph`. On mobile browsers, pasting triggers `beforeinput` with `inputType === "insertFromPaste"`.
- **Impact:** Paste falls through to DOM mutation and `handleChange` diffing, resulting in unneeded DOM churn and reliance on fallback diff logic.
- **Recommendation:** Intercept `inputType === "insertFromPaste"` in `handleBeforeInput` when `event.data` or clipboard data is available, or ensure the `handleChange` fallback is protected by the microtask fix above.

---

### Low Priority Suggestions

#### 3. Unused React type imports in test file
- **File:** `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx:4, 6`
- **Root cause:** `ChangeEvent` and `RefObject` imported from `"react"` are never used.
- **Impact:** Causes ESLint `@typescript-eslint/no-unused-vars` warnings.
- **Fix:**
  ```tsx
  import {
    act,
    type KeyboardEvent,
  } from "react";
  ```

#### 4. Browser test does not assert immediate focus on native keyboard open
- **File:** `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx:410-417`
- **Observation:**
  ```tsx
  await userEvent.click(
    page.getByRole("button", { name: "Open mobile keyboard" }),
  );
  const input = page.getByPlaceholder("Type for terminal");
  await input.fill("ls");
  expect(document.activeElement).toBe(
    document.querySelector('input[placeholder="Type for terminal"]'),
  );
  ```
  `input.fill("ls")` automatically focuses the input in testing-library / vitest, masking whether `click` synchronously focused the element.
- **Recommendation:** Add `expect(document.activeElement).toBe(input.element());` immediately following `userEvent.click` and prior to `input.fill("ls")`.

#### 5. Synchronous `requestAnimationFrame` stub in unit tests
- **File:** `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx:85-88`
- **Observation:** `requestAnimationFrame` is stubbed to run synchronously in all tests, which previously masked rAF-related focus deferral bugs. Unit test line 286 explicitly called `nativeInput?.focus()` manually instead of testing that the toggle opened and focused it.
- **Recommendation:** Verify focus directly after click in unit test without manual `nativeInput?.focus()`.

---

### Positive Observations
- **ComposedPath Inside Detection:** Using `event.composedPath()` in `TerminalFloatingControlShell.tsx` provides clean immunity against React DOM reconciliation node detachment.
- **Single Authority Button Activation:** Delegating all key actions in `MobileTerminalCustomKeyboard.tsx` to `<button onClick>` with pointerdown `preventDefault()` eliminates custom timing deduplication and supports assistive technologies naturally.
- **Synchronous FlushSync Opening:** Using `flushSync` specifically on the native open path ensures the input DOM is mounted and focused in the exact call stack of the user gesture, complying with iOS WebKit and Android Chrome user activation requirements.
- **Label Padding Focus Exemption:** Marking native host with `data-native-keyboard-input` and checking `target?.closest("[data-native-keyboard-input]")` restores native label-to-input focus delegation without leaking pointerdown to the underlying xterm canvas.
- **Accessibility & Terminal Guarding:** Native input correctly disables autocorrect, autocomplete, autocapitalize, and spellcheck, which protects command line tokens from external spellcheck transmission.

---

### Recommended Actions
1. **Fix Deduplication Ref Leaks:** Add `queueMicrotask` resets for `beforeInputHandledRef.current` and `compositionCommittedRef.current` in `MobileTerminalNativeKeyboardInput.tsx`.
2. **Clean Up Lint Warnings:** Remove unused `ChangeEvent` and `RefObject` imports from `MobileTerminalAccessoryBar.test.tsx`.
3. **Add Paste Regression Test:** Add a test verifying paste after typed characters in `MobileTerminalAccessoryBar.test.tsx`.
4. **Harden Immediate Focus Assertion:** Assert `document.activeElement` immediately after keyboard open click in `mobile-terminal-accessory-bar.browser.tsx`.

---

### Metrics
- **Type Coverage:** 100% (Strict TypeScript build passing, zero `any` additions).
- **Test Results:**
  - Unit tests (`MobileTerminalAccessoryBar.test.tsx`): 11/11 passed (538ms).
  - Browser tests (`mobile-terminal-accessory-bar.browser.tsx`): 10/10 passed (5.83s in Chromium).
- **TypeScript Build:** Passed (`tsc -p tsconfig.json` clean).
- **Linting Issues:** 2 warnings (`ChangeEvent`, `RefObject` unused in `MobileTerminalAccessoryBar.test.tsx`).

---

### Unresolved Questions
None.
