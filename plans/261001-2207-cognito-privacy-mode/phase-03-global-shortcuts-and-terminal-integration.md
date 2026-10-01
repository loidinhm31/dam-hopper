# Phase 03 — Global shortcuts and terminal integration

## Context links

- [Overview](./plan.md), [Phase 01 shortcut contract](./phase-01-config-and-schema.md), [Phase 02 input/state contract](./phase-02-cognito-state-and-overlay.md), [Phase 04 capture markers](./phase-04-settings-ui-integration.md).
- [DamHopperApp](../../packages/ui/src/embed/dam-hopper-app.tsx), [terminal key helper](../../packages/ui/src/lib/terminal-keyboard-shortcuts.ts), [TerminalPanel](../../packages/ui/src/components/organisms/TerminalPanel.tsx), [PaneContainer](../../packages/ui/src/components/organisms/PaneContainer.tsx).
- [Browser shortcut guard](../../packages/ui/src/hooks/use-browser-shortcut-guard.ts), [Monaco shortcut binding](../../packages/ui/src/components/organisms/MonacoHost.tsx), [shortcut helpers](../../packages/ui/src/lib/shortcuts.ts).

## Overview

- Date: 2026-10-01. Priority: P2. Status: pending. Effort: 6h.
- Connect the root-level keyboard toggle/input isolation to every existing terminal layout; ensure no keystroke reaches a PTY/editor/action while masked.

## Key Insights

- `DamHopperApp` installs browser shortcut guards at window capture; page-global new-terminal/font actions currently use bubbling window listeners. Cognito must run first, including when the user binds a chord normally blocked by the browser guard.
- `TerminalPanel.baseKeyEventHandler` currently prepares Backspace, accepts suggestions and copies selected text before `handleSharedTerminalKeyEvent`. An active-state check only inside the shared helper is too late.
- `PaneContainer` calls the saved base handler before pane split/focus/navigation keys and restores it on layout cleanup. Preserve that single composition chain; do not overwrite it with another xterm handler.
- `matchesKeyboardShortcut` rejects repeats and composition. Suppression must still consume repeated/keyup events for an already-handled physical chord without toggling on them.
- Native keyboard event properties can be nonenumerable; existing tests cover that. Never spread the event into a plain object to match a shortcut.

## Requirements

- Same shortcut activates/deactivates immediately on every DamHopper-owned page, with focus in terminal, Monaco, settings input, menus and dialogs. No editable-target exclusion except active shortcut capture while inactive.
- Exactly one nonrepeat, noncomposing keydown toggles state; keypress/keyup/held repeats do not. `keyCode === 229` is composing input even if `isComposing` is absent.
- While active, consume every app keydown/keypress/keyup before all page, editor, terminal, pane and modal handlers. Escape/Tab/Enter/Space do not dismiss or edit.
- Dismissal key events must not leak after active becomes false or prior focus restores. Consume the full physical sequence through release, including repeats.
- Only the global capture owner toggles; xterm blocks the chord/active input but never calls `toggle`.
- Existing shortcut behavior resumes unchanged after dismissal. Do not change transport/PTY write APIs, ordinary terminal input policy or native accelerator registration.

## Architecture

### Single owner and precedence

Complete `useCognitoModeInputGuard(): void` in `hooks/use-cognito-mode-input-guard.ts`. Call it first in `DamHopperApp`, before `useBrowserShortcutGuard()` and context-menu suppression. Use a client layout effect (SSR-safe effect fallback) so window-capture ownership is installed before passive browser guards and before users can interact. Register each listener once; read settings/state at dispatch rather than closing over stale React values.

Keyboard order:
1. Consume pending releases/keypress/repeats from a key sequence already intercepted; no fresh toggle from held keys.
2. If active, choose frozen `activationShortcut`; consume all keys. Toggle off only when it matches a fresh nonrepeat/noncomposing keydown, then retain dismissal sequence tracking until release.
3. If inactive and target `composedPath()` includes `[data-shortcut-capture="true"]`, pass through so Settings capture works; no global toggle. Marker is only an inactive exemption.
4. If inactive and matching the configured Cognito chord, synchronously activate; prevent default and stop immediate propagation. Eat composing/repeated variants of the matching physical chord without toggling.
5. Otherwise leave ordinary events unchanged. Browser guard and existing app handlers then own them.

Use `matchesKeyboardShortcut(chord, event)` for toggling. For suppression only, pass an explicit property object with `repeat: false` / `isComposing: false` and original code/modifier values, guarding event type; never use this sanitized event for deciding to toggle. Consume matching keyboard release by tracked physical `code` even if modifiers have already been released. Retain a small pressed/consumed-code Set in the guard, not settings or server state; clear safely on actual release/unmount and reconcile window blur so missed keyups cannot permanently eat normal future input. Window blur never deactivates the mask.

### Defensive terminal API

Add to `SharedTerminalKeyOptions`:

```ts
cognitoModeShortcut: string;
cognitoModeActive: boolean;
```

Export `shouldConsumeCognitoModeTerminalKey(event: ShortcutKeyEvent, shortcut: string, active: boolean): boolean` from `terminal-keyboard-shortcuts.ts`. Returns true for any key event while active or a matching chord sequence while inactive; explicit event-property reads, no state mutation or toggle. `handleSharedTerminalKeyEvent(...)` calls this first, prevents default where available and returns false when consumed, before font/find/copy/new-terminal paths.

`TerminalPanel.baseKeyEventHandler` reads live settings and Cognito state and applies the same defensive predicate as its **first statement**, before Backspace preparation, ghost acceptance/history, selection copy or shared keys. Pass required fields into the shared helper; update every production caller and test fixture in this cutover. `PaneContainer` continues to call base first, so split/move/focus actions remain blocked without a second implementation.

The global capture guard owns release tracking and toggling. Defensive xterm handling is only a backstop; returning false by itself must not be treated as global toggle delivery. Normal focused-terminal activation is proven through browser capture, not an `onCognitoToggle` callback.

### Root integration

- Import overlay/store/guard in `embed/dam-hopper-app.tsx`.
- Mount overlay once at app root, outside route `Suspense`/error boundaries, within normal providers. It survives route changes and lazy loading.
- Wrap visible app content (keyboard notice, prompts, banners and `Routes`) in a neutral `data-cognito-mode-content` div with conditional `inert` and `aria-hidden`; preserve existing layout/viewport/flex sizing. Nonvisual bridges, diagnostics and global shortcut components remain mounted outside it; toast live region remains outside and above mask.
- No `display:none`/conditional unmount of productive content. Preserve existing router basename, root CSS font sync, profile bootstrap and provider ordering.
- Root unmount resets ephemeral state and clears input guards; StrictMode setup/cleanup/setup must leave a working inactive app. Do not reset on route/profile changes or each effect rebind.

## Related code files

**Modify**
- `packages/ui/src/hooks/use-cognito-mode-input-guard.ts`, `use-cognito-mode-input-guard.test.tsx` — Phase 02-created guard, keyboard order and full cleanup.
- `packages/ui/src/embed/dam-hopper-app.tsx` — first-priority guard, root overlay/content boundary and teardown.
- `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`, `terminal-keyboard-shortcuts.test.ts` — consumption helper and required option fields.
- `packages/ui/src/components/organisms/TerminalPanel.tsx`, `TerminalPanel.test.tsx` — first-refusal guard before suggestion/copy paths.
- `packages/ui/src/components/organisms/PaneContainer.test.tsx` — existing composed-handler behavior; `PaneContainer.tsx` only if references reveal a bypass, not a speculative duplicate guard.
- Any caller/fixture of `handleSharedTerminalKeyEvent` found by references — migrate required contract atomically.
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx` — marker owned by Phase 04; coordinate, do not edit concurrently.

**Create/delete**: no further runtime module required. Browser scenario fixture/evidence belongs to Phase 05.

## Preflight contract

1. Confirm all key listeners and xterm handler installations/replacements, not only shared-helper callers. Read current suggestion/copy/pane precedence.
2. Freeze Settings capture marker with Phase 04 before root guard lands. Window capture cannot rely on React `stopPropagation` at the capture button.
3. Confirm Phase 02's state/focus/root marker contracts and native visibility integration; no independent toggle listener inside overlay or terminal.
4. This phase owns root/terminal/helper integration and tests. No mid-flight project-wide validation or parallel edits to its guard/root files.

## Implementation Steps

1. Complete the stable capture guard's keydown/keypress/keyup listeners with the five-step priority contract above. Set state synchronously before stopping propagation; ordinary React scheduling is acceptable only if no exposed paint/frame occurs—qualify immediate visual application in Phase 05, use event-bound synchronous commit if necessary.
2. Ignore composition for toggle, including legacy code 229; consume it while active. Avoid treating sanitized events as legitimate activation input. Repeat holds must never flash mask off/on.
3. Track handled physical sequences across dismissal; do not rely on modifier state at keyup. Reconcile missed keyup on focus loss without unlocking the mask; test release order and fresh presses after window focus returns.
4. Install guard before browser shortcut suppression and app listeners in `DamHopperApp`; integrate overlay/content boundary as above. Preserve existing nonvisual services, notifications and font/new-terminal handlers.
5. Implement `shouldConsumeCognitoModeTerminalKey(...)`; call before all shared terminal handlers and at the start of `TerminalPanel.baseKeyEventHandler` before suggestion/copy actions. Pass current state/settings each time; do not capture mount-time config.
6. Migrate every `handleSharedTerminalKeyEvent` call and fixture to required privacy options, including native-event nonenumerable-property cases. Keep saved base handler and pane cleanup composition intact.
7. Add behavioral regressions: terminal-focus default/custom chords toggle once and produce no PTY input; active suggestion-accept/history/copy/new-terminal/font/find/split chords do nothing; editor value and selection remain unchanged; default/custom binding works with dialogs/search/settings inputs; a chord colliding with app/browser-suppressed shortcuts chooses privacy first.
8. Cover keydown → repeat → keypress → keyup, dismissal with reversed modifier release, composition/code 229, window blur/focus, hydration changing shortcut while active, Settings capturing the old/current chord, and StrictMode remount cleanup.
9. Assert consumer mutations/PTY byte absence and transitions, not merely mock callbacks or shared option forwarding. Record browser/actual terminal proof in Phase 05; helper tests alone cannot prove event precedence.

## Todo list

- [ ] Implement sole capture-phase toggle and release tracking.
- [ ] Integrate root overlay and inert content boundary without remounting work.
- [ ] Add first-refusal terminal guard and migrate all callers.
- [ ] Preserve pane composition and Settings capture exemption.
- [ ] Add repeat/IME/focus/source-change/precedence regressions.

## Success Criteria

- Default/custom chords work with terminal/editor/dialog focus and toggle once only.
- Activation/dismissal bytes never reach PTY; keys/paste/clicks while active cannot modify terminal/editor or navigate/split/resize panels.
- Mask cannot dismiss via Escape, clicks, notifications or route changes.
- Held key/release sequence cannot execute anything after dismissal; subsequent fresh ordinary input works.
- Binding capture does not mask the page; active mask ignores the capture exemption.
- Existing global/pane/font/search/copy/suggestion behavior is unchanged while inactive.

## Side-effect review checklist

- [ ] Capture order beats browser guard and existing window/document/Monaco handlers.
- [ ] Exactly one toggle owner; no xterm callback double-toggle or `defaultPrevented` ambiguity.
- [ ] Terminal early guard precedes Backspace, suggestion acceptance/history, copy and pane actions.
- [ ] Root wrapper does not change content sizing, zoom, scrolling, suspense or error behavior.
- [ ] No terminal attach/detach/write/resize, connection switch or editor disposal from toggling.
- [ ] Same-key release and held repeats remain blocked after deactivation; fresh input resumes.
- [ ] Cleanup removes all listeners/attributes and reset does not run on profile/route change.

## Risk Assessment

- Late guard registration can let blocked/custom chords reach another listener first. Mitigate root-first layout-effect capture and actual event-precedence smoke.
- Consuming every key forever after a missed keyup is a lockout risk. Track physical state narrowly and reconcile on window focus lifecycle without deactivating privacy.
- Overbroad editable-target exemption defeats privacy in editors. Only inactive, explicit shortcut capture is exempt.
- Cross-origin/sandboxed iframe and separate native-child keys are outside parent-document propagation. Activation requires focus in a DamHopper-owned surface; do not claim an OS-wide boss key. Once active, focus is retained by the mask and child visibility is suppressed.

## Security Considerations

- This is app-level input isolation, not a server authorization boundary. Background/server commands already running continue.
- Do not instrument raw typed keys, inspect user clipboard content or add keylogging diagnostics.
- Do not intercept system-wide input or weaken iframe sandbox/bridge origin validation to capture foreign keys.

## Next steps

[Phase 04](./phase-04-settings-ui-integration.md) completes capture/reset/appearance controls against this contract. [Phase 05](./phase-05-qualification-and-smoke.md) verifies real xterm/editor/browser precedence and platform coverage.
