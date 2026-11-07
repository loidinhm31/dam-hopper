# OS Desktop Polish — Cycle 10 Code Review

- **score: 7/10**
- **critical_count: 0**
- **Disposition:** approve with required follow-ups.
  - The Cycle 9 C1 is fixed: the catch path now classifies by status code, not text.
  - The unmounted-window reservation leak is fixed.
  - Still open:
    - the journal fails open when Web Locks or `localStorage` is unavailable
    - a failed launch can block a destination forever without telling the user
    - incarnation exactness is only partly fixed
    - the brief's dead-code cleanup claim is untrue
    - the classifier and close path have no tests

## Scope / evidence
- **Reviewed:**
  - `TerminalsApp.tsx` (full)
  - `persistence.ts`: `sanitizeAppState` :38-49 and the journal at :900-1285
  - `window-store.ts:133-149`
  - `action-executor.ts:224-308`
  - `ws-transport.ts:3254-3310` (error and epoch decoding)
  - `terminal-session-contract.ts:587-668`
  - `SearchApp.tsx` and `DesktopCanvas.tsx:51-106`
  - `WindowFrame.tsx:122-330`
  - the `OsShell.tsx` diff and `:357`
  - callers that drop the `ActionResult`
  - docs diffs
  - server: `pty/manager.rs:1594-1660,1847-1852`, `api/terminal.rs:178-231`, `api/config.rs:628-725`, `api/settings.rs:166-235`, `api/error.rs:93-115`
  - contract C3 (`architecture-contracts.md:48,62-82,189`)
- **Checks run (outputs observed):**
  - `tsc --noEmit` (packages/ui): exit 0.
  - `vitest run src/os src/lib src/stores src/hooks src/components`: 313 files, 2822/2822 passed.
  - `cargo test --lib config`: 134 passed.
  - `eslint` on the 80 changed or new UI TS/TSX files: **0 errors, 72 warnings**.
- **Not run:** browser tests, Playwright E2E, the full cargo suite.

## Verified resolved (this cycle)
- **Classifier:**
  - Only `ApiRequestError` with status 400/401/403/404/413/422 settles as `confirmed-not-created` (`TerminalsApp.tsx:207-214`).
  - Network errors (`TypeError`), 5xx, 408, 409, 429 and anything else settle as `uncertain`.
  - Synthetic `ApiRequestError`s on the `terminal:create` path come only from real non-OK HTTP responses (`ws-transport.ts:3281`), so the status allowlist is sound.
- **Immutability:** once a record is settled, later settlements cannot change it (`persistence.ts:1236-1242`). Covered by the test at `app-launch-journal.test.ts:244-277`.
- **Closing a window that was never dispatched:** `window-store.ts:133-149` settles it as `confirmed-not-created`. The check runs synchronously against store state, so it works for minimized, background-tab and other-desktop windows. This closes Cycle 9 W2.
- **Reload safety:** `sanitizeAppState` (`persistence.ts:43-49`) drops `attemptId` and `dispatched`. A restored window therefore becomes `isExistingOnly` and never re-sends. This matters because `PtyManager::create_with_buffer` kills any live session with the same ID (`manager.rs:1635-1636`). The reservation stays unresolved, which matches C3 rule 5. **No resend path found.**
- **Receipt incarnation:** it goes through `isCanonicalPositiveU64`; a missing or invalid value, or a missing epoch, settles `uncertain`.
- **Search mode:** derived during render, and the `deliveryId` key forces a remount on redelivery (`SearchApp.tsx:22-23,150`).

## Critical
None.

## Warnings
1. **High — The launch journal fails open when browser capabilities are missing, breaking C3 L64 and the repo's own pattern.**
   - `withLaunchJournalLock` (`persistence.ts:1012-1025`) silently falls back to an in-memory promise chain when `navigator.locks` is absent.
   - Web Locks is restricted to secure contexts. A self-hosted UI opened over plain-HTTP LAN (`http://192.168…`) therefore loses the cross-tab guard without any notice. Two tabs can both read the journal, both reserve and both create, which is the F1 duplicate.
   - `readLaunchJournalDocument` returns an empty document when `localStorage` is undefined (`:1028-1030`), and `writeLaunchJournalDocument` silently does nothing (`:1058`). Reservations then "succeed" without being durable.
   - The existing `recipes/launch-records.ts:21-27` throws instead (fail-closed), and has a test for it (`launch-records.test.ts:78`).
   - **Fix:** return `blocked` with an explicit reason when locks or storage are missing, and add tests. If plain-HTTP LAN must keep working, record an explicit contract waiver rather than degrading silently.
2. **Medium-High — An `uncertain` result is now the common failure outcome, but the user is never told it blocks the destination for good.**
   - With the new classifier, any 5xx, network drop, or PTY spawn failure (500) leaves the canonical destination blocked indefinitely, which C3 intends. However:
     - Dock, dock-context-menu, AppLauncher and CommandPalette still discard the `blocked` `ActionResult` (`Dock.tsx:74`, `dock-context-menu.tsx:147`, `AppLauncher.tsx:110`, `CommandPalette.tsx:152`), so "New Terminal Window" silently does nothing.
     - The reserve message says "…is already **in progress**" (`persistence.ts:1116`) even when the record is `uncertain`.
     - The button still reads "Retry Launch (Reserve New Attempt)" (`TerminalsApp.tsx:424-425`), but it can never succeed.
   - C3 L82 requires explaining the indefinite-block impact to the user.
   - **Fix:**
     - Return the existing record's state in `blocked`.
     - Show distinct copy for an uncertain record: "outcome unknown; destination blocked until resolved".
     - Surface blocked or failed results through the shell notice.
     - Hide or disable Retry when the record is `uncertain`.
3. **Medium — Incarnation exactness is only partly fixed (C3 L80).**
   - `TerminalsApp.tsx:162`: `String(sessionRes.incarnation)` runs without a `Number.isSafeInteger(n) && n > 0` check. An unsafe number rounds to a different value that still looks canonical. The server sends `incarnation: u64` as a JSON number with no `incarnationExact` on create.
   - `TerminalsApp.tsx:196-197` still writes `incarnation: sessionRes.incarnation, incarnationExact: String(sessionRes.incarnation)` into `appState`. This ignores the validated `rawIncarnation` and writes `"undefined"` when the field is missing.
   - The consumer in `terminal-session-contract.ts:639-656` rejects these values, so the result is fail-closed, but the brief's "incarnation exactness" claim is overstated.
   - The `(sessionRes as {incarnationExact?:string})` cast at `:161` is redundant, because `SessionInfo` already declares the field (`client.ts:209`).
   - **Fix:**
     ```ts
     const n = sessionRes.incarnation;
     const rawIncarnation = sessionRes.incarnationExact
       ?? (typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? String(n) : undefined);
     // appState: ...(isIncarnationValid ? { incarnation: n, incarnationExact: rawIncarnation } : {})
     ```
4. **Medium — An owner change after create settles `uncertain` when C3 rule 3 calls for an orphan `confirmed-success`.**
   - Code: `TerminalsApp.tsx:130-145`.
   - The response is the exact authoritative reply to the originating request: the epoch comes from the response header and the incarnation from the body. Rule 3 says to keep the orphan's success provenance and not publish it.
   - Settling `uncertain` permanently blocks that destination after any reconnect during create.
   - **Fix:** if the epoch and incarnation are valid, settle `confirmed-success` with the originating generation, then throw or skip publishing.
5. **Medium — Exceptions thrown before dispatch are classified `uncertain`.**
   - If `getApi` or `toServerFsTarget` (`:119-120`) throws, nothing was sent, but the catch path settles `uncertain`. That is a permanent block with no request ever made.
   - Rule 4 says validation before dispatch is safe.
   - **Fix:** set `let requestSent = false;` and flip it immediately before `client.terminal.create`. In the catch, `!requestSent` → `confirmed-not-created`.
6. **Medium — The dead-code and cleanup claim is untrue; there is unused contract scaffolding.**
   - Lint shows the same Cycle 9 warnings:
     - `action-dispatch.ts:11,13` (`ShortcutKeyEvent`, `useCognitoModeStore`) and `action-executor.ts:3,7` (`findExistingWindowForApp`, `ActionContext`)
     - `dam-hopper-app.tsx`: 7 items; `OsShell.tsx`: 5 (lines 51, 55, 70, 163, 164)
     - `WindowFrame.tsx`: 3 (lines 15, 79, 81); `AppLauncher.tsx:28`
     - `FilesApp.tsx`: 3 (lines 6, 19, 34); `GitApp.tsx`: 2 (lines 28, 49); `dock-pins.ts:9`
   - `getInFlightLaunchPromise` and `registerInFlightLaunchPromise` (`persistence.ts:1066-1084`) still have zero callers. Wire them in (C3 L48 "Promise coalescing in-process") or delete them.
   - `MAX_LAUNCH_RECORD_BYTES` (`:910`) is never used, so the 8 KiB-per-record cap in C3 L68 is not enforced.
   - `readLaunchJournalDocument` casts `records` without validating their shape (`:1051-1054`). A partially corrupt record (for example, missing `state`) is treated as settled and stops blocking anything.
   - `validate_window_placement` is a no-op `Ok(())` (`schema.rs:1421`).
7. **Medium — No tests cover the new safety logic.**
   - The status classifier, the `window-store.closeWindow` settlement and the TerminalsApp lifecycle are all untested. Missing cases:
     - close mid-create
     - close after success
     - minimize, then close before dispatch
     - missing epoch or incarnation
     - 5xx, `TypeError` and 404
     - an owner change after create
   - Only the journal primitives are tested. Cycles 7-9 found these bugs by probing, not through tests.
8. **Medium (carried over) — `terminal:open` and `?open=terminals` still bypass the journal.**
   - `OsShell.tsx:357-432` calls `client.terminal.create` directly.
   - It is reached from FilesApp, GitApp, ProjectInfoApp and the deep link (`deep-links.ts:230`).
   - Migrate these to `app.terminals.new-window`, or record a C3 waiver.
9. **Medium (carried over) — Settings import skips the new UI validators.**
   - `merge_global_ui_config` validates appearance, cognito and the `appShortcuts` allowlist (`config.rs:672-723`).
   - `import_workspace_settings` runs only `validate_protected_config_replacement` (`settings.rs:232`).
   - An imported out-of-range `dock_padding` or `cursor_theme` then makes every later UI PATCH return 400.
   - The pattern predates this change (`validate_font_sizes` has the same gap), but this diff widens it.
   - **Fix:** add a single `UiConfig::validate_all()` and call it from both paths.
10. **Medium-Low — The unmount cleanup duplicates the store path and has a narrow race that can lock in a wrong `confirmed-not-created`.**
    - `isDispatchedRef` is only updated when the component renders (`TerminalsApp.tsx:261-262`). Suppose `closeWindow` commits in the same React flush as the handler's synchronous `updateAppState({dispatched:true})`, for example a programmatic close inside the same effect pass.
    - Then the store path correctly skips the record, but the unmount cleanup sees a stale `false` and settles `confirmed-not-created`. The immutability guard then rejects the later success, and the next launch can create a duplicate.
    - User clicks cannot interleave there, so likelihood is low.
    - **Fix:** delete the component cleanup, because the store path is authoritative. For the `setSession` replacement path, settle in the store setter instead. Otherwise, use a handler-local `dispatchedRef.current = true` set before `updateAppState`.

## Suggestions
- **Arch / contract:**
  - `endpointBinding` is hard-coded to `"default-endpoint"` (`action-executor.ts:247`, `TerminalsApp.tsx:290`). Aliases of the same server across profiles are not detected (C3 L78). Bind to the profile's normalized endpoint, or document the limitation.
  - `settleTerminalLaunch` should return `already-settled` together with the stored state, rather than a plain `settled`.
- **DRY:**
  - The `LaunchIdentityParams` builder is duplicated (`action-executor.ts:248-263`, `TerminalsApp.tsx:288-303`). Extract `buildTerminalLaunchIdentity(target, ctx, cwd)`.
  - Terminal font bounds are duplicated in `action-dispatch` and `action-executor`.
  - Extra-action IDs exist in both Rust and TS; add a parity test.
- **Fabricated defaults:**
  - `generation ?? 1` (`action-executor.ts:236,317`)
  - `profileId ?? "default"` (`:316`, and the DesktopCanvas menu context)
  - Prefer `disabled`.
- **Robustness:** make the re-entrancy guard a ref, not the `isLaunching` state.
- **Error codes:** for server errors that prove nothing was created (for example `IdleSuspendHandoffInProgress`, or a PTY spawn failure after `cancel_create`), return a stable `code` that the client can allowlist. Without one, they become permanent `uncertain` blocks.
- **Perf (carried over):**
  - `handleLaunchSession` depends on the whole `window.appState` (`:229`).
  - Every TerminalsApp re-attaches on every registry change.
  - The DesktopCanvas container map is still mutated during render (idempotent, but undocumented).
- **Pre-existing, outside this diff:** the terminal `sanitizeAppState` drops `target`, `serverEpoch`, `generation` and `incarnation`. Journal-launched terminals therefore lose the provenance that `resolveWindowTerminalObservation` needs after a reload.
- **Docs:** `system-architecture.md` should state the indefinite-block user impact and the operator recovery path (C3 L82).
- **Security:** no new injection, XSS or authentication issues found. Server-side `appShortcuts` key and type checks hold on PATCH.

## Metrics
- Type check: tsc reports 0 errors.
- Tests: vitest 2822/2822 and cargo config 134/134 pass. There is no TerminalsApp, classifier or close-path coverage.
- Lint (80 files): 0 errors and 72 warnings, mostly unused imports/vars, plus `exhaustive-deps`, 1 `set-state-in-effect` and 2 `no-explicit-any`.

## Unresolved questions
- Must the journal fail closed on plain-HTTP LAN deployments (no Web Locks)? That would disable new terminal windows there. Or is a C3 waiver acceptable?
- Should a successful create whose owner changed afterwards settle as an orphan `confirmed-success` (rule 3) or as `uncertain`?
- Should `terminal:open` and the deep link migrate in this plan, or be deferred with a waiver?
