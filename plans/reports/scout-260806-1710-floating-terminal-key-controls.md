# Scout report: floating terminal key controls

## Scope and worktree

Read-only inspection of terminal UI, mounting sites, responsive gates, tests, and docs. Current unrelated worktree changes: `packages/ui/src/components/organisms/ImportDialog.tsx` modified; `logs/` and several old plan directories untracked. Excluded from feature scope.

## Relevant files and symbols

- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` — `MobileTerminalAccessoryBar`; owns Keys expansion, keyboard/Type toggle, native/custom keyboard selection, terminal writes, and bottom safe-area styling. Current root is an in-flow `shrink-0` bar; controls are two 36px buttons aligned right.
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx` — `TerminalScrollButtons`; reference floating pattern: `absolute right-4 bottom-4 z-10`, translucent surface, border/shadow/backdrop blur, outside-pointer/Escape dismissal, mouse-down prevention, event propagation guards, focus rings.
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` — single-terminal runtime host. Host is `relative ... flex-1 overflow-hidden`; mounts scroll buttons inside host and accessory bar after host. `showMobileAccessoryBar` requires Android native-input policy or `(compact workspace && coarse pointer)`.
- `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` — split-terminal host. Same mobile gate and native-input suppression; renders `SplitLayout`, then a second in-flow `MobileTerminalAccessoryBar` mount after the layout.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` — desktop/mobile parent. Compact mode renders `TerminalRuntimeOutput` under a safe-area header; desktop mode renders runtime output in the main pane and optional browser split. No direct key-control logic.
- `packages/ui/src/components/organisms/MobileTerminalSpecialKeys.tsx`, `MobileTerminalCustomKeyboard.tsx`, `MobileTerminalNativeKeyboardInput.tsx` — expanded key grid and keyboard surfaces consumed by the accessory bar.
- `packages/ui/src/hooks/use-coarse-pointer.ts` — live `(pointer: coarse)` media-query gate with SSR-safe initial read.
- `packages/ui/src/hooks/use-compact-workspace.ts`, `compact-workspace-media-query.ts` — compact viewport gate and subscription.
- `packages/ui/src/lib/mobile-terminal-keys.ts`, `mobile-terminal-keyboard-layout.ts` — key sequences and custom keyboard layout; no positioning concerns.

## Current behavior

The Keys and keyboard/Type controls are available only when the mobile accessory bar is mounted. On compact coarse-pointer layouts or Android Chrome native-input suppression, they occupy a bottom layout row and reduce terminal viewport height. On ordinary desktop/pointer-fine layouts there is no accessory bar, so these controls are unavailable. Scroll controls are independently settings-gated and already float over terminal output. In `TerminalRuntimeOutput`, scroll buttons are moved to `bottom-2` when the in-flow accessory bar is present; this coupling disappears if the accessory is overlaid.

`MultiTerminalDisplay` has no `TerminalScrollButtons` sibling; its accessory is outside `SplitLayout`, so a floating implementation must anchor to the split host/container without intercepting normal pane input. `TerminalRuntimeOutput` is the cleaner existing overlay seam because its output host is already positioned and owns scroll controls.

## Recommended minimal architecture

Extract the two-button presentation/keyboard behavior from the mobile-only placement assumption, or add a placement mode to `MobileTerminalAccessoryBar` (for example `floating` plus optional className). Render one accessory overlay inside each terminal output surface, using the same positioned ancestor as `TerminalScrollButtons`; keep the bar’s existing state and keyboard/special-key children unchanged. Use the existing `absolute`/z-index/backdrop/focus/event conventions rather than introducing a new portal or global controller.

For `TerminalRuntimeOutput`, place the accessory controls in the `relative` output host and remove the in-flow bottom mount. For `MultiTerminalDisplay`, either make the `SplitLayout` wrapper `relative` and overlay against the whole split surface, or place a shared overlay sibling inside the relative `TerminalRuntimeOutput`-equivalent surface. Keep the existing mobile policy only for native-input suppression and keyboard behavior; do not use it to decide whether the two controls render. The feature request implies render on desktop and mobile, while expanded keyboard UI can remain governed by the current mobile/Android policy unless product intent says otherwise.

Avoid duplicating the controls in both overlay and bottom bar. A small shared `TerminalFloatingControls`/placement wrapper is justified only if both runtime paths need materially different anchors; otherwise a placement prop keeps YAGNI and preserves current tests.

## Desktop/mobile considerations

- Desktop: render the two controls for active terminals with the same 36px touch target, but position them so they do not cover common prompt/cursor areas; coordinate with scroll-button placement (likely a vertical/horizontal offset or shared corner stack).
- Mobile: overlaying avoids shrinking xterm and avoids the current scroll-button `bottom-2` special case. Keep the controls reachable above the browser/OS keyboard and expanded custom keyboard; when the keyboard panel opens, the floating trigger should remain visible or move with the panel deliberately.
- Split terminals: one active-session control overlay should follow the active session, not create one control pair per pane; verify pane switching and pointer targeting.
- Responsive transitions: `useCoarsePointer` and compact media queries can change at runtime; overlay positioning must remain valid after viewport/orientation changes and terminal refit.

## Accessibility and safe-area risks

- Preserve real buttons, `aria-label`, `aria-pressed`, `title`, and visible focus rings. If adding a group, use an appropriate label; do not make the controls pointer-inert.
- Preserve mouse/pointer-down prevention and click propagation guards so clicking controls does not focus xterm or trigger pane selection.
- Floating controls need safe-area compensation: `bottom: max(..., var(--safe-area-bottom))` or an equivalent shared safe-area utility, especially on iOS home-indicator devices. Avoid double-counting when the custom/native keyboard is open.
- Check z-index against xterm, split drag/drop overlays, dialogs, browser panels, and the runtime sheet. Ensure controls are not clipped by `overflow-hidden` or transformed ancestors.
- Maintain adequate contrast over terminal output and a minimum 44px effective touch target if the existing 36px visual button is retained; validate keyboard focus and Escape behavior.

## Test seams and commands

Existing unit seams:

- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` — labels, compact sizing, native/custom keyboard branching.
- `packages/ui/src/components/organisms/TerminalScrollButtons.test.tsx` — overlay interactions, dismissal, scroll actions.
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` — host mounting, responsive gates, scroll-button class, native-input suppression.
- `packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx`, `TerminalWorkspaceShell.test.tsx`, `MobileWorkspaceShell.test.tsx` — parent mounting/layout regressions.

Existing browser seams:

- `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` — current mobile alignment/interaction assertions.
- `packages/ui/browser-tests/terminal-scroll-buttons.browser.tsx` — floating interaction behavior.
- `packages/ui/browser-tests/mobile-workspace-shell.browser.tsx`, `android-chrome-input-policy.browser.tsx` — mobile and keyboard policy behavior.

Suggested validation: `pnpm --filter @dam-hopper/ui test --run src/components/organisms/MobileTerminalAccessoryBar.test.tsx src/components/organisms/TerminalRuntimeOutput.test.tsx src/components/organisms/TerminalScrollButtons.test.tsx`; `pnpm --filter @dam-hopper/ui test:browser -- mobile-terminal-accessory-bar terminal-scroll-buttons mobile-workspace-shell`; then `pnpm --filter @dam-hopper/ui typecheck` (or repository-standard `pnpm check`) and lint changed files.

## Unresolved questions

- Should Keys/Type float on all desktop terminals, or only expose the trigger on desktop while expanded keyboard content remains mobile/policy-gated?
- In split mode, should controls anchor to the active pane, the whole split surface, or each pane?
- Exact collision/stacking policy with `TerminalScrollButtons`: shared corner stack, side-by-side controls, or independent corners?
- Should the trigger remain visible above the native/custom keyboard panel, and what is the desired safe-area offset when that panel is open?

## Exact files inspected

`packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`; `TerminalScrollButtons.tsx`; `TerminalRuntimeOutput.tsx`; `MultiTerminalDisplay.tsx`; `ActiveTerminalRuntimeDisplay.tsx`; `MobileTerminalSpecialKeys.tsx`; `MobileTerminalCustomKeyboard.tsx`; `MobileTerminalNativeKeyboardInput.tsx`; `MobileTerminalAccessoryBar.test.tsx`; `TerminalScrollButtons.test.tsx`; `TerminalRuntimeOutput.test.tsx`; `ActiveTerminalRuntimeDisplay.test.tsx`; `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx`; `terminal-scroll-buttons.browser.tsx`; `mobile-workspace-shell.browser.tsx`; `android-chrome-input-policy.browser.tsx`; `packages/ui/src/hooks/use-coarse-pointer.ts`; `use-compact-workspace.ts`; `compact-workspace-media-query.ts`; `packages/ui/src/lib/mobile-terminal-keys.ts`; `mobile-terminal-keyboard-layout.ts`; `docs/frontend-components.md`; `docs/system-architecture.md`; `docs/code-standards.md`; `docs/codebase-summary.md`; `README.md`; and `git status --short` output.
