# Diagnostic Report: Agent Hub Terminal Tab Close Failure

- **Date:** 2026-11-06
- **Agent:** TerminalCloseDebugger
- **Report:** `plans/reports/debugger-261106-1759-agent-hub-terminal-close.md`
- **Status:** Root Causes Identified & Remediated

---

## 1. Executive Summary

- **Symptom:** Clicking the `"X"` (`Close terminal`) button on an open terminal tab in Agent Hub did not terminate the terminal process, dispatch `POST /api/terminal/{id}/terminate`, or visually close the tab.
- **Root Causes:**
  1. **Prompt Option Mismatch (`use-hub-terminal-tab-actions.ts:214`):** `onCloseTab` invoked `terminalClose.requestTerminalClose(closeRequest, onCloseView, { prompt: !isDead })`. For live terminals (`isDead === false`), `options.prompt === true` caused `requestTerminalClose` (`terminal-close-context.tsx:243`) to bypass `terminateSessionImmediately` and open `TerminalCloseDialog` instead of dispatching `POST /api/terminal/{id}/terminate`.
  2. **Modal Stacking Occlusion (`Dialog.tsx:19,44` & `DesktopCanvas.tsx:214,259`):** `DialogOverlay` and `DialogContent` used `z-50` (`z-index: 50`) in `document.body`, whereas `DesktopCanvas`'s `float-layer` used `zIndex: 60` (`DesktopCanvas.tsx:259`) without stacking context isolation on `DesktopCanvas`. Whenever Agent Hub or any floating window was focused in `float-layer` (`z-index: 60`), `TerminalCloseDialog` rendered behind `float-layer` (`z-index: 50 < 60`), making the dialog completely invisible on screen while Radix Dialog locked `document.body` pointer events.
  3. **In-Flight Termination Filtering & `runtimeIndex` Reactivity (`use-agent-hub-workspaces.ts:219-309`):** `use-agent-hub-workspaces.ts` and `agent-hub.ts` only filtered out `alive === false || terminationState === "exited" || terminationState === "restartCancelled"`, omitting `terminationState === "terminationRequested"` and active/settled states in `terminalActionCoordinator` (`useAllTerminalActions()`). Additionally, `runtimeIndex` omitted `connectionSignature` from its `useMemo` dependencies.
  4. **Hardcoded `live` Origin in Immediate Termination (`terminal-close-context.tsx:158`):** `terminateSessionImmediately` hardcoded `origin = "live"` instead of deriving `availability === "restartPending" ? "restartPending" : "live"`.

---

## 2. Complete Event Chain Trace

1. **`TabBar.tsx:157-170` (`DraggableTab`):** Clicking `<button aria-label="Close terminal">` calls `onClose(tab.sessionId)` where `tab.sessionId` is qualified via `terminalKey({ profileId, id })`.
2. **`PaneContainer.tsx:564` → `SplitLayout.tsx:88,323` → `MultiTerminalDisplay.tsx:206`:** Forwards `onCloseTab(sessionId)` to `TraditionalTerminalProjectsDisplay`.
3. **`TraditionalTerminalProjectsDisplay.tsx:426-434` (`handleCloseTerminalTab`):** Resolves `firstRemainingTraditionalTerminalId(group, sessionId)` and invokes `AgentHubApp`'s `tabActions.onCloseTab(sessionId, fallback)`.
4. **`use-hub-terminal-tab-actions.ts:174-230` (`onCloseTab`):** Looks up `renderedTarget = runtimeIndex.get(sessionId)` and calls `terminalClose.requestTerminalClose(closeRequest, onCloseView)`.
5. **`terminal-close-context.tsx:234-271` (`requestTerminalClose` → `terminateSessionImmediately`):**
   - Calls `onCloseView(windowId)` to advance tab selection.
   - Calls `terminalActionCoordinator.reserveDispatch(target, origin)` (synchronously setting `status: "dispatching"`).
   - Dispatches `requestGuardedTermination` (`POST /api/terminal/{id}/terminate`).
   - Records outcome in `terminalActionCoordinator` and invalidates `"terminal-sessions"` / `"terminal-inventory"` queries.
6. **`use-agent-hub-workspaces.ts:215-342`:** Subscribes to `useAllTerminalActions()` and immediately excludes sessions with `terminationState === "terminationRequested"` or coordinator status `"dispatching" | "terminationRequested" | "ended" | "restartCancelled"`, pruning the closed tab from `sessionGroups` and `mounts`.

---

## 3. Remediations Applied

1. **`packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.ts` & `.test.ts`:**
   - Removed `{ prompt: !isDead }` from `terminalClose.requestTerminalClose(closeRequest, onCloseView)` so clicking `"X"` on a terminal tab immediately terminates the process without a prompt (matching `WindowFrame.tsx` and `WindowList.tsx`).
   - Preserved `tab.session.terminationState` when computing `rowState` and `availability`.
2. **`packages/ui/src/os/agent-hub/use-agent-hub-workspaces.ts` & `.test.ts` & `packages/ui/src/os/agent-hub.ts`:**
   - Added `isSessionTerminatingOrEnded` checking `s.terminationState === "terminationRequested"` and `useAllTerminalActions()` (`dispatching`, `terminationRequested`, `ended`, `restartCancelled`) so closed tabs vanish immediately upon click and remain hidden while the PTY process exits.
   - Added `connectionSignature` to `runtimeIndex` `useMemo` dependency array.
   - Forwarded `incarnationExact` and `terminationState` onto `tab.session`.
3. **`packages/ui/src/os/terminal-close-context.tsx`:**
   - Passed `frozenRequest.availability` to `terminateSessionImmediately` and derived `origin = availability === "restartPending" ? "restartPending" : "live"`.
4. **`packages/ui/src/os/DesktopCanvas.tsx` & `packages/ui/src/components/ui/Dialog.tsx`:**
   - Added `isolate` to `DesktopCanvas` root container so internal window layer z-indices (`20`, `40`, `50`, `60`) do not leak into `document.body` above shell overlays.
   - Raised `DialogOverlay` and `DialogContent` in `Dialog.tsx` from `z-50` to `z-[100]`.

---

## 4. Verification Checks for Main Agent

- `pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/use-hub-terminal-tab-actions.test.ts src/os/agent-hub/use-agent-hub-workspaces.test.ts src/os/terminal-close-context.test.tsx src/os/maximized-presentation.test.tsx`
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-agent-hub.browser.tsx`

---

## 5. Unresolved Questions

- None.
