# Phase 01 — Platform policy and root guard

## Context links

- [Plan](plan.md)
- `packages/ui/src/embed/dam-hopper-app.tsx:279-392`
- `packages/ui/src/hooks/use-coarse-pointer.ts`
- `packages/ui/src/components/pages/WorkspacePage.tsx:375-397`

## Overview

Priority: high · Status: pending · Owner: implementation agent

Add a pure, SSR-safe Android Chrome detector and a root policy/guard mounted inside `DamHopperApp` so lazy routes, setup, auth, settings, dialogs, and workspace surfaces share one decision. Do not use coarse-pointer/viewport as the global gate; those match touch-capable desktop and tablets.

## Key insights

- The web platform has no global keyboard-off switch.
- Disabled controls cannot receive focus; `inputmode="none"` alone is insufficient.
- A global keydown/preventDefault handler would not stop browser IME behavior and would break accessibility/shortcuts.
- Dynamic controls require a small MutationObserver or an equivalent centralized DOM policy.

## Requirements

- Detect Android Chrome only, excluding Android WebView and other Chromium browsers where practical; feature-detect browser globals.
- Lock text-editing controls (`input` text-like types and `textarea`) by preserving/restoring prior disabled state.
- Lock authored `contenteditable` regions; leave file, checkbox, radio, range, button, select, and other non-text controls usable.
- Blur an active editable before locking and reject/blur later focus attempts through a capture-phase `focusin` guard.
- Observe added nodes and relevant attribute changes without an observer loop.
- Expose `isAndroidChromeNativeInputSuppressed` for terminal/editor consumers.
- Render one dismissible, non-modal accessible notice explaining the limitation and the custom terminal-key alternative; do not steal focus.
- When a blocked autofocus/focus attempt occurs, retain or restore focus on a meaningful allowed control rather than leaving focus on `body`.

## Architecture

- Prefer a pure helper plus one hook/component, e.g. `is-android-chrome.ts` and `use-android-chrome-input-policy.ts`; keep policy state separate from DOM enforcement.
- Mount the guard around the app routes at the existing embed root. Preserve unrelated app-level guards.
- Mark managed nodes with an internal data attribute and use a `WeakMap` for restoration; never serialize or log input values.
- Do not disable file pickers or controls needed to operate the app shell.

## Related code files

- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/components/ui/Input.tsx`
- `packages/ui/src/components/ui/Textarea.tsx`
- New policy helper/hook tests under `packages/ui/src/lib` or `packages/ui/src/hooks`.

## Implementation steps

1. Add detector tests for Android Chrome, desktop Chrome, Edge/Opera/Samsung Browser, WebView, SSR, and missing `navigator`.
2. Add lock/unlock helpers for existing and dynamically inserted text controls.
3. Mount the guard at the app root and expose the policy state to consumers.
4. Add the reviewed non-blocking notice in the existing shell hierarchy; keep field-level descriptions limited to blocked task-critical surfaces.

## Todo list

- [ ] Decide exact UA-compatibility exclusions against supported browsers.
- [ ] Ensure cleanup restores desktop/test DOM state.
- [ ] Verify observer handles React-controlled `disabled` re-renders.
- [ ] Verify dialogs opened after initial mount are locked.

## Success criteria

- Android Chrome text controls are disabled/non-editable before user focus can open the IME.
- Dynamic/lazy controls follow the same policy.
- Non-text controls and file selection remain operable.
- Policy is inactive on desktop and non-target browsers.

## Risk assessment

High: this intentionally removes mobile editing across many features and user agents can be spoofed/reduced. Keep the detector narrow, expose state for diagnostics without user data, and document the limitation.

## Security considerations

Do not use UA strings as authorization. Do not capture keystrokes. Focus guards must not interfere with password values, auth flow, or file picker contents beyond preventing mobile text entry.

## Next steps

Wire the policy into terminal and editor behavior, then add browser and device validation.
