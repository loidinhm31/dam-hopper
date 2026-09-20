---
title: "Floating Terminal Keyboard Input Fix"
description: "Restore reliable custom-key taps and native mobile text entry without accidental panel dismissal or loss of user activation."
status: completed
priority: P1
effort: 6h
branch: main
tags: [bugfix, frontend, terminal, mobile, accessibility]
created: 2026-09-20
---

# Floating Terminal Keyboard Input Fix

## Overview

Fix both terminal Type paths. Custom keys must survive state-driven DOM replacement and activate once from touch, mouse, keyboard, or assistive click. Native Type must focus inside the opening gesture and translate modern mobile/IME input events into terminal bytes without destroying composition state.

This is a focused UI bug fix. No transport buffering, backend/protocol work, layout redesign, new dependency, or settings change.

## Root causes

- Document-level outside detection inspects detached `event.target` nodes after a key-triggered React render.
- Custom keys execute on `pointerdown`, then discard ordinary `click` events with `detail >= 1`.
- Native input mounts after state change but focus is deferred to `requestAnimationFrame`, outside mobile user activation.
- Panel guards prevent default on native-input padding; native handlers clear the DOM value during every change and depend on `KeyboardEvent.key` values Android often reports as `Unidentified`.

Source: [root-cause report](../reports/debugger-260920-1046-floating-terminal-keyboard-root-cause.md).

## Phases

| # | Phase | Goal | Status | Effort |
|---|---|---|---|---:|
| 01 | [Core event and dismissal fixes](./phase-01-core-event-and-dismissal-fixes.md) | Stable inside/outside detection; exactly-once custom-key activation | Complete | 1.5h |
| 02 | [Native input, IME, and focus](./phase-02-native-input-ime-and-focus.md) | Gesture-safe focus; padding focus; `beforeinput`/composition translation | Complete | 2.5h |
| 03 | [Testing and verification](./phase-03-testing-and-verification.md) | Durable jsdom/Chromium regressions and TypeScript gate | Complete | 2h |

## Delivery contract

1. Phase 01 and Phase 02 may proceed independently; Phase 03 validates their integrated event ordering.
2. Preserve authenticated `terminalWrite(sessionId, sequence)` routing and existing modifier/layout semantics.
3. A physical action emits at most one sequence. Outside pointer and Escape dismissal remain functional.
4. Native focus occurs synchronously in the trigger event after the conditional input is committed; no `requestAnimationFrame` focus.
5. IME interim composition emits nothing and is never cleared; committed text emits once. Android-style `beforeinput` Backspace/Enter work even with unidentified keydown.
6. Existing terminal geometry, safe-area behavior, panel coexistence, and focus restoration remain unchanged.

## Scope

**Modify:**
- `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx`
- `packages/ui/src/components/organisms/MobileTerminalCustomKeyboard.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
- `packages/ui/src/components/organisms/MobileTerminalNativeKeyboardInput.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx`
- `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx`

**Out of scope:** `MobileTerminalSpecialKeys`, WebSocket replay/queueing, terminal protocol, keyboard layouts, visual redesign, analytics, and new input abstractions beyond the native event adapter. Existing architecture docs already describe the intended focusable/input-preserving behavior; this fix restores that contract, so no architecture change is required.

## Risks and controls

- Duplicate bytes from overlapping keydown/beforeinput/composition paths: define one authoritative path per event and assert exact call counts.
- Conditional input absent at focus time: synchronously commit only native opening, then focus before returning from the user handler.
- `preventDefault` changes re-focus xterm: retain prevention for custom/special buttons; exempt only the marked native-input host.
- Browser automation cannot prove OS keyboard appearance: automate focus/event contracts, then include an iOS/Android device smoke checklist.

## Unresolved questions

None.

## Review Status and Next Steps

- **Phase 01 Status (Complete):** ComposedPath inside detection implemented and verified.
- **Phase 02 Status (Complete):** Synchronous flushSync focus, beforeinput normalization, microtask reset, and label padding protection implemented and verified.
- **Phase 03 Status (Complete):** Unit suite (12/12), browser suite (10/10), package unit suite (1837/1837), package browser suite (214/214), and UI TypeScript build all passed. Code review scored 8.5/10 with 0 critical issues. Advisor checkpoint review:hard-fix completed.
