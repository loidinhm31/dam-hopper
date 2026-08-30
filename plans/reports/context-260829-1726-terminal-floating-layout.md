# Terminal floating controls discovery

Date: 2026-08-29

## User outcome

Raise the floating terminal control stack slightly so the bottom-right terminal corner remains visible. Keep the scroll trigger/rail above the two accessory triggers (Terminal Keys and Keyboard/Type). Move Enter out of the custom keyboard's Del-adjacent area and expose it through Terminal Keys.

## Observed implementation

- `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx`: accessory shell is an absolute `z-10` overlay anchored to the accessory wrapper with `right: max(0.75rem, var(--safe-area-right, 0px))` and `bottom: calc(100% + max(0.75rem, var(--safe-area-bottom, 0px)))`.
- `packages/ui/src/components/organisms/TerminalAccessoryControls.tsx`: two separate 40x40 buttons in a vertical `flex-col gap-0.5` stack: Terminal Keys, then Keyboard/Type.
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`: scroll trigger/rail is an absolute `z-10` overlay in the terminal host. With `reserveAccessoryRail`, its bottom is `safe-area-bottom + 6.25rem + 0.5rem`, placing it above the accessory stack.
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` and `PaneContainer.tsx`: existing callers own active session mounting; no API/server/data path is involved.
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`: owns local open state, PTY writes, native Enter/Backspace handling, and custom/native keyboard selection. Its docked panel remains safe-area padded and in flow when expanded.
- `packages/ui/src/lib/mobile-terminal-keyboard-layout.ts`: normal layer has Del at the end of the Z-M row and Enter in the following control row; symbol layer has Enter immediately before Del in its final row.
- `packages/ui/src/lib/mobile-terminal-keys.ts` and `MobileTerminalSpecialKeys.tsx`: Terminal Keys currently exposes nine keys in a four-column grid; it has no Enter or Del.
- `packages/ui/src/index.css`: safe-area variables use `env(safe-area-inset-*)`; viewport height uses `100dvh`; `.safe-area-inline` and `.safe-area-bottom` are existing utilities.

## Existing verification seams

- `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` covers 320/375/1280/1440 widths, 40x40 controls, scroll-above-keys geometry, panel bounds, focus, event isolation, native/custom keyboard paths, and host-height invariants.
- `packages/ui/src/lib/mobile-terminal-keyboard-layout.test.ts` covers row exports and custom Enter/Backspace sequences.
- `packages/ui/src/lib/mobile-terminal-keys.test.ts` covers Terminal Keys IDs and ANSI sequences.
- Exact target command passed: `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/mobile-terminal-accessory-bar.browser.tsx` (1 file, 7 tests). An earlier broad invocation also exercised unrelated suites and failed outside this surface; do not treat those failures as caused by this request.

## UX evidence

- UI Pro Max guidance: preserve visible focus, 44/48px mobile touch guidance, at least 8px adjacent-target spacing where possible, safe-area clearance, and visual order matching keyboard/tab order.
- Antigravity CLI (`agy`) was called read-only against scoped UI directories. It recommended a 24px baseline bottom clearance (current baseline is 12px), coordinated scroll reservation, an Enter key in Terminal Keys, and explicit browser checks for safe-area/bottom clearance and Enter/Del separation. It also suggested extra Ctrl-D/Del options; those are outside this request and are not included.
- `docs/design-guidelines.md` does not exist. Follow `docs/code-standards.md` and `docs/frontend-components.md`; `/code` must invoke `ui-ux-designer` before editing as required by the workflow.

## Planning decision

Treat Enter as a Terminal Keys action: add one `enter` definition (`\r`) to `MOBILE_TERMINAL_KEYS`, remove Enter from both custom keyboard row definitions, and update tests/browser assertions accordingly. Keep existing custom Del behavior and all native input Enter/Backspace behavior. Elevate both floating positioning calculations by one shared visual increment (baseline 24px plus safe-area compensation), then tune the reserved scroll lane only as needed to retain a visible gap; do not add new global state, APIs, telemetry, or unrelated terminal keys.
