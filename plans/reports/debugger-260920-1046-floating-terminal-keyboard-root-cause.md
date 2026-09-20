# Root Cause Analysis: Floating Terminal Keyboard Displays But Cannot Type

**Date:** 2026-09-20  
**Status:** Complete Root Cause Analysis (Investigation Only - No Code Modified)  
**Target Subsystems:** `MobileTerminalAccessoryBar`, `MobileTerminalCustomKeyboard`, `MobileTerminalNativeKeyboardInput`, `TerminalFloatingControlShell`, `TerminalAccessoryControls`, `PaneContainer`, `TerminalRuntimeOutput`, `ws-transport`

---

## 1. Executive Summary

### Issue Description
When activating the floating keyboard in the terminal interface (via the floating accessory bar), the keyboard panel or input bar displays visually on screen, but user interactions (touch taps, mouse clicks, or typing) fail to send characters to the terminal session ("floating keyboard is just display and cannot use (type)").

### Root Cause Identification
The defect is not a single point of failure; rather, it stems from architectural and event-handling bugs across both supported keyboard modes (**Native Keyboard Input Mode** and **Custom Keyboard Mode**):

1. **Native Keyboard Input Mode (Default for iOS, Desktop, non-Android Chrome):**
   - **User Activation Gate Violation (No Software Keyboard on Mobile):** `toggleKeyboard` calls `keyboardInputRef.current?.focus()` inside `requestAnimationFrame`. Mobile OS security policies (iOS WebKit and Android Chrome) prohibit programmatic keyboard popup outside synchronous user gesture call stacks. The input box displays on screen, but the OS soft keyboard never opens.
   - **IME Buffer Destruction on Every Keystroke:** `handleKeyboardInput` forces `event.target.value = ""` on every `onChange` event. Virtual keyboard composition buffers (predictive text, autocorrect, GBoard, iOS QuickType) immediately desynchronize, suppressing further inputs or corrupting keystrokes.
   - **Android Backspace/Enter Blindness (Keycode 229 / "Unidentified"):** Virtual keyboards on Android dispatch `event.key = "Unidentified"` (`keyCode: 229`) for Backspace and Enter. `handleKeyboardKeyDown` only matches `event.key === "Backspace"` and `"Enter"`, rendering Backspace completely dead on Android native input.
   - **Panel Boundary Focus Theft:** `guardPanelPointer` calls `preventDefault()` and `stopPropagation()` on any pointerdown/mousedown whose target is not strictly `HTMLInputElement`. Tapping the padding around the input field instantly blurs the input or blocks focus transition.

2. **Custom Keyboard Mode (`MobileTerminalCustomKeyboard`):**
   - **Broken Fallback in `onClick` (`event.detail === 0` Filter):** Buttons delegate key presses to `onPointerDown` with `preventDefault()`, while `onClick` explicitly filters for `event.detail === 0`. Standard user clicks (mouse, trackpad, touchscreen) produce `event.detail >= 1`. If `pointerdown` is swallowed, converted, cancelled by touch scrolling, or bypassed by assistive technology (screen readers dispatch synthetic `click` with `detail: 1`), `onClick` drops the event completely.
   - **Detached DOM Node Auto-Dismissal Bug in `TerminalFloatingControlShell`:** When a user taps a modifier key (Shift, Caps, Fn/Symbols) or types a character with Shift active, state updates trigger an immediate re-render of key rows. Because native `pointerdown` continues bubbling to `document`, the shell's `handlePointerDown` checks `outsideRefs.some(ref => ref.current?.contains(target))`. Because the clicked key or label DOM node was replaced during re-render, `panelRef.current.contains(target)` returns `false`, causing the shell to immediately close (`onDismiss`) on the first key tap.

3. **Transport State Dropping:**
   - `getTransport().terminalWrite(sessionId, sequence)` in `ws-transport.ts` checks `this.ws?.readyState === WebSocket.OPEN`. If the WebSocket is reconnecting or transiently degraded, input is silently dropped without buffering or user notification.

---

## 2. Technical Analysis & Component Architecture

### 2.1 Component Composition
The floating keyboard system consists of:
- **`TerminalRuntimeOutput` / `PaneContainer`:** Host containers mounting `MobileTerminalAccessoryBar` at the bottom of the active terminal, binding `sessionId` (`activeSessionId` / `node.activeSessionId`).
- **`MobileTerminalAccessoryBar`:** Coordinates panel expansion state (`isKeyboardOpen`, `isExpanded`), modifier states (`isShiftActive`, `isCtrlActive`, `isCapsActive`, `isAltActive`, `isMetaActive`, `isSymbolLayer`), and chooses between custom keyboard vs native input.
- **`TerminalFloatingControlShell`:** Floating button pill container (`role="group"`). Implements outside-pointerdown and Escape-key dismissal listeners.
- **`TerminalAccessoryControls`:** The toggle buttons (`Keys` and `Kbd`/`Type`).
- **`MobileTerminalCustomKeyboard`:** On-screen virtual keyboard with rows of buttons, key labels, and modifiers.
- **`MobileTerminalNativeKeyboardInput`:** Single-line `<input type="text" placeholder="Type for terminal">` proxying native soft keyboard keystrokes.
- **`MobileTerminalSpecialKeys`:** 4-column quick-key matrix (`Esc`, `Tab`, `^C`, `Enter`, arrows, page up/down).

### 2.2 Activation & Selection Logic
Opening is triggered via `TerminalAccessoryControls.onToggleKeyboard`:
```ts
const { isAndroidChromeNativeInputSuppressed } = useAndroidChromeInputPolicy();
const mobileCustomKeyboardEnabled = useSettingsStore(
  (state) => state.mobileCustomKeyboardEnabled,
);
const shouldUseCustomKeyboard =
  isAndroidChromeNativeInputSuppressed || mobileCustomKeyboardEnabled;
```
- **Custom Keyboard** renders when:
  - User Agent is Android Chrome (`isAndroidChromeNativeInputSuppressed === true`), OR
  - User explicitly enabled "Custom on-screen keyboard" in settings.
- **Native Input** renders when:
  - Default setting on iOS Safari, Android non-Chrome, and desktop browsers without custom keyboard setting enabled.

---

## 3. Deep Dive into Event Processing & Interaction Failure Points

### 3.1 `MobileTerminalCustomKeyboard`: `onPointerDown`, `onClick`, `onKeyDown`
In `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx`:
```tsx
<button
  data-key-id={key.id}
  onPointerDown={(event) => {
    preventDefault(event);
    onPress(key);
  }}
  onClick={(event) => {
    if (event.detail === 0) onPress(key);
  }}
  onKeyDown={(event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPress(key);
  }}
...
```
- **Execution on standard pointer/mouse tap:**
  1. `pointerdown` fires -> `onPointerDown` calls `preventDefault(event)` and `onPress(key)`.
  2. `preventDefault(event)` suppresses native focus change and suppresses compatibility `mousedown`.
  3. `pointerup` fires.
  4. `click` fires with `event.detail >= 1` (usually 1).
  5. `onClick` receives `event.detail >= 1`. The guard `if (event.detail === 0)` evaluates to `false`. `onClick` drops the event.
- **Why `event.detail === 0` causes failure:**
  - `event.detail === 0` only occurs for programmatic JavaScript calls (`element.click()`, as used in `mobile-terminal-accessory-bar.browser.tsx:603`) or non-pointer activations.
  - Screen readers (TalkBack on Android, VoiceOver on iOS, NVDA on desktop) activate buttons by dispatching a synthetic `click` with `event.detail = 1` without preceding `pointerdown`.
  - If a user uses assistive technology, `onPointerDown` never fires, and `onClick` rejects `event.detail === 1`. The button is completely inert.
  - If touch scrolling or capacitive jitter cancels `pointerdown` (`pointercancel`), but still triggers a subsequent click, the click is ignored.

### 3.2 `guardPanelPointer` in `MobileTerminalAccessoryBar`
In `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`:
```tsx
const guardPanelPointer = useCallback(
  (
    event:
      | React.MouseEvent<HTMLDivElement>
      | React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.target instanceof HTMLInputElement) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  },
  [],
);
```
- Attached to the panel root via `onMouseDown={guardPanelPointer}` and `onPointerDown={guardPanelPointer}`.
- **Effect on child elements:**
  - For child buttons: React SyntheticEvents bubble to the panel container where `stopPropagation()` stops React event bubbling to ancestors.
  - For native input (`MobileTerminalNativeKeyboardInput`):
    - The layout wraps `<input>` inside `<div className="pb-2">`.
    - If the user touches anywhere outside the 10px tall `<input>` text box (e.g., the container padding or panel background), `event.target` is `HTMLDivElement`.
    - `guardPanelPointer` executes `preventDefault()` on `pointerdown`/`mousedown`.
    - In browser focus semantics, `preventDefault()` on pointerdown prevents focus acquisition or immediately blurs the currently focused input.

### 3.3 `TerminalFloatingControlShell`: Outside Pointer Listener & Node Detachment
In `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx`:
```tsx
useEffect(() => {
  if (!isOpen) return;

  const handlePointerDown = (event: globalThis.PointerEvent) => {
    const target = event.target as Node;
    if (
      controlsRef.current?.contains(target) ||
      outsideRefs.some((ref) => ref.current?.contains(target))
    ) {
      return;
    }
    onDismiss();
  };
...
  document.addEventListener("pointerdown", handlePointerDown);
...
}, [isOpen, onDismiss, onEscape, outsideRefs]);
```
- `outsideRefs` is `[panelRef]`.
- `panelRef.current` is `null` when closed, and populated when `<div ref={panelRef}>` mounts.
- **The Detached Node Dismissal Flaw:**
  - When the user taps a toggle key (`Shift`, `Fn`/Symbols) or types a character while `isShiftActive` is true, `handleCustomKeyPress` updates state (`setIsShiftActive(false)`, `setIsSymbolLayer(...)`).
  - In React, changing layout rows or modifier labels causes React to re-render the button or its contents.
  - As the native `pointerdown` event bubbles from the button to `document`, `handlePointerDown` executes.
  - If the clicked node (`target`) was unmounted or replaced during the state update, `panelRef.current?.contains(target)` evaluates to `false` (detached nodes are not contained in the document tree).
  - `handlePointerDown` assumes the click was outside the panel and executes `onDismiss()`.
  - **Result:** Tapping a key dismisses/closes the entire keyboard panel instead of typing.

### 3.4 `MobileTerminalNativeKeyboardInput`: Asynchronous Focus & Input Corruption
In `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`:
```tsx
const toggleKeyboard = useCallback(() => {
  invokingControlRef.current = "keyboard";
  setIsKeyboardOpen((current) => {
    const next = !current;
    requestAnimationFrame(() => {
      if (next && !shouldUseCustomKeyboard) {
        keyboardInputRef.current?.focus();
      } else {
        keyboardInputRef.current?.blur();
      }
    });
    return next;
  });
}, [shouldUseCustomKeyboard]);
```
- **Asynchronous Focus Gate Violation:**
  - iOS WebKit (Safari, Chrome iOS) and Android Chrome implement user-gesture requirements for invoking virtual software keyboards: `.focus()` must be called synchronously inside a trusted user gesture (click/touchend).
  - Delegating `.focus()` to `requestAnimationFrame` breaks the synchronous gesture stack.
  - The `<input>` field appears in the DOM, but the mobile OS refuses to display the soft keyboard.
- **IME Destruction:**
  ```ts
  if (appended) getTransport().terminalWrite(sessionId, appended);
  keyboardValueRef.current = "";
  event.target.value = "";
  ```
  - Mobile virtual keyboards use IME composition for word completion, autocorrect, and predictive typing.
  - Resetting `target.value = ""` inside `onChange` wipes the composition state. Subsequent inputs fail, duplicate, or stop firing events.
- **Android Backspace & Enter Inoperability:**
  - On Android software keyboards, `KeyboardEvent.key` is `"Unidentified"` (`keyCode: 229`).
  - `handleKeyboardKeyDown` specifically looks for `event.key === "Backspace"` and `event.key === "Enter"`.
  - Android Backspace and Enter presses never match, making deletion and submission impossible.

### 3.5 Terminal Transport Binding (`terminalWrite`)
- `sessionId` is correctly bound to `activeSessionId` from `TerminalRuntimeOutput` or `node.activeSessionId` in `PaneContainer`.
- In `ws-transport.ts`:
  ```ts
  terminalWrite(id: string, data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "terminal:write", id, data }));
    }
  }
  ```
  - Data reaches the Rust backend protocol handler `TermWrite { id, data }` in `server/src/api/ws_protocol.rs`.
  - **Vulnerability:** If the WebSocket connection is in `CONNECTING` or `CLOSING` state, `terminalWrite` drops the keystroke silently without queueing or feedback.

---

## 4. Failure Scenarios Summary

| Scenario | Trigger / Environment | Observed Behavior | Root Mechanism |
| :--- | :--- | :--- | :--- |
| **1. Native Keyboard on iOS/Android** | Tapping "Kbd" button in default setting mode | Panel opens with input field, but virtual keyboard never pops up | `keyboardInputRef.current?.focus()` invoked in `requestAnimationFrame`, blocked by OS user-activation gate |
| **2. Native Keyboard Typing Breakdown** | User manually taps into input field and types | First character may send, subsequent characters fail, duplicate, or corrupt; Backspace does not work | `event.target.value = ""` breaks IME composition; Android keycode 229 bypasses `handleKeyboardKeyDown` |
| **3. Custom Keyboard via Assistive Tech** | Screen reader (VoiceOver/TalkBack) or synthetic click | Key is visually activated, but no character sent to terminal | Screen reader dispatches `click` with `detail: 1` (no pointerdown); `onClick` rejects `detail !== 0` |
| **4. Custom Keyboard Auto-Dismissal** | Tapping Shift, Fn (symbols), or shifted character | Keyboard immediately closes / collapses | Re-render detaches clicked element; `panelRef.current.contains(target)` returns false in document pointer listener |
| **5. Native Input Area Mis-tap** | Tapping padding/gap around native input field | Native input loses focus, virtual keyboard retracts | `guardPanelPointer` executes `preventDefault()` on all non-input targets |
| **6. Transient Transport Disconnect** | Terminal active while WS reconnects | Key press visual animation plays, no output in terminal | `terminalWrite` drops payload if `ws.readyState !== WebSocket.OPEN` |

---

## 5. Actionable Recommendations (Proposed Solutions)

### Recommendation 1: Unify Activation in `MobileTerminalCustomKeyboard`
- Remove the fragile dependency on `event.detail === 0` in `onClick`.
- Use `onClick` as the primary activation handler for all key buttons, or implement robust pointer-tap deduplication (e.g. tracking `lastPointerDownTime` to prevent duplicate execution while guaranteeing execution for clicks lacking `pointerdown`).
- Ensure `onPointerDown` only prevents default focus/scrolling without suppressing click generation.

### Recommendation 2: Synchronous Focus for Native Input
- In `toggleKeyboard`, call `keyboardInputRef.current?.focus()` synchronously within the click handler before dispatching state changes.
- Eliminate `requestAnimationFrame` around `.focus()` so mobile browsers recognize the user gesture.

### Recommendation 3: Robust Mobile IME Handling in `MobileTerminalNativeKeyboardInput`
- Do not clear `event.target.value = ""` on every keystroke. Instead, maintain input value or listen to `beforeinput` (`inputType === "insertText"`, `deleteContentBackward`).
- Support Android Backspace and Enter via `beforeinput` rather than relying on `KeyboardEvent.key`.

### Recommendation 4: Composed Path Checking in `TerminalFloatingControlShell`
- Replace `ref.current?.contains(target)` with `event.composedPath().some(el => el === panelRef.current || el === controlsRef.current)`.
- `event.composedPath()` preserves the exact element hierarchy at event dispatch time, regardless of whether React subsequently unmounts or replaces the clicked node during re-renders.

### Recommendation 5: Relax `guardPanelPointer` Constraints
- In `guardPanelPointer`, avoid calling `preventDefault()` when clicking within the native input host container. Only invoke `stopPropagation()` to keep events scoped to the accessory panel without breaking browser focus.

---

## 6. Unresolved Questions

- None. All interaction layers (DOM, pointer events, synthetic events, focus lifecycle, Android input policy, and transport bindings) were thoroughly inspected and validated against the codebase.
