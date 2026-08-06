# Android Chrome native-keyboard suppression

Status: planned · Date: 2026-08-05

## Decision

On Android Chrome, disable native text entry across the app and keep the terminal on the custom keyboard path. On desktop and non-Android browsers, preserve existing physical/native keyboard behavior. This is intentionally disruptive on Android: URL/search/settings/passphrase/editor text entry will be unavailable.

Chrome cannot guarantee a hidden IME while editable controls remain focusable. `inputmode="none"`, `blur()`, and `tabIndex=-1` are hints/focus controls, not a global guarantee. The strongest web boundary is to keep editable controls unfocusable/non-editable.

## Phases

1. [Platform policy and root guard](phase-01-platform-policy-and-root-guard.md) — pending
2. [Terminal/custom-keyboard integration](phase-02-terminal-and-custom-keyboard-integration.md) — pending
3. [Regression coverage and device validation](phase-03-regression-coverage-and-device-validation.md) — pending

## Preflight contract

- Output: Android-Chrome-only native text-input suppression with custom terminal input retained.
- Acceptance: no app text control can focus/edit/open the Android IME in Android Chrome; custom terminal keys still write; desktop behavior is unchanged; file/checkbox/radio/select/button controls remain usable; a dismissible non-modal notice explains blocked mobile text entry.
- Scope: web UI under `packages/ui`, including root guards, xterm, Monaco, dialogs, forms, and browser tests.
- Non-goals: suppressing the OS keyboard outside the app, changing native Tauri behavior, or claiming a portable browser guarantee.
- Risk/public contracts: broad mobile usability loss; focus/accessibility behavior; dynamic/lazy controls; xterm and Monaco integration; persisted `mobileCustomKeyboardEnabled` must not re-enable native input on Android.
- Expected touch points: `dam-hopper-app.tsx`, a new Android-Chrome policy hook/helper and notice, `TerminalPanel.tsx`, `TerminalRuntimeOutput.tsx`, `MultiTerminalDisplay.tsx`, `MobileTerminalAccessoryBar.tsx`, `WorkspacePage.tsx`, Monaco editor hosts, focused tests/docs.
- Testing: targeted Vitest unit tests, browser DOM/focus tests, UI build/lint, then real Android Chrome manual validation. Desktop regression coverage is mandatory.
- Open questions: exact supported Android/Chrome version matrix; no connected Android device is currently assumed.

## Side-effect review

- Auth/session/permissions: no server/API/schema changes; passphrase and auth fields become read-only/disabled only on Android Chrome.
- Data integrity: no persistence changes; values remain readable, but mobile edits are blocked.
- Security/privacy: do not log user-agent or input contents; keep file pickers and non-text controls functional.
- Performance: one root MutationObserver/focus guard; avoid per-keystroke global listeners and repeated DOM scans.
- Docs/config/deploy: document the platform-specific limitation and validation matrix; no migration required.

## Research

- [MDN inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input)
- [MDN VirtualKeyboard API](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [Chrome VirtualKeyboard API](https://developer.chrome.com/docs/web-platform/virtual-keyboard)
- [Chrome viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior/)
