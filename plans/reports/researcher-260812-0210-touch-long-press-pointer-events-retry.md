# Research Report: Pointer Events touch long-press to existing context menus

**Timestamp:** 2026-08-12 02:17 +07 (Asia/Saigon)
**Repository:** `/mnt/data/ws/sharing/dam-hopper/.worktree`
**Branch:** `feat/touch-long-press-right-click`
**Mode:** read-only source/repository review; report-only change.

## Executive summary

Do **not** add a generic long-press timer to the shared wrapper. The repository already routes Explorer rows and editor tabs through Radix `ContextMenu.Trigger`; current Radix Context Menu implements non-mouse long-press itself (700 ms, pointer movement/cancel/up cancellation, `contextmenu` fallback). A second timer would race Radix and any browser-generated `contextmenu`, causing duplicate opens, wrong anchors, or a later click/action.

Use Pointer Events as the input observation model only where a surface is not already a Radix trigger. Keep the existing `contextmenu` action path as the single opener: one marked Radix trigger, one menu Root, one timer at most. Preserve `touch-action`/scrolling, text selection, keyboard ContextMenu/Shift+F10, Radix focus/dismissal, Arborist dragging, and Monaco caret/selection. `pointercancel`, `pointerup`, `lostpointercapture`, unmount, and movement must terminate any custom gesture.

The important platform split is not Pointer Events availability: modern Chromium Android and iOS Safari both support Pointer Events. The split is browser-generated `contextmenu`: Chromium Android may emit it for a long press; current MDN compatibility data records iOS Safari `contextmenu` as unsupported (WebKit bug 213953). Therefore a marked Radix trigger must rely on its own timer on iOS, while also accepting and deduplicating Chromium's native event. Monaco content is currently not a menu consumer; the global suppression hook prevents its unmarked `contextmenu`, so Monaco scope needs a product decision rather than an invented menu.

## Source/method

Cross-checked official/current material on 2026-08-12:

- W3C Pointer Events Level 4: pointer cancellation, capture, `touch-action`, compatibility mouse events, and event-order caveats.
- MDN Pointer Events, `setPointerCapture()`, `touch-action`, and `contextmenu` references plus MDN Browser Compatibility Data (BCD).
- WebKit's Safari 13 release note for Pointer Events on iOS/iPadOS and feature-detection guidance.
- Playwright Emulation and Touchscreen documentation.
- Local React/Radix source, lockfile, tests, architecture docs, and existing scout reports.

The relevant URLs are listed in [References](#references). Standards define event semantics, not a universal long-press duration or movement tolerance.

## Findings and guidance

### 1. Correct event model

A touch contact begins with `pointerdown` (`pointerType === "touch"`); movement arrives as `pointermove`; termination is normally `pointerup`, but the browser can issue `pointercancel` when it takes the gesture for panning/zooming, opens a modal/menu, or otherwise stops delivering the stream. Check `isPrimary` and track one active `pointerId`; ignore additional fingers for a single-finger context menu.

Pointer capture retargets subsequent events to the trigger even when the contact leaves its hit-test box. Pointer Events specifies implicit capture for direct-manipulation touch/pen targets, and implicit release immediately after `pointerup` or `pointercancel`. Explicit capture is therefore usually unnecessary for a simple hold. If a custom bridge explicitly calls `setPointerCapture(event.pointerId)`, release it on every terminal path (guard with `hasPointerCapture()` or catch an inactive-pointer `NotFoundError`) and listen for `lostpointercapture` as a final cleanup signal. Never leave a timer keyed only by a DOM node; key it by the active pointer and invalidate it on unmount.

For a surface that genuinely needs a bridge:

```text
pointerdown (touch/pen, primary)
  -> record target + client coordinates + pointerId
  -> optionally setPointerCapture; start one timer
pointermove
  -> cancel if movement exceeds policy threshold
pointercancel | pointerup | lostpointercapture | unmount
  -> clear timer and active state
contextmenu (native or synthetic)
  -> clear timer; accept at most one open for this pointer
long-press timeout
  -> dispatch/open the existing marked Radix menu once
```

Do not use `touchstart`/`touchend` in parallel with Pointer Events. That creates duplicate paths on engines exposing both models.

### 2. Timer and movement policy

- W3C does not prescribe a long-press delay or movement threshold.
- The local Radix implementation is the simplest policy for existing triggers: it starts a **700 ms** timer for non-mouse pointer down, cancels on `pointermove`, `pointercancel`, and `pointerup`, and clears the timer when `contextmenu` is received. It opens directly at the recorded point when the timer expires; it does not need a synthetic `contextmenu` for its own timer path. Official Radix source: <https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/context-menu/src/context-menu.tsx>.
- Radix's current behavior cancels on any `pointermove`, so tiny finger jitter can cancel. That is an observed library policy, not a platform requirement. Do not add a threshold merely to compensate without testing; changing the shared behavior affects every trigger.
- If an unwrapped surface later requires a bridge, choose one documented policy (for example, an 8 CSS-pixel Euclidean movement threshold, measured from `pointerdown`; cancel on either axis/distance) and test it on small and large phones. Avoid device-pixel scaling and avoid multiple thresholds. A threshold is useful for jitter but must not turn a scroll into a context action.
- On timeout set a `didLongPress`/once token. Clear that token after the matching `pointerup`/`contextmenu`; do not let a delayed native event open a second menu. If the browser's normal click compatibility path can still activate the target after a held contact, consume only that matching activation according to the target's existing behavior—not globally.
- Never let a timer callback act on a stale React render, detached trigger, or changed pointer. Store the current target/coordinates in refs and verify `isConnected`/pointer identity before opening.

### 3. `touch-action`, scrolling, selection, and accessibility

`touch-action` is the browser's pre-gesture declaration. W3C/MDN specify that the UA intersects the touched element and ancestors up to the scrolling element; changing it after a gesture starts is ineffective. If the UA takes a pan/zoom gesture, it may fire `pointercancel`. Pointer-event `preventDefault()` is not the replacement for `touch-action`.

Recommendations:

- Keep `auto` where normal scrolling, browser zoom, text selection, and OS gestures are needed.
- Use a narrowly scoped `pan-y`/`pan-x` only when the surface's known scroll axis requires it; apply it at the intentional gesture/scroll boundary, not globally. The repository already uses `touch-action: pan-y` narrowly for the xterm viewport (`packages/ui/src/index.css:112-118`); preserve it.
- Do **not** set global `touch-action: none`. It can disable page/tree/tab scrolling and pinch zoom, and it makes a hold recognizer responsible for behavior it does not implement.
- Do not call `preventDefault()` on every `pointerdown`/`pointermove` merely to “claim” long press. It can suppress scrolling, caret placement, selection, click activation, and accessibility/native callouts. Use cancellation state and the existing Radix path instead.
- Explorer rows and tabs already use `select-none`, which is appropriate for those controls. Do not copy that policy to Monaco content: Monaco needs caret placement and drag selection. Do not disable text selection/callouts on the editor to force a menu.
- A touch menu is supplemental. Retain mouse right-click, keyboard `ContextMenu` and Shift+F10, Escape/outside dismissal, and Radix focus restoration/roving focus. Radix provides the menu ARIA/focus contract; do not replace it with a timer-driven custom popup.
- With `ContextMenu.Trigger asChild`, the child must spread Radix props and forward its ref. A custom child that drops either contract loses pointer/context handlers, marker attributes, anchoring, and keyboard/focus behavior.

### 4. Browser `contextmenu` and mouse-event races

`contextmenu` is a `PointerEvent` inheriting `MouseEvent` in current MDN documentation. It can come from a right button, keyboard context-menu key, or a UA gesture. The W3C spec explicitly leaves high-level ordering variable: `contextmenu` can follow `pointerup`, precede `pointerup`/`pointercancel`, or occur without a pointer sequence. UA heuristics may omit it for a long press or after movement.

Compatibility mouse events are optional/heuristic and may be delayed or grouped until the UA decides whether a touch sequence is a gesture. Canceling `pointerdown` can suppress compatibility `mousedown`/`mouseup` events, but Pointer Events states that canceling a pointer event must not be used as a guarantee that `click`, `auxclick`, or `contextmenu` will not fire. Consequently:

- Do not open the app menu from both a long-press timer and `click`/`mousedown`/native `contextmenu` without a once-per-pointer dedupe token.
- Clear the timer on any native `contextmenu`; check `defaultPrevented` before forwarding/handling.
- Keep the app's existing `contextmenu` event path. A synthetic bridge event should be bubbling and cancelable and include right-button semantics, e.g. `MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX, clientY })`.
- Dispatching on an unmarked element is insufficient in this repository: document capture prevents it before Radix's handler. Dispatch to the actual marked Radix trigger, or use a controlled Radix Root/virtual anchor with an explicit policy.
- Do not stop propagation globally. The current suppression listener intentionally calls `preventDefault()` only and lets configured Radix handlers receive the event.

### 5. Chromium Android versus iOS Safari

| Concern | Chromium Android | iOS Safari/WebKit |
|---|---|---|
| Pointer Events | MDN BCD: Chrome 55; Android mirrors. Mature current path. | MDN BCD: Safari 13; iOS mirrors. WebKit announced Pointer Events for iOS/iPadOS 13. |
| `touch-action` | Supported since Chrome 36; modern values work, but still honor ancestor intersection and `pointercancel`. | Supported on iOS since 9.3; use feature detection and test actual Safari. New directional values are not a safe cross-engine assumption. |
| Long-press `contextmenu` | May produce a browser `contextmenu`/native menu after the platform delay; event order and delivery can vary. Radix timer plus native-event clearing must be idempotent. | Current MDN BCD records `Element.contextmenu` as unsupported on iOS Safari and links WebKit bug 213953. A long press can instead be handled by the timer or consumed by native text/link/image selection/callout. Never make iOS dependent on a browser `contextmenu`. |
| Selection/callouts | Android selection and browser menu behavior still compete with a hold; validate scroll and selection. | Native text-selection/callout behavior is especially important; do not blanket-prevent default on editor content. |
| Automation | Chromium mobile emulation plus a Chromium touch sequence can test app timers and event routing, but not every Android system menu. | Playwright WebKit/device emulation is not an iPhone Safari runtime and cannot prove iOS native callout/context-menu behavior. Require a physical iPhone/iPad or an iOS device-cloud run. |

Use feature detection (`PointerEvent`, `navigator.maxTouchPoints`, actual event observation), not UA sniffing. WebKit explicitly notes that iPad Safari can present desktop or mobile UA behavior and recommends responsive feature detection.

### 6. Playwright validation plan

Current browser configuration runs only Chromium (`packages/ui/vitest.browser.config.ts`, `instances: [{ browser: "chromium" }]`). Add focused coverage only when implementation scope is decided:

1. **Automated Chromium emulation:** configure a Playwright project/context with a device descriptor (for example Pixel/Android), `hasTouch: true`, mobile viewport, and `isMobile: true`; assert one menu, correct anchor, no duplicate open, timer cancellation on movement/up/cancel, and desktop mouse/keyboard regressions. Playwright's device emulation sets UA, viewport, screen size, and `hasTouch`; it is not a full OS simulation.
2. **Hold generation:** Playwright's public `Touchscreen` API is intentionally small (`tap`); a JS-dispatched pointer sequence is untrusted and tests application state only. For Chromium, a CDP `Input.dispatchTouchEvent` sequence or a real touch-capable runner can exercise more of the browser recognizer. Record which level each test proves; do not call synthetic events “real-device” coverage.
3. **Real Android:** run Chrome on a physical Android device (or device cloud), verify native `contextmenu`/pointer event ordering, scrolling, selection, and browser menu suppression. Include a narrow row, tab, and editor smoke path.
4. **Real iOS:** run Safari on physical iPhone/iPad; verify timer-open fallback because `contextmenu` may not exist, text selection/callouts, vertical/horizontal scrolling, menu anchoring near viewport edges, and keyboard/assistive-tech alternatives. Playwright WebKit is useful for DOM/layout smoke tests, not proof of iOS Safari behavior.
5. **Event trace:** in a temporary test harness log `pointerdown/move/up/cancel/gotpointercapture/lostpointercapture/contextmenu/click` with `pointerId`, `pointerType`, `defaultPrevented`, and timestamps. This makes browser-specific races observable instead of guessing.

Keep tests in existing suites (`packages/ui/browser-tests/consumer-context-menu.browser.tsx`, `global-native-context-menu-suppression.browser.tsx`, and `viewport-context-menu.browser.tsx`) and add unit coverage beside the shared hook only if a new bridge exists. No gesture dependency is justified.

## Repository mapping

### Shared Radix boundary

- `packages/ui/src/components/ui/ContextMenu.tsx:20-64` coordinates one open menu; `:67-110` wraps Radix Trigger with `asChild`, marks enabled triggers with `data-dam-hopper-context-menu-trigger`, and preserves keyboard ContextMenu/Shift+F10 by dispatching a bubbling `contextmenu` at the trigger center.
- `packages/ui/src/hooks/use-browser-context-menu-suppression.ts:8-23` installs a document capture listener that prevents every unmarked context menu. It does not stop propagation. This is why a browser-generated or synthetic event must target a marked trigger.
- `packages/ui/src/lib/context-menu-trigger-marker.ts:1-8` checks the composed path for that marker.
- Radix package declaration is `@radix-ui/react-context-menu: ^2.2.6` (`packages/ui/package.json`); the lockfile resolves the 2.3.x line. React 19/Vite are not blockers. Radix's built-in non-mouse long-press should remain the single implementation.

### Explorer / react-arborist

- `packages/ui/src/components/organisms/FileTree.tsx:148-207` renders virtualized rows and combines the Arborist `dragHandle` ref with the forwarded ref. The row spreads trigger props and is wrapped at the Tree render boundary (`:1023-1066`) by `TreeContextMenu`.
- `packages/ui/src/components/organisms/TreeContextMenu.tsx` is the existing file/folder action model. Reuse it; do not dispatch separate long-press actions.
- Risks: a wrapper that breaks the combined drag ref, long press that starts a drag, scroll cancellation, and undefined selection semantics for an unselected row or multi-selection. Language-filter mode intentionally returns the row without a context menu; do not broaden it accidentally.

**Recommendation:** leave the existing Radix composition unchanged and validate it on touch. If product requires selection-before-menu, define that separately; do not hide it in a gesture hook.

### Editor tabs

- `packages/ui/src/components/organisms/EditorTabs.tsx:200-252` wraps each tab in `ContextMenu.Root`/`ContextMenu.Trigger` and supplies `EditorTabContextMenu` (Close, Close Others, Close All).
- `packages/ui/src/components/molecules/EditorTab.tsx:31-62` forwards its ref and spreads DOM props, so it satisfies `asChild`.

**Recommendation:** no custom tab timer. Radix already maps touch hold to this exact existing menu. Preserve tab scrolling and keyboard tab semantics.

### Monaco editor content

- `packages/ui/src/components/organisms/MonacoHost.tsx:102-205` handles save, Git gutter mouse-down, blur, resize, shortcuts, and wheel zoom; no app context-menu consumer or long-press adapter exists.
- The active editor area is separate from the tab bar in `EditorTabs.tsx` (after the tab-bar block). Monaco's DOM is unmarked, so the global suppression hook prevents a `contextmenu` there.

**Recommendation:** treat Monaco text as a separate product scope. Do not map its hold to tab actions or invent text actions. If required, define actions/selection semantics first, then add a dedicated marked Radix consumer around `editor.getDomNode()` or an explicit Monaco bridge that preserves caret/selection/scrolling. Keep native text selection and keyboard accessibility.

## Recommended decision (YAGNI/KISS/DRY)

1. Existing Explorer rows and Editor tabs: **zero new long-press code**; Radix owns the timer and event race.
2. Verify ref/prop forwarding and marker behavior; add real touch validation, not another gesture abstraction.
3. Only for a proven unwrapped surface: one small, surface-local Pointer Events bridge, one timer, one movement policy, strict cleanup/dedupe, and one bubbling event into an existing marked Radix menu.
4. Do not modify global suppression, add a gesture package, add global `touch-action`, or touch server/native APIs.
5. Monaco content requires an explicit product/API decision before implementation.

## Review findings (severity and paths)

- **High if introduced — duplicate timer/event race:** `packages/ui/src/components/ui/ContextMenu.tsx:67-110`; adding a shared custom timer beside Radix's 700 ms timer can open twice or re-anchor incorrectly. Keep one owner.
- **High for Monaco expectations — no existing consumer plus global suppression:** `packages/ui/src/components/organisms/MonacoHost.tsx:102-205`, `packages/ui/src/hooks/use-browser-context-menu-suppression.ts:8-23`; Monaco touch hold currently has no app menu and unmarked native `contextmenu` is prevented. Scope must be decided.
- **Medium — unverified touch behavior:** `packages/ui/vitest.browser.config.ts` runs Chromium only; the repository roadmap/scout notes record touch long-press as untested in headless Linux. Emulation and physical Android/iOS checks remain.
- **Medium — jitter policy:** Radix cancels on any non-mouse `pointermove`; small touch movement may cancel the hold. This is acceptable for scroll safety but must be confirmed against product expectations before changing shared behavior.
- **Medium — Arborist integration:** `packages/ui/src/components/organisms/FileTree.tsx:148-207,1023-1066`; future wrappers must preserve `dragHandle` and forwarded refs and must not convert scrolling/dragging into menu actions.
- **Low — synthetic keyboard event completeness:** `packages/ui/src/components/ui/ContextMenu.tsx:90-97` currently omits `cancelable: true` and `button: 2` on its keyboard-generated `MouseEvent`. Current Radix opening works; hardening that unrelated contract is optional, not a long-press fix.

## Unresolved questions

1. Is scope Explorer rows and editor tabs only, or should Monaco text/preview surfaces also receive a menu?
2. If Monaco is in scope, which actions and selection/caret semantics should be exposed?
3. Should a long press on an unselected Explorer row select it first, and how should existing multi-selection behave?
4. Is Radix's fixed 700 ms / cancel-on-any-move policy acceptable, or is a product-approved threshold required?
5. Which physical browser versions, Tauri/WebView environments, and assistive-technology checks are release requirements?
6. Are native iOS text-selection/callout affordances expected to remain available on editor content?

## References

1. W3C Pointer Events Level 4 — <https://www.w3.org/TR/pointerevents4/> (capture, implicit release, `pointercancel`, `touch-action`, compatibility mouse events, event ordering).
2. MDN Pointer events — <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events>.
3. MDN `setPointerCapture()` — <https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture>.
4. MDN `touch-action` — <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action>.
5. MDN `contextmenu` event — <https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event>.
6. MDN BCD `PointerEvent` — <https://github.com/mdn/browser-compat-data/blob/main/api/PointerEvent.json> (Chrome 55 / Safari 13 baseline data).
7. MDN BCD `Element.contextmenu` — <https://github.com/mdn/browser-compat-data/blob/main/api/Element.json> (current iOS Safari unsupported entry and WebKit bug link).
8. MDN BCD `touch-action` — <https://github.com/mdn/browser-compat-data/blob/main/css/properties/touch-action.json>.
9. WebKit, “New WebKit Features in Safari 13” — <https://webkit.org/blog/9674/new-webkit-features-in-safari-13/> (Pointer Events on iOS/iPadOS and feature detection rather than UA assumptions).
10. Radix Context Menu docs — <https://www.radix-ui.com/primitives/docs/components/context-menu>.
11. Radix Composition / `asChild` — <https://www.radix-ui.com/primitives/docs/guides/composition>.
12. Radix current source — <https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/context-menu/src/context-menu.tsx>.
13. Playwright Emulation — <https://playwright.dev/docs/emulation>.
14. Playwright Touchscreen API — <https://playwright.dev/docs/api/class-touchscreen>.
15. WebKit bug linked by MDN for iOS `contextmenu` — <https://webkit.org/b/213953>.

## Conclusion

For the repository's current targets, the authoritative and lowest-risk answer is: **use the existing Radix trigger; do not implement another long-press recognizer**. Validate its 700 ms touch/pen path, cancellation, marker/suppression interaction, and real-device behavior. Keep Monaco out of scope until a real menu contract exists.
