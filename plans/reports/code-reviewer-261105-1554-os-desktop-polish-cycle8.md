# OS Desktop Polish — Cycle 8 Code Review

- **score: 7/10**
- **critical_count: 0**
- **Disposition:** approve with changes. C1 is fixed and confirmed by probe. One contract-violating High warning remains (H1), and it should be fixed before release.

## Scope / evidence
- **Timing caveat:** when the review started, `persistence.ts` and `TerminalsApp.tsx` were unchanged since before Cycle 7 (mtime 15:37/15:38), so none of the claimed C1 edits were present yet. I told Main. Main then landed them at 15:55–15:58, together with a new immutability test in `app-launch-journal.test.ts`. Everything below was re-verified against the landed code. No further edits as of 16:03.
- **Reviewed:**
  - `TerminalsApp.tsx`
  - `persistence.ts` (journal, :900-1285)
  - `app-launch-journal.test.ts`
  - `SearchApp.tsx` and `SearchPanel.tsx`
  - `DesktopCanvas.tsx`
  - `action-executor.ts`
  - The `search:query` and `terminal:open` handlers in `OsShell.tsx`
  - The `terminal:create` path in `ws-transport.ts`
  - `server/src/api/terminal.rs` (`create_session`)
  - C3 in `architecture-contracts.md:60-82`
  - The docs diff
- **Checks run:**
  - `tsc --noEmit` (packages/ui): 0 errors.
  - `vitest run` on src/os, src/components, the shortcuts, ui-config and context-menu-coordinator suites, and stores/settings: **163 files, 1227 tests passed**.
  - `eslint` on 10 files (TerminalsApp, SearchApp, DesktopCanvas, action-executor, action-dispatch, persistence, OsShell, dam-hopper-app, SearchPanel, DesktopContextMenu): **0 errors, 19 warnings**. Baseline: HEAD dam-hopper-app had 8 warnings and HEAD OsShell had 4.
  - Throwaway probes, all deleted afterwards:
    - A journal probe.
    - A TerminalsApp probe using the real store and journal through a live store-subscribed wrapper, with connections, owner, claim and registry mocked.
- **Not run:** browser tests, E2E, cargo.

## Verified resolved
- **C1 (Cycle 7) is fixed.**
  - `settleTerminalLaunch` returns early on `confirmed-success` and `confirmed-not-created` (`persistence.ts:1236-1242`). Probe: overwriting a success with not-created is now rejected.
  - TerminalsApp probes:
    - **A — close mid-create:** the record stays `reserved-dispatch-capable`, and a second reserve is `blocked`. After the create resolves, the record becomes `confirmed-success` with the correct `terminalId`.
    - **B — close after success:** the receipt is kept.
    - **C — unmount mid-create (as with minimize or tab switch), then resolve:** the record becomes `confirmed-success`, and `appState.target` is published.
  - The handler always settles, and `updateAppState` is gated on `isWindowStillPresent` (`TerminalsApp.tsx:149-193`).
  - Cleanup does nothing if the window exists, and settles only if the window is gone and was never dispatched (`:256-273`).
- **Search mode is fixed.** The mode is derived during render, and `"text"` is normalized to `"content"` (`SearchApp.tsx:22-23`). The `key` includes `deliveryId`, so the panel remounts with the correct `initialMode`. This covers both Cycle 7 W1 and W2.
- **Missing or non-canonical `serverEpoch`** now settles `uncertain` (`:174-179`).
- **The DesktopCanvas `react-hooks/refs` error is gone.**
- **action-executor unused imports** went from 11 to 2.

## Critical
None.

## Warnings
1. **High — Error-text classification still issues false `confirmed-not-created` receipts, which re-enables a duplicate PTY (C3 rule 4).**
   - `TerminalsApp.tsx:197-206` treats any message that lacks "generation", "connected", "timeout" or "abort" as proof that nothing was created.
   - Probe E: create rejecting with `TypeError("Failed to fetch")` produced `confirmed-not-created`. So a response lost after the server-side PTY was created makes the identity re-reservable, and Retry spawns a second PTY.
   - A 5xx reply is misclassified the same way.
   - **Fix:** the transport already throws `ApiRequestError(message, status, code)` (`ws-transport.ts:3281`).
     - Settle `confirmed-not-created` only for `err instanceof ApiRequestError` with a deterministic 4xx (400/401/403/404/413/422; not 408/409/429). The pre-dispatch connection and generation checks also count as not-created; they already settle that way.
     - Settle everything else `uncertain`.
     - Delete the substring heuristic.
2. **Medium — Fabricated or unsafe incarnation provenance (C3 line 80).**
   - `:163` and `:189` use `String(sessionRes.incarnation)`. Probe D: a create returning `{serverEpoch}` without an incarnation gave `confirmed-success` with `incarnationExact` equal to the string `"undefined"`, and the same value is published in `appState.target`.
   - The server always serializes a u64 (`SessionMeta.incarnation`, `#[serde(default)]`). So in practice this hits malformed responses and values above 2^53, but the contract forbids `String(unsafe-number)`.
   - **Fix:** accept only `Number.isSafeInteger(n) && n > 0` (or an exact string). Otherwise settle `uncertain` and do not publish a target.
3. **Medium — Closing an undispatched terminal while it is unmounted leaves the reservation stuck forever.**
   - Settlement lives in TerminalsApp's unmount effect. A minimized window, a window on another desktop, or an inactive tab is not mounted, so closing it from WindowList (`WindowList.tsx:182-204`) or from another surface never runs the cleanup.
   - The record stays `reserved-dispatch-capable` and blocks that destination permanently (no TTL, by contract).
   - Repro path: owner offline → New Terminal → minimize → close from WindowList.
   - **Fix:** settle not-created in the close path (window-store `closeWindow`, or one close-op hook that reads `appState.attemptId` and `!appState.dispatched` from the authoritative store snapshot). Drop the unmount effect.
4. **Medium (carried) — `terminal:open` still bypasses the C3 journal.** `OsShell.tsx:357-432` calls `client.terminal.create` directly. This path is used by "open terminal here" in Files, Git and ProjectInfo, and by the `?open=terminals` deep link.
5. **Medium (carried) — The launch error is not persisted.** The catch block only calls `setLaunchError` and never writes `appState.createError`. After a remount, the window shows the "Retry Launch" overlay with no reason; it falls back on the `isDispatched` branch.
6. **Medium (carried) — Action results are discarded.**
   - These call sites throw away the result:
     - `Dock.tsx:74`
     - `dock-context-menu.tsx:138,147`
     - `AppLauncher.tsx:110`
     - `CommandPalette.tsx:152`
     - `OsShell.tsx:1516`
     - `action-dispatch.ts:258,338`
   - As a result, `blocked` / `failed` from New Terminal is silent outside the desktop menu.
   - Blocks are now permanent for uncertain records, so this silence matters more.
   - The `void` calls also leave rejections unhandled.
7. **Medium — There is no TerminalsApp test file.** All of the C1, H1 and W2 behavior was found only by probes. Add a `TerminalsApp.test.tsx` that mirrors probes A–E. The live-store wrapper pattern makes this cheap.
8. **Low — Plan and docs overclaim.**
   - `plan.md` has `status: completed`.
   - In `project-roadmap.md`, the row says "Implementation and automated qualification complete".
   - H1 and W2–W7 are still open.

## Suggestions
- **KISS/arch:** keep one attempt state machine and settle it from window ops, not from component lifecycle (W3). Two smaller items in `TerminalsApp.tsx`:
  - Guard re-entry with a ref set synchronously in the handler, not with `isLaunching` state or the prop-derived `isDispatched`.
  - `isDispatchedRef` (`:253`) relies on a re-render having flushed before the close.
- **Journal API:** a rejected overwrite returns `{status:"settled"}` (`persistence.ts:1241`), which looks the same as a successful write. Return a distinct `already-settled` status carrying the stored state, so callers can detect stale tokens.
- **Perf:**
  - `handleLaunchSession` depends on the whole `window.appState` (`:221`), so it is recreated on every patch and the auto-launch effect re-runs. Depend on the fields it actually reads.
  - The registry-change re-attach costs O(N²) across windows (carried).
- **DesktopCanvas:** `getPresentationContainer` still mutates the `useState` Map and creates DOM nodes during render (`:55-65`, called at `:296`). That silences the lint rule without making render pure. It is idempotent, so it is safe in practice. A layout-effect-created map, or a short justified comment, would be more honest.
- **DRY:**
  - OsShell writes both `mode` and `searchMode` with the raw `"text"` value (`OsShell.tsx:1185-1186,1204-1205`). Write a single normalized field at the intent boundary.
  - The two create paths, TerminalsApp and OsShell `terminal:open`, duplicate the connect / create / recheck / epoch logic. Unify them behind the executor and journal; this also closes W4.
- **Lint debt (new versus HEAD):**
  - `OsShell.tsx`: 4 unused items (`useCognitoModeStore`, `arbitrateKeyboardEvent`, `osPaletteShortcut`, `osCycleFocusShortcut`).
  - `action-dispatch.ts:11,13`: 2 unused items.
  - `action-executor.ts:3,7`: 2 unused items (`findExistingWindowForApp`, `ActionContext`).
- **Security:** no new injection, auth or secret exposure in this delta. The journal stores no secrets and is bounded (128 records, 8 KiB per record, 1 MiB total). A deep link that auto-creates a PTY (W4) remains a minor drive-by-resource concern.

## Metrics
- Type check: tsc reports 0 errors.
- Tests: 1227/1227 targeted vitest tests pass. The new journal immutability test passes. TerminalsApp has no tests.
- Lint on 10 files: 0 errors and 19 warnings. Of these, 8 unused items and 3 `set-state-in-effect` are new or carried in OsShell, action-dispatch and action-executor; the 8 dam-hopper-app warnings predate this work.

## Unresolved questions
- Should `terminal:open` and the `?open=terminals` deep link migrate to `app.terminals.new-window` plus the journal in this plan, or be deferred with an explicit C3 waiver?
- Which create-error statuses does the server guarantee are pre-creation (that is, safe for `confirmed-not-created`)? `create_session` returns 400/403 before `pty_manager.create`. Errors from `pty_manager.create` need confirmation.
