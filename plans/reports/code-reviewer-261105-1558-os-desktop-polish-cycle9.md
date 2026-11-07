# OS Desktop Polish — Cycle 9 Code Review

- **score: 6/10**
- **critical_count: 1**
- **Disposition: request changes.**
  - Fixed and verified: the Cycle 7 C1 (false receipts written on unmount), the Search-mode redelivery, the missing-epoch → `uncertain` case, and the DesktopCanvas lint error.
  - Still open: the catch-path classifier, carried over since Cycle 7 as W3. It still turns ambiguous network/5xx failures into `confirmed-not-created`, which brings back the duplicate-PTY failure that C3 exists to prevent.

## Scope / evidence
- Reviewed:
  - `TerminalsApp.tsx` (full) and `persistence.ts` (journal, :1066-1285)
  - `SearchApp.tsx`, `SearchPanel.tsx` and `DesktopCanvas.tsx`
  - `action-executor.ts` (:226-308) and `action-dispatch.ts` (:240-346)
  - The `dam-hopper-app.tsx` diff and the `TerminalPanel.tsx` diff
  - `OsShell.tsx` (:180-296, :357-432) and `deep-links.ts` (:145-272)
  - `client.ts` and `ws-transport.ts:3281`
  - Server side: `api/config.rs` (diff), `config/schema.rs` (:727-771, :1425-1442), `config/global.rs` (diff) and `api/settings.rs` (:166-235)
  - Contract: `architecture-contracts.md` C3 (:60-82) and C7 (:153)
- Checks run:
  - `tsc --noEmit` (packages/ui): exit 0.
  - `vitest run src/os src/components src/lib src/stores src/hooks`: 313 files, 2822 tests passed.
  - `cargo test config` (server): 134 + smaller suites passed.
  - `eslint` on 31 changed files: 0 errors, about 44 warnings.
- Not run: browser tests, E2E, the full cargo suite.

## Critical
### C1 — The catch-path classifier marks ambiguous failures `confirmed-not-created`, re-enabling duplicate PTYs
- **Location:** `TerminalsApp.tsx:194-207`. Classification is a text match: `msg.includes("generation"|"connected"|"timeout"|"abort")`, and anything else becomes `confirmed-not-created`.
- **The status codes are not used.** Transport errors are `ApiRequestError(err.error ?? \`HTTP ${status}\`, status)` (`ws-transport.ts:3281-3284`). So:
  - A proxy 502/503/504 produces the message `HTTP 504`, which becomes `confirmed-not-created`.
  - A dropped connection after the request was sent (`TypeError: Failed to fetch`) also becomes `confirmed-not-created`.
- **Impact:**
  - The server may have created the PTY while the response was lost.
  - The record settles not-created, so "Retry Launch (Reserve New Attempt)" (`:401-418`) reserves a new attempt with a new requested ID, and a second PTY is created.
  - This is the exact F1 failure mode. It violates C3 rule 4 ("Generic HTTP error/timeout/abort/disconnect is not proof") and rule 5. It has been carried over since Cycle 7 W3.
- **Fix:** classify on structure, not text:
  - **`uncertain`:** after dispatch, every error that is not an `ApiRequestError` (network errors, aborts, timeouts), every 5xx, and every 408/429.
  - **`confirmed-not-created`:** only explicit authoritative rejections, meaning `err instanceof ApiRequestError` with a 4xx status the API documents as "not created" (validation 400/404/409/422, auth 401/403), plus the existing pre-dispatch validation paths.
  - Add unit tests for the classifier.

## Warnings
1. **High — Fabricated incarnation provenance (carried over from Cycle 7 W3).**
   - `TerminalsApp.tsx:163` sets `incarnation: String(sessionRes.incarnation)`, `:188` sets `incarnationExact: String(sessionRes.incarnation)`, and `persistence.ts:1253` does the same again.
   - The response type has `incarnation?: number` and `incarnationExact?: string` (`client.ts:207-209`). If the incarnation is missing, the stored value becomes `"undefined"` inside a `confirmed-success` receipt and in the claim key (`:61`). Unsafe numbers are also stringified.
   - This violates C3 line 80.
   - **Fix:** use `incarnationExact`, which must pass `isCanonicalPositiveU64` (it exists in `terminal-session-contract.ts:360` but is unused here). Fall back only to `Number.isSafeInteger(n) && n > 0`. Otherwise settle `uncertain`.
2. **Medium — A window closed while unmounted leaks its reservation forever.**
   - The cleanup lives in the component unmount (`TerminalsApp.tsx:257-273`). DesktopCanvas mounts only `activeWindowIds`: windows that are not minimized and are the active tab on the current desktop (`DesktopCanvas.tsx:91-109`).
   - Example: a terminal opened while the owner was offline (so auto-launch did not fire), then minimized or placed in an inactive tab, then closed from the Dock or the tab group. The cleanup never runs, and the record stays `reserved-dispatch-capable` forever (no TTL, by design).
   - Result: "New Terminal Window" for that profile/target/cwd is blocked indefinitely, even though the app *knows* nothing was dispatched (`appState.dispatched` is false).
   - **Fix:** move the "never dispatched → `confirmed-not-created`" settlement into the window-store close/remove path, keyed on the removed window's `appState.attemptId` and `!dispatched`. Then delete the component cleanup and its three refs.
3. **Medium — `terminal:open` and the deep link still bypass the C3 journal (carried over).**
   - `OsShell.tsx:357-432` calls `client.terminal.create` directly, with no reserve or settle.
   - Callers:
     - the FilesApp, GitApp and ProjectInfoApp "open terminal here" actions
     - `?open=terminals` (`deep-links.ts:230`), which creates a PTY from a URL alone
   - Plan-review required these to go through New Window semantics.
4. **Medium — Server settings import skips the new validation, which can break later UI saves.**
   - `merge_global_ui_config` (`api/config.rs:668-724`) enforces the `appShortcuts` key allowlist, `validate_appearance` and `validate_cognito_mode_shortcut`.
   - The TOML import path (`api/settings.rs:166-235`) and the TOML load path validate none of them.
   - The client sends partial patches (`stores/settings.ts:674-676`), and merge validates the *whole* merged config. So an out-of-range `dock_padding`, a bad `cursor_theme` or an unknown `app_shortcuts` key, whether imported or hand-edited, makes **every** later unrelated UI PATCH fail with 400.
   - **Fix:** run the same `UiConfig` validators in config load/import validation (one `UiConfig::validate_all`), and move the allowlist into schema next to the deserializer.
5. **Medium — Dead code and an overstated cleanup claim.**
   - `getInFlightLaunchPromise` / `registerInFlightLaunchPromise` (`persistence.ts:1066-1084`) are exported but have no callers (YAGNI). Either wire them into the launch path (C3 "Promise coalescing in-process") or delete them.
   - Lint still reports unused items:
     - `action-dispatch.ts:11,13` (`ShortcutKeyEvent`, `useCognitoModeStore`) and `action-executor.ts:3,7` (`findExistingWindowForApp`, `ActionContext`): the brief claimed these files were cleaned.
     - `OsShell.tsx`: 5 unused items (lines 51, 55, 70, 163, 164).
     - `WindowFrame.tsx`: 3 (lines 15, 79, 81).
     - `AppLauncher.tsx:28`: `className`.
     - `dam-hopper-app.tsx`: 7 items. These predate this diff, but the brief claimed they were cleaned.
6. **Low — Blocked, failed and uncertain `ActionResult`s are still dropped** by Dock, dock-context-menu, AppLauncher and CommandPalette. `OsShell.tsx:1640` labels launch notices `kind:"storage-error"` (carried over).

## Suggestions
- **Arch:**
  - `settleTerminalLaunch` returns `{status:"settled"}` both when it writes and when it ignores a conflicting outcome on an already-settled record. Return a distinct `already-settled` result carrying the stored state, so callers and tests can tell the two apart.
- **Robustness:**
  - `isDispatchedRef` mirrors props (`TerminalsApp.tsx:253-254`), so it lags the synchronous `updateAppState(dispatched:true)` by one render. A local ref set inside the handler is exact. Moot if W2 moves cleanup to the store.
  - The re-entrancy guard is React state (`isLaunching`). Use a ref, or the coalescing map from W5.
- **KISS — DesktopCanvas:** the `useState(() => new Map())` "fix" silences `react-hooks/refs`, but `getPresentationContainer` still mutates the map during render (`DesktopCanvas.tsx:52-63`, used in the render path). It is idempotent and keyed by id, so it is acceptable, but it is the same pattern as before. Either document it as an intentional lazy cache or create containers in a layout effect.
- **DRY:**
  - The terminal font-size step and the 10–32 bounds are duplicated in `action-dispatch.ts:298-327` (stage 5d) and `action-executor.ts:141-155`. Have 5d dispatch `terminal.font-increase`/`decrease` through the executor.
  - `LaunchIdentityParams` is built twice: `action-executor.ts:248-263` and `TerminalsApp.tsx:277-295`. Extract a single builder.
  - The extra-action ID list exists in both Rust (`api/config.rs:611`) and TS (`actions.ts:115`). Add a parity test.
- **Fabricated defaults:**
  - The desktop menu context falls back to `{profileId:"default"}` (`DesktopCanvas.tsx:213`).
  - The executor uses `generation ?? 1` (`action-executor.ts:236`).
  - Prefer `disabled` over invented identity.
- **Perf:**
  - `handleLaunchSession` depends on the whole `window.appState` (`:221`), so it is recreated on every patch and the auto-launch effect re-runs.
  - Every TerminalsApp re-attaches on every registry change, which is O(N²).
  - Both are carried over.
- **Tests:** there is still no TerminalsApp lifecycle test (close mid-create, close after success, minimize before dispatch, missing epoch or incarnation, 5xx/network classification) and no SearchApp redelivery test. The Cycle 7 bugs were found only by probes.
- **Security:** no new injection or auth issues. Server `appShortcuts` key and type checks hold on the PATCH path (W4 covers import). A deep link auto-creating a PTY is a minor drive-by resource concern.

## Verified resolved (this cycle)
- **Immutability guard:** settled → settled is now a no-op (`persistence.ts:1235-1242`). The test at `app-launch-journal.test.ts:244-277` covers overwrite of a success.
- **Handler settlement:** the handler always settles after create, even if the window is closed or replaced. Only `updateAppState` is skipped (`TerminalsApp.tsx:167-193`). An orphan success is kept, per rule 3.
- **Unmount cleanup:** it does nothing while the window is still in the store, so minimize, tab switch and desktop switch are safe (`:262-264`). It settles not-created only when the window is gone and was never dispatched.
- **Search mode:** derived during render (`SearchApp.tsx:22-23`) and remounted via the `deliveryId` key. `"text"` normalizes to `"content"`, which closes the Cycle 7 vocabulary bug in practice.
- **Missing or invalid `serverEpoch`:** settles `uncertain` (`:154-179`).
- **DesktopCanvas `react-hooks/refs` error:** gone (0 lint errors).
- **Font shortcut migration:** `GlobalTerminalFontSizeShortcuts` removal is safe. The root coordinator handles the shortcut, and xterm skips coordinator-handled events (`TerminalPanel.tsx` `isEventHandledByCoordinator`), so there is no double-fire.
- **Iframe continuity (C7):** preserved. Iframes live in the root `OsResourceHost`, not inside the reparented presentation containers.

## Metrics
- Type check: tsc reports 0 errors.
- Tests: vitest 2822/2822 and the cargo config tests pass. There is no TerminalsApp or SearchApp lifecycle coverage.
- Lint (31 files): 0 errors, about 44 warnings: about 26 unused imports/vars, 6 `set-state-in-effect`, the rest `exhaustive-deps`.

## Unresolved questions
- Which `terminal.create` error statuses does the server document as "definitely not created"? This is needed to finalize the C1 allowlist.
- Should `terminal:open` and `?open=terminals` be migrated onto `app.terminals.new-window` in this plan, or deferred with an explicit contract waiver?
