# Code Review Summary: Phase 02 — Cognito State and Overlay

## Scope
- **Files reviewed:**
  - `packages/ui/src/stores/cognito-mode.ts` & `src/stores/cognito-mode.test.ts`
  - `packages/ui/src/components/organisms/CognitoModeOverlay.tsx` & `src/components/organisms/CognitoModeOverlay.test.tsx`
  - `packages/ui/src/hooks/use-cognito-mode-input-guard.ts` & `src/hooks/use-cognito-mode-input-guard.test.tsx`
  - `packages/ui/src/lib/cognito-mode-events.ts`
  - `packages/ui/src/index.css`
  - `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx`
  - `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` & `src/components/organisms/BrowserDebugKeepAliveHost.test.tsx`
- **Lines of code analyzed:** ~800 lines (code + tests + CSS)
- **Review focus:** Security, performance, architecture, KISS/YAGNI/DRY, focus/input containment, lifecycle cleanup, Phase 03 readiness
- **Updated plans:**
  - `plans/261001-2207-cognito-privacy-mode/phase-02-cognito-state-and-overlay.md`
  - `plans/261001-2207-cognito-privacy-mode/plan.md`

---

## Overall Assessment
- **Score:** 9/10
- Clean, minimal, high-standard implementation adhering strictly to YAGNI/KISS/DRY.
- Ephemeral in-memory Zustand store avoids accidental storage/token leaks.
- CSS overlay uses hardware-accelerated compositor filters, 0ms transitions, and fail-opaque black fallback.
- Window-capture listener pattern intercepts pointer, touch, mouse, wheel, drag, clipboard, IME, and focus events without allocating on inactive fast paths.
- Native Browser Debug host correctly unmaps viewport (`setViewport(null)`) without dropping connection or target.
- One warning identified for Phase 03 integration regarding focus restoration timing when parent container receives `inert`.

---

## Critical Issues
None.

---

## Warnings (High / Medium Priority)

### 1. [High Priority] Focus Restoration Race Condition with Phase 03 `[inert]` Container
- **Location:** `packages/ui/src/hooks/use-cognito-mode-input-guard.ts:142-155`
- **Problem:** When deactivating via `toggle()`, the Zustand subscriber fires synchronously. In Phase 03, app content will be wrapped in `<div data-cognito-mode-content inert={active}>`. Because React re-rendering is asynchronous/batched, the DOM still contains `inert` on `data-cognito-mode-content` at the exact moment the subscriber checks `!prior.closest("[inert]")`.
- **Impact:** `prior.closest("[inert]")` evaluates to true, causing the guard to permanently drop `priorFocusedElementRef.current` without calling `prior.focus()`. Additionally, HTML specs reject `.focus()` on descendants of inert elements.
- **Recommended Action:** Defer focus restoration until DOM reconciliation completes (e.g. `queueMicrotask` or `requestAnimationFrame`) and exempt `data-cognito-mode-content` from permanent inert filtering:
  ```ts
  } else if (!state.active && prevState.active) {
    const prior = priorFocusedElementRef.current;
    priorFocusedElementRef.current = null;
    if (prior && prior.isConnected) {
      queueMicrotask(() => {
        if (!prior.isConnected) return;
        const inertAncestor = prior.closest("[inert]");
        if (!inertAncestor || inertAncestor.hasAttribute("data-cognito-mode-content")) {
          try { prior.focus({ preventScroll: true }); } catch {}
        }
      });
    }
  }
  ```

### 2. [Medium Priority] Focus Sink Lookup Latency on Activation
- **Location:** `packages/ui/src/hooks/use-cognito-mode-input-guard.ts:138-141` & `packages/ui/src/components/organisms/CognitoModeOverlay.tsx:17-20`
- **Problem:** When toggled active, `document.querySelector("[data-cognito-mode-overlay]")` in the synchronous store subscriber returns `null` because `CognitoModeOverlay` renders `null` when inactive and has not yet mounted the portal. Focus is subsequently set by `CognitoModeOverlay`'s `useEffect`, creating a brief gap where focus rests on `document.body`. Unit test passed only because `sink` was manually pre-injected in `beforeEach`.
- **Impact:** Minor focus redirection window before React renders the portal.
- **Recommended Action:** Use `useLayoutEffect` in `CognitoModeOverlay` so focus attaches synchronously on portal DOM mount before browser paint.

---

## Suggestions (Low Priority Improvements)

### 1. [Medium] Add Dedicated Unit Test for `TerminalNotificationToastViewport` z-index Layering
- **Location:** `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx:95`
- **Suggestion:** Add a scoped test verifying `style.zIndex` toggles between `45` (inactive) and `10001` (active) when `useCognitoModeStore` state changes.

### 2. [Low] Add Iframe Fallback Viewport Test in `BrowserDebugKeepAliveHost.test.tsx`
- **Location:** `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx`
- **Suggestion:** While native `suppliedHost` is tested for `setViewport(null)` and restoration, adding an assertion for the iframe host path (`isViewportVisible={false}`) completes test symmetry.

---

## Positive Observations
1. **Z-Index Precision:** Clear, un-conflicted layering: standard toasts (45) < dialogs (50) < popovers (75) < context menus (100) < passphrase prompt (9999) < overlay mask (10000) < active toasts (10001).
2. **Gesture Latch & Trailing Consumption:** In-flight pointerdown during active state latches `gestureInFlightRef`; subsequent pointerup/click upon deactivation is captured and suppressed within a 300ms window, preventing accidental clicks on underlying controls.
3. **Accessibility:** Screen-reader description formats the frozen activation shortcut (`displayShortcut`) with fallback string; `tabIndex={-1}` and `role="region"` avoid unintended tab stop inclusion.
4. **Fail-Opaque Fallback:** `@supports ((-webkit-backdrop-filter: blur(40px)) or (backdrop-filter: blur(40px)))` safely defaults to solid `#000000` when backdrop filters are unsupported, preventing transparent content disclosure.
5. **No Ephemeral Leaks:** Activation shortcut freezes on toggle, resets completely on unmount, and avoids any localStorage or server persistence.

---

## Validation Metrics
- **TypeScript:** Pass (`pnpm --filter @dam-hopper/ui exec tsc --noEmit` — 0 errors)
- **Unit Tests:** Pass (4 files, 28 tests, 100% pass rate, 1.04s)
  - `src/stores/cognito-mode.test.ts`: 5 passed
  - `src/components/organisms/CognitoModeOverlay.test.tsx`: 7 passed
  - `src/hooks/use-cognito-mode-input-guard.test.tsx`: 7 passed
  - `src/components/organisms/BrowserDebugKeepAliveHost.test.tsx`: 9 passed
- **Todos in Plan:** 5/5 tasks completed in `phase-02-cognito-state-and-overlay.md`.

---

## Unresolved Questions
None.
