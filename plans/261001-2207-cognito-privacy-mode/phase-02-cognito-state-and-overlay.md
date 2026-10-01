# Phase 02 — Cognito state and overlay

## Context links

- [Overview](./plan.md), [preference contract](./phase-01-config-and-schema.md), [keyboard owner](./phase-03-global-shortcuts-and-terminal-integration.md), [qualification](./phase-05-qualification-and-smoke.md).
- [App root](../../packages/ui/src/embed/dam-hopper-app.tsx), [toast viewport](../../packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx), [Dialog](../../packages/ui/src/components/ui/Dialog.tsx), [ContextMenu](../../packages/ui/src/components/ui/ContextMenu.tsx).
- [Zoom owner](../../packages/ui/src/contexts/AppZoomContext.tsx), [native Browser adapter](../../packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx), [viewport sizing styles](../../packages/ui/src/index.css).

## Overview

- Date: 2026-10-01. Priority: P2. Status: pending. Effort: 7h.
- Add ephemeral privacy state, immediate full-viewport visual mask and input/focus isolation without unmounting productive surfaces.

## Key Insights

- A high z-index only blocks normal hit-testing; it does not stop keyboard input into a previously focused xterm textarea/Monaco editor, document shortcuts, body portals or focus restoration.
- `Dialog` includes Escape/outside-dismissal and a close button; do not use it as the Cognito mask. Its focus scope also requires qualification with an already-open modal.
- Current toasts use z-index 45, dialogs 50, popovers 75–80 and context menus 100. Body portal avoids clipping/backdrop-filter ancestors; toast elevation must be explicit.
- App zoom applies to `document.documentElement`, not just app contents. Even a body portal inherits that zoom. Existing app viewport CSS variables must cover every zoom level.
- Native Browser Debug owns a separate child surface. DOM blur/z-index cannot cover it; existing `setViewport(null)` visibility path is necessary.

## Requirements

- Initial state inactive; every reload initializes inactive. No Zustand persist middleware, local/session storage, server write, URL field or cross-tab broadcast for activation.
- One synchronous boolean toggle; same frozen activation chord dismisses. No click, Escape, timeout, close affordance or automatic dismissal on navigation/disconnection.
- Keep terminal/editor/routes, bridges, media and notification services mounted. No PTY detach, output pause, renderer replacement, editor model dispose or background-job cancellation.
- Heavy Blur: full-viewport frosted overlay with `backdrop-filter: blur(40px)` plus a substantial neutral dark tint, zero transition. Black Screen: opaque `#000`, no text/branding/gradient or opacity transition.
- Unsupported backdrop-filter uses opaque black to avoid clear-content exposure; retain user's Heavy Blur preference. This CSS fallback does not add a third configurable style.
- Toasts remain visible above either visual base and expire as usual; all their clicks/keys are blocked while masked. Audio unchanged. This is an explicit notification exception to blackout, not total suppression.
- App content becomes `inert` while masked and is hidden from assistive-tech navigation without hiding toast announcements. Capture guards protect app portals outside that subtree and any programmatic refocus.

## Architecture

### State contract

Create `packages/ui/src/stores/cognito-mode.ts`:

```ts
interface CognitoModeState {
  active: boolean;
  activationShortcut: string | null;
  toggle: (shortcut: string) => void;
  reset: () => void;
}
export const useCognitoModeStore = create<CognitoModeState>(/* ... */);
```

Inactive → `toggle(normalizedSettingsChord)` → active with frozen chord. Active → `toggle(frozenChord)` → inactive, chord cleared. `reset()` is lifecycle/test teardown only, never a runtime dismissal control. Settings hydration, profile changes, server loss and route changes leave activation untouched; frozen chord prevents lockout if preferences change while active.

### Surface and input contract

- Create `export function CognitoModeOverlay(): React.JSX.Element | null` in `components/organisms/CognitoModeOverlay.tsx`. Subscribe narrowly to active/style/chord; return null inactive. `createPortal(..., document.body)` with SSR-safe document checks.
- Mask root has `data-cognito-mode-overlay`, `tabIndex={-1}`, accessible label/description including `displayShortcut(activationShortcut)`; screen-reader-only text, no visible Black Screen content. Use a simple focusable div, not a dismissable dialog or native top-layer modal.
- Reserve mask z-index 10000, active toast z-index 10001; default toast z-index remains 45. Values explicit in CSS/inline style, not a new global layer framework. Guard still blocks toast input at the higher layer.
- Root app exposes `data-cognito-mode-content`; Phase 03 puts visible routes/banners/prompts inside it and sets `inert`/`aria-hidden` only while active. Keep toast live region and nonvisual bridges outside.
- Create `useCognitoModeInputGuard(): void` in `hooks/use-cognito-mode-input-guard.ts`, completed by Phase 03. Install stable window-capture listeners with nonpassive pointer/wheel/touch cancellation; read current store synchronously. It owns input/focus interception; overlay owns only visuals and focus-sink ref/initial focus.
- Capture blocked events: pointer/mouse/touch down/up/move that drive interactions, click/dblclick/auxclick/contextmenu, wheel, dragstart/drop, clipboard paste/cut/copy, beforeinput/input/composition events. Phase 03 adds keydown/keypress/keyup and chord logic. Call `preventDefault` if cancelable, `stopImmediatePropagation`; returning false alone is insufficient.
- Focus: save prior focused HTMLElement on activation, blur editor/terminal before typing can continue, focus sink with `preventScroll`, and use capture `focus`/`focusin` to stop underlying focus listeners and redirect external focus back. Ignore events already targeting sink; avoid recursive focus loops. Refocus attempts by dialogs/toasts/xterm cannot win.
- Cleanup: restore only a connected, non-inert prior target after deactivation, no scrolling or forced terminal selection; leave absent targets alone. Keep input-release bookkeeping until triggering keys/gestures finish so dismissal cannot leak into restored focus. Remove listeners, owned attributes and timers on unmount; reset activation for a new root mount.

CSS: full-viewport fixed overlay, `pointer-events: auto`, `touch-action: none`, `user-select: none`; use app viewport sizing variables/zoom conventions from `index.css`. No animated entry/exit or opacity interpolation. Use `@supports` for blur/fail-opaque behavior. Avoid setting `filter: blur()` on productive content: that creates stacking/containing blocks and can alter rendering/fits.

Native adapter: derive `effectiveViewportVisible = props.isViewportVisible && !active` in `BrowserDebugKeepAliveHost`; pass it to iframe fallback and existing native frame calculation. Masking changes visibility only, not target/generation/lifecycle. A native child may appear black/blank instead of frosted because it is outside the DOM compositing tree. No new native IPC command.

## Related code files

**Create**
- `packages/ui/src/stores/cognito-mode.ts` and `cognito-mode.test.ts` — ephemeral transitions and frozen-chord behavior.
- `packages/ui/src/components/organisms/CognitoModeOverlay.tsx` and `CognitoModeOverlay.test.tsx` — visual surface/focus/cleanup consumer tests.
- `packages/ui/src/hooks/use-cognito-mode-input-guard.ts` and `use-cognito-mode-input-guard.test.tsx` — input/focus lifecycle; Phase 03 completes keyboard logic.

**Modify**
- `packages/ui/src/index.css` — two mask styles, static layering, viewport behavior and backdrop-filter fallback.
- `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx` — active layer only; preserve content, timers and service behavior.
- `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` and `BrowserDebugKeepAliveHost.test.tsx` — mask-aware viewport visibility without resetting target.
- `packages/ui/src/embed/dam-hopper-app.tsx` — Phase 03 is sole owner of root integration, not this phase.

**Delete**: none. No reusable modal/framework, generic privacy service or copied notification system.

## Preflight contract

1. Read Phase 01 fields/helpers and Phase 03 event precedence before implementing; no competing keyboard owner.
2. Inspect current portal/dialog/focus and native-child visibility paths. Confirm no native top-layer/fullscreen surface bypass; record supported shell limitations in qualification.
3. Read real zoom/safe-area/viewport CSS before choosing dimensions; do not assume `100vw`/`100vh` is correct under document zoom.
4. Freeze store signatures, DOM markers, z-index pair and input-guard ownership for Phase 03. Shared root edits remain with Phase 03.

## Implementation Steps

1. Implement the dedicated store synchronously with inactive defaults and frozen activation chord. Expose reset solely for root teardown/tests; keep style in settings, not duplicated runtime state.
2. Build the overlay body portal and accessible focus sink. Use settings `cognitoModeStyle`; use frozen chord in accessible instructions. Black Screen contains no visible instruction or dismissal control.
3. Add instant styles and fail-opaque support fallback; preserve root theme/zoom/layout. Verify viewport includes headers, floating panels and safe areas at minimum/maximum app zoom.
4. Implement non-key capture handling in `useCognitoModeInputGuard` plus synchronous active-state reads, focus capture/redirect and reversible cleanup. Root integration waits for Phase 03; no partial integration claimed complete.
5. Track active gestures sufficiently to consume their ending release/click sequence after deactivation; do not accidentally synthesize clicks, commit a drag or allow a held mouse button to operate underlying controls.
6. Raise only active toasts above the mask and keep their lifetime/audio/notification store untouched. Guard events even when toast is on top; do not mark its live region inert or hide it.
7. Fold active state into existing Browser Debug viewport visibility; send null viewport while masked and restore current measured viewport on dismissal. Leave target/navigation/connection unchanged.
8. Add real DOM regressions with React `createRoot`/`act` conventions: mask over focused input ignores typing/paste/click/Escape; programmatic refocus stays isolated; dismissal restores only valid prior focus; repeated mount/unmount removes capture guards; toast arrival/expiry works while active. State tests cover activation → preference change → original-chord dismissal and reset.
9. Test consumer state changes, not class strings, enum copies, `toggle()` mock echoes or bare rendering. CSS blur/black correctness and native compositing require Phase 05 visual smoke; jsdom is not proof.

## Todo list

- [ ] Implement nonpersisted state and freeze activation binding.
- [ ] Implement two instant mask styles and accessible portal focus sink.
- [ ] Implement input/focus isolation and complete lifecycle cleanup.
- [ ] Preserve visible toasts/audio and hide native child via existing viewport contract.
- [ ] Add lifecycle/input regressions; release interfaces to Phase 03.

## Success Criteria

- Underlying controls cannot mutate from direct pointer, clipboard, composition or focus attempts while active.
- Root/portal surfaces remain mounted; terminal output and notifications continue normally.
- Both styles cover the actual viewport; Black Screen base is #000 and Heavy Blur is visually unreadable at representative content sizes.
- Existing modal focus scope cannot fight the overlay; no Escape/outside-click dismissal.
- Reload/root teardown restores a usable inactive app with no orphan inert state or listeners.
- Native browser child is not visible/clickable over either mask, and resumes same target on dismissal.

## Side-effect review checklist

- [ ] No productive subtree unmount, editor model disposal, PTY detach/write/resize caused by masking.
- [ ] No root CSS blur/filter, layout shift, app zoom reset, page scroll or terminal fit storm.
- [ ] Toasts visibly continue and expire; sound/browser notification policy unchanged; toast buttons cannot navigate/dismiss while masked.
- [ ] Body-portaled dialogs, menus, tooltips and suggestion overlays cannot appear above/bypass mask.
- [ ] Focus scopes, programmatic refocus, IME/paste and an in-flight pointer gesture remain safe.
- [ ] Native child visibility changes do not reset target, host generation or navigation.
- [ ] Deactivation/unmount restores prior attributes/focus and removes owned capture listeners.

## Risk Assessment

- Blur strength is a privacy deterrent, not guaranteed redaction. Qualify ordinary text/dense terminal/large editor text; recommend Black Screen for stronger masking.
- Window listeners and inert alone have different portal coverage. Use both, test existing modal/context menu surfaces and do not create a focus polling timer.
- Radix already-open focus scopes can redirect; capture-focus suppression must precede document handlers and be browser-qualified.
- GPU-heavy blur: one static compositor overlay only; no canvas copies/screenshots/render loop. Qualify continuous terminal output without reconnect or resize churn.
- Native visibility acknowledgement may be asynchronous. Real native smoke must check for child-surface flash; fix existing visibility application if it leaks, do not call DOM screenshots native proof.

## Security Considerations

- Not a login lock, encryption control, screenshot prevention, content deletion or process suspension.
- Notifications intentionally remain visible/audible and may disclose their usual metadata; document this exception plainly.
- No copied terminal/editor content, screenshot capture, key logging or storage of activation state.
- Browser chrome/OS shortcuts and external windows remain outside app authority; browser reload through chrome remains a recovery path.

## Next steps

[Phase 03](./phase-03-global-shortcuts-and-terminal-integration.md) installs the sole keyboard owner, app content boundary and terminal precedence. [Phase 05](./phase-05-qualification-and-smoke.md) proves actual visual/focus/native behavior.
