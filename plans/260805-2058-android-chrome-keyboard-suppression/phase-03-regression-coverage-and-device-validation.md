# Phase 03 — Regression coverage and device validation

## Context links

- [Plan](plan.md)
- `packages/ui/vitest.browser.config.ts:14-21`
- `packages/ui/browser-tests/`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx`
- `packages/ui/src/lib/terminal-host-attachment.test.ts`

## Overview

Priority: high · Status: partial · Owner: tester/reviewer

Prove the DOM/focus contract in Vitest and Chromium, then explicitly report the remaining Android-IME risk. Headless desktop Chromium is not evidence that the Android keyboard will remain hidden.

## Key insights

- Unit coverage now exercises the real xterm textarea contract and the policy's real
  document focus/mutation behavior; browser coverage still cannot expose the Android IME.
- Android device validation must cover focus races and dynamic controls.
- The worktree already contains unrelated changes; validation must avoid resetting or overwriting them.

## Requirements

- Unit tests: detector, text-control classification, lock/unlock restoration, mutation handling, active-focus blur, and exclusion of file/checkbox/radio/range/select/button controls.
- Terminal tests: `inputMode`, `tabIndex`, `disableStdin`, hidden-host propagation, direct focus suppression, custom-key write path, native mobile input omission.
- Browser tests: Android-policy DOM state, dynamically opened dialog/search/settings control, xterm/custom keyboard interaction, desktop/non-target control behavior.
- Accessibility behavior: notice presence/dismissal, descriptions, focus fallback, TalkBack/keyboard navigation, and no disabled-field focus traps.
- Editor tests: Monaco read-only state and no editor focus on Android policy; desktop remains editable.
- Run UI build/typecheck and lint; use the narrowest commands first.

## Implementation steps

1. Add focused Vitest tests alongside policy/terminal/editor modules.
2. Add a browser regression file using stable role/label selectors and no arbitrary sleeps.
3. Run `pnpm --filter @dam-hopper/ui test -- <targeted files>`.
4. Run `pnpm --filter @dam-hopper/ui test:browser -- <targeted browser test>`.
5. Run `pnpm --filter @dam-hopper/ui build` and `pnpm lint` for affected code.
6. Validate real Android Chrome via remote debugging or an Android emulator: keyboard hidden/visible before open, terminal remount, reparent, notification selection, find/history, dialogs, search/settings, URL, rotation, and hardware keyboard.

## Todo list

- [ ] Add a device/browser matrix with Android version and Chrome version.
- [ ] Capture failure screenshots/video/trace if the IME still appears.
- [ ] Verify desktop physical keyboard behavior on the supported desktop browsers.
- [ ] Validate notice and focus behavior with TalkBack or an equivalent accessibility pass.
- [x] Record the automated evidence and the remaining device/IME/TalkBack boundary here.

## Current validation evidence

- Focused UI tests: passed.
- Full UI tests: passed.
- UI build and root build: passed.
- Lint: passed.
- Isolated Android provider browser run: 4/4 passed.
- Full browser run: 72 passed; also reports an unrelated `terminalRegistry` import failure.
- Desktop Chromium results are automated browser evidence only, not Android device evidence.
- Still pending on physical Android Chrome: IME visibility, hardware keyboard behavior, rotation, and TalkBack.

## Success criteria

- All targeted automated tests and build/lint pass.
- Device validation confirms no IME from app text controls in Android Chrome, or the result is explicitly reported as partial if device validation is unavailable.
- No unsupported claim of universal browser suppression is made.

## Risk assessment

Critical residual risk: Android Chrome/IME behavior is device/version dependent and cannot be
proven by jsdom or desktop Chromium. The direct Chromium policy test proves DOM locking,
focus redirection, and cleanup only; it does not prove keyboard visibility, hardware-keyboard
behavior, browser UA identity, or TalkBack behavior. Release readiness remains partial until
real-device evidence exists.

## Security considerations

Browser tests must not use real credentials or external URLs. Device logs/screenshots must not expose tokens, passphrases, PTY output, or user data.

## Next steps

After implementation, run the `web-testing` release gate and have a code reviewer inspect policy scope, accessibility, performance, and YAGNI/KISS/DRY compliance.
