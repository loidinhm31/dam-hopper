---
title: "Traditional Terminal Search Focus and Scroll Controls Fix"
description: "Stop Traditional terminal panes from stealing Global Search focus and expose the configured terminal scroll controls without changing Runtime behavior."
status: completed
priority: P1
effort: 3h
branch: develop
tags: [frontend, terminal, traditional, focus, accessibility, testing]
created: 2026-08-31
---

# Traditional Terminal Search Focus and Scroll Controls Fix

## Outcome
Fix two confirmed Traditional-only regressions in `packages/ui`: typing repeatedly in Global Search keeps the search input focused, and the globally enabled terminal scroll controls render for the active Traditional pane with the same accessory-rail contract already used by Runtime. Preserve terminal process/host ownership, split layout, native-input suppression, Runtime rendering, settings persistence, and transport behavior.

## Progress
- Overall: `100%` — completed; focused implementation, browser verification, UI build, actual-app smoke, and final code review approved

## Scope and design decisions
- **Modify only:**
  - `packages/ui/src/components/organisms/PaneContainer.tsx`
  - `packages/ui/src/components/organisms/PaneContainer.test.tsx`
  - `packages/ui/browser-tests/pane-terminal-accessory.browser.tsx`
- **Inspect/retain unchanged:** `SearchPanel.tsx`, `stores/search-ui.ts`, `WorkspacePage.tsx`, `use-terminal-manager.ts`, `TraditionalTerminalProjectsDisplay.tsx`, `MultiTerminalDisplay.tsx`, `SplitLayout.tsx`, `TerminalRuntimeOutput.tsx`, `TerminalScrollButtons.tsx`, and settings schema/UI.
- Fix focus at the invariant owner: callback identity changes may reinstall pane key handling, but must not focus xterm. Do not merely narrow `WorkspacePage`'s search-store subscription or stabilize one callback; either workaround leaves other unrelated parent rerenders able to steal focus.
- Reuse `TerminalScrollButtons` directly. Do not extract a shared Runtime/Traditional wrapper in this bug fix: that expands the Runtime change surface without changing its behavior or reducing meaningful terminal logic.
- No backend, API, database, persistence, auth, telemetry, or terminal lifecycle changes. No architecture/doc update unless verification reveals an existing behavioral document that explicitly claims otherwise.

## Current failure chain
1. `SearchPanel` calls `setQuery` per character; `WorkspacePage` currently subscribes to the full search UI store and rerenders.
2. Traditional render callbacks are recreated through `useTerminalManager` → `TraditionalTerminalProjectsDisplay` → `MultiTerminalDisplay` → `SplitLayout`.
3. `PaneContainer`'s keyboard-handler effect depends on `onSelectTab`; each callback change reruns the effect and executes `terminal.focus()` even though the active session and focused pane did not change.
4. `PaneContainer` renders `MobileTerminalAccessoryBar` for the globally active terminal but omits `TerminalScrollButtons`; Runtime already gates that control with `terminalScrollButtonsEnabled` and coordinates it with accessory-panel open state.

## Implementation order

### 1. Decouple terminal focus from callback-driven key-handler installation
In `PaneContainer`:
1. Keep the custom keyboard-handler effect responsible only for installing/restoring `attachCustomKeyEventHandler`; retain callback dependencies required by shortcuts.
2. Remove the unconditional focus block from that callback-dependent effect. Remove `onNewTerminal` from its dependency list because the effect body does not use it; do not suppress exhaustive-deps or introduce callback refs.
3. Add a focused effect whose dependencies are only semantic focus inputs: `node.activeSessionId`, `isFocused`, and `shouldSuppressTerminalFocus`. When an active registry entry exists and the pane newly becomes focused/changes active session, call `terminal.focus()`; otherwise no-op.
4. Preserve all explicit user-navigation focus paths (pane host click and Alt+Left/Alt+Right), registry reparenting/late-registration behavior, active-tab switching, Android/native-input suppression, handler cleanup, and Runtime code unchanged.

This makes a parent/callback-only rerender incapable of moving DOM focus while still focusing xterm for real pane/session focus transitions.

### 2. Render enabled scroll controls in the active Traditional pane
In `PaneContainer`:
1. Import `TerminalScrollButtons`; select `terminalScrollButtonsEnabled` from `useSettingsStore` without changing the existing commit-status override.
2. Mirror Runtime's local accessory-panel state contract: `{ sessionId, isOpen }`, a memoized `handleAccessoryPanelOpenChange`, and `isAccessoryPanelOpen` scoped to the current active session.
3. In the existing `terminalPane` footer wrapper, render `TerminalScrollButtons` only when `node.activeSessionId` is also the global `activeSessionId` and the setting is enabled. Pass:
   - `sessionId={node.activeSessionId}`
   - `reserveAccessoryRail={true}` (or the equivalent existing Runtime boolean expression)
   - `accessoryPanelOpen={isAccessoryPanelOpen}`
4. Continue rendering exactly one `MobileTerminalAccessoryBar` for that same global active session; pass `onPanelOpenChange={handleAccessoryPanelOpenChange}` and keep its session key. Use Runtime's relative/shrink wrapper class switch so an open accessory panel and scroll rail share the established safe-area/reservation geometry.
5. Do not render controls in inactive split panes, do not alter terminal host height, and do not change `TerminalRuntimeOutput`.

### 3. Add focused regression coverage
Extend `PaneContainer.test.tsx`:
- Register a fake active terminal whose `focus()` moves focus to a fake xterm textarea. Render a focused pane, then focus an external input representing Global Search and rerender with a new `onSelectTab` identity but unchanged pane/session state. Assert the external input remains `document.activeElement` and terminal focus count does not increase. Then change a semantic focus input (focused pane or active session) and assert xterm focus still occurs; also assert suppression prevents it.
- Expand the accessory/scroll mocks to capture session and `accessoryPanelOpen`. Assert the enabled setting renders one scroll control only for the global active Traditional session, the disabled setting renders none, and accessory open/close callbacks update the scroll-control prop without moving the control into the browser region.
- Clear registry/settings/focus state after each test to keep the file full-suite safe.

Extend `pane-terminal-accessory.browser.tsx` using real `PaneContainer`, `MobileTerminalAccessoryBar`, and `TerminalScrollButtons`:
- Add `terminalScrollButtonsEnabled: true` and `terminalScrollStep` to its settings fixture.
- Assert one visible `Show terminal scroll buttons` trigger exists inside the terminal area, none exists in the adjacent Browser pane, and it retargets with the globally active session.
- Open the scroll rail and assert the accessible `Terminal scroll controls` group; open/close an accessory panel and verify the scroll trigger/rail remains visible and geometrically clear (non-overlapping bounding boxes) at the existing compact `1280x420` viewport.
- Add an external Global Search-labelled input plus a terminal-focus spy/textarea; rerender the pane with a new selection callback and assert Chromium retains input focus. This covers the observable browser behavior at the failing `PaneContainer` boundary without rebuilding a second Workspace fixture.

Existing `TerminalScrollButtons.test.tsx` remains the owner of scroll action, Escape/outside dismissal, touch isolation, ARIA linkage, and exact line-step behavior; do not duplicate those assertions.

## Verification commands
Run focused checks only during implementation, then the UI compile gate:

```bash
pnpm --filter @dam-hopper/ui test -- src/components/organisms/PaneContainer.test.tsx src/components/organisms/TerminalScrollButtons.test.tsx
pnpm --filter @dam-hopper/ui test:browser -- pane-terminal-accessory.browser.tsx terminal-scroll-buttons.browser.tsx
pnpm --filter @dam-hopper/ui build
```

Browser-drive the actual app after the focused tests:
1. Start the existing UI/backend development workflow on unused local ports; open Chromium in Traditional mode with one live terminal and Global Search visible.
2. Type at least three characters into Global Search. After every character, verify the input remains `document.activeElement`, the entire query is present, and keystrokes do not reach xterm.
3. Select/click the terminal and switch tabs/panes; verify intentional terminal focus still works. Repeat with native-input suppression where the existing harness supports it.
4. Enable **Show terminal scroll buttons**. Verify exactly one trigger appears for the active Traditional terminal, opens all four scroll actions, operates the active session, does not focus xterm on pointer activation, and follows active tab/pane changes. Disable the setting and verify it disappears.
5. Open Keys/Type accessory panels at desktop and compact/short viewport sizes; verify scroll controls stay above/clear of the accessory rail, remain in bounds, do not overlap Browser content, and do not change terminal host height.
6. Switch to Runtime and verify its search focus retention, scroll controls, accessory geometry, and terminal selection are unchanged.

## Risks and mitigations
- **Initial/late terminal focus regression:** retain registry reparent subscription and scheduled-focus behavior; test semantic pane/session transitions, not only callback churn.
- **Keyboard handler stale closure:** keep its real `layout`/selection dependencies; separate only the focus side effect rather than hiding dependencies in refs.
- **Multiple split-pane overlays:** gate both accessory and scroll controls by pane-active ID plus global active ID; cover inactive and Browser-adjacent panes.
- **Accessory/scroll collision:** mirror Runtime's `onPanelOpenChange`, reservation, and wrapper contract; verify bounding boxes in Chromium.
- **Settings rerender behavior:** use the existing setting only; no new default, migration, save path, or schema.
- **Runtime drift:** make no Runtime source edits and include a direct Runtime smoke contrast.
- **Security/privacy/performance:** no new input capture, logging, transport calls, persistence, or subscriptions beyond existing local UI state/effects; callback-only rerenders stop doing avoidable focus work.

## Success criteria
- Three or more Global Search characters can be entered continuously in Traditional mode; focus never moves to xterm from a query/callback-only rerender.
- Genuine terminal selection, pane focus, tab changes, and explicit terminal clicks still focus xterm unless native input is suppressed.
- With the setting enabled, exactly one active Traditional pane exposes the existing accessible scroll trigger/actions for the correct session; inactive panes and the Browser region expose none. Disabling the setting removes it.
- Scroll controls and Mobile Terminal Accessory remain non-overlapping, safe-area aware, pointer/focus isolated, and height-neutral across verified viewports.
- Runtime source and observed behavior remain unchanged.
- Focused unit/browser commands and `@dam-hopper/ui` TypeScript build pass.
- No source outside the three named files changes; docs remain unchanged unless an existing explicit contract requires correction after verification.

## Completion Evidence

- Implementation complete in the three named paths only: `PaneContainer` now separates callback-only key-handler setup from semantic focus transitions, and the active Traditional pane reuses `TerminalScrollButtons` with the Runtime-compatible accessory-rail contract. Runtime source remains unchanged.
- Focused unit validation: `pnpm --filter @dam-hopper/ui test -- src/components/organisms/PaneContainer.test.tsx src/components/organisms/TerminalScrollButtons.test.tsx` — 2 files, 5 tests passed.
- Focused Chromium validation: `pnpm --filter @dam-hopper/ui test:browser -- pane-terminal-accessory.browser.tsx terminal-scroll-buttons.browser.tsx` — 2 files, 8 tests passed.
- UI build validation: `pnpm --filter @dam-hopper/ui build` passed.
- Actual app smoke passed: Traditional Global Search retained focus while entering three characters; the enabled scroll trigger/group rendered above the keyboard controls; activating scroll controls did not focus xterm; Runtime behavior provided the expected contrast.
- Final code review found no issues.
- Remaining scope caveats: validation evidence is focused plus actual-app smoke, not a full repository suite or production/cross-platform release validation. No backend/API/persistence/transport changes were made; documentation was updated in `docs/CHANGELOG.md` and `docs/project-roadmap.md`.

## Unresolved questions
None.
