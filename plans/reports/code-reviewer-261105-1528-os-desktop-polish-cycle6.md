# OS Desktop Polish — Cycle 6 Code Review

- **score: 5/10**
- **critical_count: 1**
- **Disposition: request changes.** Fixed this cycle: the live-PTY kill path, terminal copy, modal DoubleShift and the fake epoch. However, the Cycle 6 journal "fix" now writes false `confirmed-not-created` records on every launch (reproduced) and adds a TTL that the binding contract C3 forbids. Three of the claimed fixes do not work in production: launch-error UI, Search mode, and blocked notices.

## Scope / evidence
- Reviewed the Cycle 6 remediation surface: `TerminalsApp.tsx`, `persistence.ts` (journal), `action-dispatch.ts`, `SearchApp.tsx`/`SearchPanel.tsx`, `DesktopContextMenu.tsx`, `DesktopCanvas.tsx`, `dam-hopper-app.tsx` and `use-browser-shortcut-guard.ts`. Traced calls through `OsResourceHost.tsx`, `TerminalKeepAliveHost.tsx`, `TerminalPanel.tsx`, `terminal-registry.ts`, `window-store.ts`, `action-executor.ts`, `OsShell.tsx` (search:query) and `ws-transport.ts`. Also checked the server config diff, the docs and `architecture-contracts.md` C3.
- Checks run:
  - `tsc --noEmit` (packages/ui): no errors.
  - `vitest run` on src/os plus the settings, shortcuts, context-menu and ui-config suites: 46 files, 437 tests passed.
  - `eslint` on the 8 remediated files: 0 errors, 19 warnings.
  - A throwaway TerminalsApp vitest probe (file deleted afterwards) reproduced C1 and W1.
  - Not run: cargo, browser tests, E2E.

## Critical
### C1 — Every launch is falsely marked `confirmed-not-created` while the create is in flight; the TTL breaks contract C3
- `TerminalsApp.tsx:244-253`: the cleanup effect depends on `[attemptId, appState.dispatched, appState.incarnation]`. `handleLaunchSession` sets `dispatched:true` (`:94`) before it awaits `terminal.create`. That change re-runs the effect, so React runs the previous cleanup, whose closure still sees the old `window` with `dispatched` undefined. The cleanup calls `settleTerminalLaunch(attemptId, {kind:"confirmed-not-created", reason:"Window closed before terminal creation dispatch"})`. **Probe result:** this record was written with the window still open and create still pending.
- `settleTerminalLaunch` (`persistence.ts:1215-1284`) does not check the current state before overwriting a record, so any settle call can replace any state.
- Consequences:
  - In-flight de-duplication is turned off for every launch.
  - If the window is replaced during create (`:150-156` returns) or the response has no `serverEpoch` (`:170`), the record keeps the false receipt even though the PTY exists.
- `persistence.ts:1109-1115` adds a 60s TTL to `reserved-dispatch-capable` records. This contradicts C3 (`architecture-contracts.md:68,72,76`): "unresolved records have no TTL", "crash-before-send is conservatively uncertain", and "No … timeout release".
  - Reload drops `attemptId` (`persistence.ts:43-49`). After a reload mid-create, the record therefore unblocks 60s later, and a duplicate PTY can be launched.
- **Fix:**
  - Delete the dependency-driven cleanup. If a close hook is kept, run it only on real unmount (a ref or `useWindowStore.getState()`), and record `uncertain` once the reservation exists, since C3 rules 1 and 5 require it.
  - Add a transition guard in `settleTerminalLaunch`: only `reserved` may become a settled state, and `uncertain` may become success or not-created only with authoritative proof.
  - Remove the TTL.
  - Unblocking has to come from authoritative reconciliation, not from time. Otherwise the contract must be amended explicitly, with the user's approval.
  - Add TerminalsApp tests for dispatch, close-during-create, missing epoch and reload.

## Warnings
1. **High — The launch overlay and error/Retry UI never appear in production.**
   - `OsResourceHost.tsx:202-236` mounts a `TerminalPanel` for every terminals window.
   - `TerminalPanel.tsx:451` registers the terminal in the registry unconditionally on mount. `hasRendererRegistered` therefore becomes true right away, and the overlay at `TerminalsApp.tsx:367` is hidden.
   - **Probe result:** when create rejected with "cwd does not exist", the error text did not render.
   - A failed launch leaves a blank terminal that keeps trying to attach, with no error shown and no Retry.
   - "Renderer registered" does not mean the session exists. Drive the overlay from attempt state (reserved/dispatched/settled), not from the registry.
2. **High — The Search mode fix has no effect and breaks repeat delivery.**
   - `setCurrentMode` is never called (`SearchApp.tsx:22`, flagged by lint), so `currentMode` is frozen at its first-mount value.
   - `search:query` reuses an existing window and writes the new `searchMode` and `deliveryId` (`OsShell.tsx:1174-1188`). The panel then remounts with the stale `initialMode`. For example, DoubleShift (filename search) into a window opened by Ctrl+Shift+F opens in content mode, with the query in the content slot.
   - Toggling scope still loses the mode the user picked, because SearchPanel has no mode-change callback.
   - Fix: add `onModeChange` to SearchPanel and persist the mode to appState. Reset to the delivered mode only when `deliveryId` changes.
3. **High — Blocked-launch notices are still dropped in production.**
   - `DesktopCanvas.tsx:206-224` does not pass `onNotice` to `<DesktopContextMenu>`; only the tests pass it.
   - `dock-context-menu.tsx:146-150`, `CommandPalette.tsx:152` and `Dock.tsx:74` ignore `ActionResult` `blocked`, `failed` and `uncertain`.
   - Combined with indefinite `uncertain` blocks (which the contract intends), New Terminal looks like it does nothing.
4. **Medium — Settlement classification still guesses from error text** (`TerminalsApp.tsx:191-200`).
   - "Failed to fetch", 5xx, and a socket closed after send all become `confirmed-not-created`, which C3 rule 4 forbids.
   - Any message containing "connected" (including "disconnected") becomes `uncertain`.
   - A missing `serverEpoch` leaves the record unsettled instead of `uncertain`.
   - `String(sessionRes.incarnation)` (`:166,183`) breaks the "never String(unsafe-number)" rule. Use `incarnationExact`.
   - Fix: use a `dispatched` flag set immediately before the await, together with typed errors. Fix this in the same pass as C1.
5. **Medium — Docs and plan disagree.**
   - `system-architecture.md:385` says "Planned Design, Not Implemented".
   - CHANGELOG and roadmap claim "implementation and automated qualification complete", and `plan.md` says `status: completed`, while C1 and W1-W3 are open.
   - CHANGELOG says `useBrowserShortcutGuard` was removed, but the file is still a no-op shim.
6. **Low — Dead code (YAGNI):**
   - The `use-browser-shortcut-guard.ts` no-op shim (Cycle 5 asked for deletion).
   - Unused `generateUUID` (`TerminalsApp.tsx:16`).
   - Unused `handleTerminalFontSizeShortcut` and `isTerminalSurfaceTarget` imports (`dam-hopper-app.tsx:47-48`), orphaned when `GlobalTerminalFontSizeShortcuts` was deleted.
   - Four unused imports in `action-dispatch.ts:11-18`.
   - Unused `worktreePath`, `targetProject` and `targetProfileId` (`SearchPanel.tsx:59-61`).
7. **Low — Stale deps.** `handleLaunchSession` depends on the whole `window.appState` (`:215`), so it is recreated on every appState patch and the auto-launch effect re-runs each time. `isDispatched` is the only thing that prevents a second create.

## Verified resolved
- Live-PTY kill path: the overlay requires `attemptId && !isExistingOnly`, so existing, restored, palette and agent windows cannot reach `terminal.create`. No current producer passes an explicit `requestedTerminalId`.
- Terminal copy: `prevent-default` now only calls `preventDefault` and is not marked handled (`action-dispatch.ts:358-361`), so `TerminalPanel`'s `Mod+Shift+C` path runs.
- DoubleShift is reset in the modal/menu stage (`:203`) and on IME and blur.
- No fabricated epoch: the target is published only with a canonical-UUID `serverEpoch` (`:157-169`).
- Pre-send connection failures settle as `confirmed-not-created` and are guarded by `alreadySettled`.
- The `dam-hopper-app.tsx` guard import was removed.

## Suggestions (security / perf / arch / YAGNI-KISS-DRY)
- Arch/KISS: keep one terminal-attempt state machine in appState (`reserved → dispatched → success | uncertain | not-created`), separate from stream attachment. Let it drive both the overlay and journal settlement, and delete the `isRemoteAttached`, `hasRendererRegistered` and `isDispatched` heuristics.
- Arch: put the state-transition rules inside `settleTerminalLaunch`, not in its callers.
- Perf: each TerminalsApp subscribes to every registry change and re-runs `attachTerminalsToHost` plus `setState`, which is O(N²) across N windows. Filter by key.
- Perf: in `action-dispatch.ts:330-331`, resolve `actionContext` lazily, only after a binding matches (carried over).
- DRY: add a cross-check test between `EXTRA_ACTION_IDS` (`server/src/api/config.rs:611`) and the UI catalog, and a length bound on `appShortcuts` values (carried over).
- Security: the server validates `appShortcuts` keys and value types, and `fleetTerminalShortcut` is dropped. No new security issues were found in the reviewed surface.

## Metrics
- Type check: tsc reports 0 errors.
- Tests: 437 of 437 targeted vitest tests pass. There is no TerminalsApp test file; C1 and W1 were uncovered by the probe only.
- Lint: 0 errors, 19 warnings on the reviewed files (unused vars/imports and one `set-state-in-effect`).

## Unresolved questions
- Will the user accept C3's indefinite `uncertain` block, which the contract intends and Cycle 5 C2 objected to? If not, the contract needs an explicit amendment before any TTL or reset path is added.
- Who corrects `plan.md` from `status: completed`? The reviewer did not edit the plan; no plan file was assigned.
