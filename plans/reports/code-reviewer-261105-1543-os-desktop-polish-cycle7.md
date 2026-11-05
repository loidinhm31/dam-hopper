# OS Desktop Polish — Cycle 7 Code Review

- **score: 5/10**
- **critical_count: 1**
- **Disposition: request changes.**
  - Fixed and verified: the TTL is gone, the dependency-driven cleanup rerun is gone, the error overlay renders on `launchError`, the desktop-menu notice reaches the shell, the missing-epoch case settles `uncertain`, and the shim is deleted.
  - Still broken: the new unmount cleanup writes false `confirmed-not-created` receipts on every real close, and probes reproduced this both mid-create and after success. The Search-mode fix also does not work (also reproduced by probe).

## Scope / evidence
- Reviewed:
  - `TerminalsApp.tsx` and `persistence.ts` (journal, :900-1278)
  - `SearchApp.tsx` and `SearchPanel.tsx`
  - `DesktopCanvas.tsx`, `DesktopContextMenu.tsx` and `OsShell.tsx` (notice, search:query, terminal:open, deep links)
  - `action-executor.ts`, `action-dispatch.ts`, `deep-links.ts`, `intents.ts` and `dam-hopper-app.tsx`
  - C3 in `architecture-contracts.md:60-82`, plus `plan-review.md:38-41`
- Checks run:
  - `tsc --noEmit` (packages/ui): 0 errors.
  - `vitest run` on src/os, src/components, the shortcuts, ui-config and context-menu suites, and stores/settings: 163 files, 1226 tests passed.
  - `cargo test config` (server): passed (134 + smaller suites).
  - `eslint` on 10 remediated files: 1 error and 29 warnings (details below).
  - Two throwaway vitest probes, one for TerminalsApp and one for SearchApp, both deleted afterwards.
- Not run: browser tests, E2E, the full cargo suite.

## Critical
### C1 — Unmount cleanup marks in-flight and successful launches `confirmed-not-created`, which re-enables duplicate PTYs
- **Location:** `TerminalsApp.tsx:254-272`. The condition is `!currentWin || (!dispatched && !target && !incarnation)`. On a real close the window is already gone from the store, so `!currentWin` is true whatever the attempt state was.
- **Probe result** (real store and journal; API, owner and claim mocked):
  - **Close during an in-flight create:** the record goes `reserved-dispatch-capable` → `confirmed-not-created`. It stays that way after create resolves, because the handler returns at `:149-155` without settling. A second `reserveTerminalLaunch` for the same identity then returns **`reserved`**, so a duplicate PTY can be launched.
  - **Close after success:** `confirmed-success` is overwritten to `confirmed-not-created` and the provenance receipt is lost.
- **Not only real close.** DesktopCanvas only renders non-minimized windows and the active tab of each pane (`DesktopCanvas.tsx:88-107`). So minimize, a tab switch or a desktop switch also unmounts TerminalsApp.
  - Suppose a window is not yet dispatched (for example, owner offline, so auto-launch hasn't fired). Unmounting it settles the record `confirmed-not-created`, but the window keeps its `attemptId`.
  - On remount, auto-launch dispatches under an already-settled attempt, so de-duplication is off.
  - The claim "runs ONLY on real window close" is false.
- **Root enabler:** `settleTerminalLaunch` (`persistence.ts:1209-1278`) has no transition guard; any caller can overwrite any state. This was carried over from Cycle 6.
- **Contract violated:** C3 rule 3 (keep orphan success provenance), rule 5 ("destination removal before known outcome → stays unresolved/uncertain"; "a stale token cannot erase or replace another attempt") and the "no dismiss-to-retry" rule. Closing a window acts as dismiss-to-retry.
- **Fix:**
  1. Cleanup:
     - If the window still exists, do nothing (the unmount is transient).
     - If the window is gone and the attempt was never dispatched, settle `confirmed-not-created`.
     - If the window is gone and the attempt was dispatched, write nothing; the in-flight handler owns settlement.
  2. In `handleLaunchSession`, always settle the journal after create resolves or rejects, even when the window was closed or replaced (orphan `confirmed-success` per rule 3). Only skip `updateAppState`.
  3. Add a monotonic guard in `settleTerminalLaunch` under the lock:
     - Only `reserved-dispatch-capable` may become `confirmed-success`, `confirmed-not-created` or `uncertain`.
     - `uncertain` may only become success or not-created with authoritative proof.
     - Settled records are immutable.
  4. Add a TerminalsApp test file covering: close mid-create, close after success, minimize before dispatch, and a missing epoch.

## Warnings
1. **High — The Search-mode fix has no effect** (probe: a second delivery with `filename` mounted the panel with `initialMode='content'`).
   - `SearchApp.tsx:158` remounts SearchPanel through `key=…deliveryId` in the same render, while `currentMode` is still stale.
   - The `useEffect` at `:27-31` updates it only after commit, and SearchPanel's `useState` initializer ignores later props.
   - It is also flagged by `react-hooks/set-state-in-effect`.
   - **Fix:** derive the mode during render (`const mode = raw === "filename" ? "filename" : "content"`), pass it directly, and delete the state and the effect. User-toggled mode is still lost on a scope toggle because there is no `onModeChange` (carried over).
2. **Medium — Search mode vocabulary mismatch.**
   - The `search:query` intent mode is `"text" | "filename"` (`intents.ts:137`). The deep-link qualifier emits `"text"` (`deep-links.ts` `qualifyOsDeepLink`), and OsShell copies it raw into `appState.searchMode` (`OsShell.tsx:1185-1186`).
   - SearchPanel then sets `mode="text"`, so `queries["text"]` is undefined and the query is lost. The header reads "Find File" because `mode !== "content"`.
   - The new `?? ""` and `query?.length` guards (`SearchPanel.tsx:106,355`) hide this symptom instead of fixing it.
   - **Fix:** normalize `"text"` → `"content"` at one boundary (OsShell or SearchApp), or unify the union.
3. **Medium — Fabricated provenance is still possible.**
   - `TerminalsApp.tsx:165` does `incarnation: String(sessionRes.incarnation)`. The create response type has `incarnation?: number` and `incarnationExact?: string` (`client.ts:207-209`). With a valid epoch but a missing incarnation, `confirmed-success` stores `"undefined"`.
   - This breaks C3 line 80 ("never `String(unsafe-number)`… do not invent it; record uncertainty").
   - **Fix:** use `incarnationExact`, fall back only to `Number.isSafeInteger(n) && n > 0`, and otherwise record `uncertain`.
   - The catch block still classifies errors by text (`:198-202`): "Failed to fetch" and 5xx become `confirmed-not-created`, which C3 rule 4 forbids (carried over).
4. **Medium — `terminal:open` bypasses the C3 journal.**
   - `OsShell.tsx:357-432` calls `client.terminal.create` directly, with no reserve or settle. This path serves the FilesApp, GitApp and ProjectInfoApp "open terminal here" buttons; this diff touched the GitApp and ProjectInfoApp payloads.
   - It also serves deep links: `?open=terminals` creates a PTY on every load with no de-duplication.
   - `plan-review.md:38-41` required explicit-folder launches to go through New Window semantics and the same journal. C3 rule 2 says Open/Focus and New obey the same guard.
5. **Medium — The launch error is not persisted.** The catch block only calls local `setLaunchError`; it never writes `appState.createError`. After any remount (minimize, tab or desktop switch), the error and the Retry overlay disappear and a blank terminal remains.
6. **Medium — Blocked and uncertain results are still silent outside the desktop menu.**
   - `Dock.tsx:74`, `dock-context-menu.tsx:138,147`, `AppLauncher.tsx:110`, `CommandPalette.tsx:152` and `OsShell.tsx:1516` discard the `ActionResult`.
   - Only `DesktopContextMenu` reports `blocked`, and even it ignores `failed` and `uncertain`.
   - `OsShell.tsx:1640` labels launch notices `kind:"storage-error"`, which is the wrong kind.
7. **Low — The claimed dead-code cleanup is incomplete, and lint regressed versus HEAD.**
   - `action-dispatch.ts:11,13`: unused `ShortcutKeyEvent` and `useCognitoModeStore`.
   - `dam-hopper-app.tsx`: 5 unused imports (`useNavigate`, `useQuery`, `getServerUrl`, `buildAuthHeaders`, `getActiveProfile`) and 2 unused vars (`routerBasename`, `activeProfileConnectionKey`).
   - `action-executor.ts:3-34`: **11 new** unused imports. These include `settleTerminalLaunch`, `getApi` and `getConnectionSnapshot`, leftovers from moving create into TerminalsApp. HEAD had 0 warnings.
   - `OsShell.tsx`: 5 unused items.
   - **New lint error:** `DesktopCanvas.tsx:292-295` (`react-hooks/refs`) lazily creates portal containers in a ref during render. It works in practice but is impure under concurrent rendering. Move creation into a `useState` map or a layout effect, or add a justified disable comment.
8. **Low — Plan and docs.** `plan.md` says `status: completed` while C1 is open. CHANGELOG/roadmap claim "qualification complete".

## Verified resolved
- The TTL is removed. `reserveTerminalLaunch` blocks on any unresolved record with no time release (`persistence.ts:1107-1119`), and compaction never evicts unresolved records.
- The dependency-driven cleanup rerun is gone (`[]` deps plus refs). The mid-create false receipt from Cycle 6 no longer happens while the window stays open.
- The error overlay is gated on `launchError !== null` (`TerminalsApp.tsx:386`).
- A missing or non-canonical `serverEpoch` settles `uncertain` (`:169-181`). No epoch is fabricated.
- `DesktopCanvas` forwards `onNotice` to `DesktopContextMenu` (`DesktopCanvas.tsx:210`, `OsShell.tsx:1640`).
- `use-browser-shortcut-guard.ts` is deleted with no remaining references. The `system-architecture.md` "Planned Design" heading is gone.
- The duplicate `worktreePath`, `targetProject` and `targetProfileId` variables are removed from SearchPanel.

## Suggestions
- Arch/KISS:
  - Keep one attempt state machine (`reserved → dispatched → success | uncertain | not-created`) in appState, separate from stream attachment, and let it drive both the overlay and settlement.
  - Delete the `hasRendererRegistered`, `isRemoteAttached` and `isDispatched` heuristics.
  - Transition rules belong inside `settleTerminalLaunch` (carried over).
- Perf:
  - `handleLaunchSession` depends on the whole `window.appState` (`:221`), so it is recreated on every patch and the auto-launch effect re-runs each time.
  - Every TerminalsApp re-runs `attachTerminalsToHost` and `setState` on any registry change, which is O(N²). Filter by key.
- DRY: the two creation paths (TerminalsApp and OsShell `terminal:open`) duplicate the connect / create / recheck-owner / epoch logic. Unify both behind the executor and journal (this also closes W4).
- Security: there are no new injection or auth issues in the reviewed surface. The server still validates `appShortcuts` keys and value types (config tests pass). A deep link that auto-creates a PTY (W4) is a minor drive-by-resource concern; consider requiring a user gesture.
- Tests: add tests for the TerminalsApp journal lifecycle and for SearchApp redelivery; neither exists, and both bugs were found only by probes.

## Metrics
- Type check: tsc reports 0 errors.
- Tests: 1226/1226 targeted vitest tests and the cargo config tests pass. There is no TerminalsApp or SearchApp redelivery coverage.
- Lint on the 10 reviewed files: 1 error (DesktopCanvas refs, new) and 29 warnings (~25 unused imports/vars, 4 `set-state-in-effect`). HEAD had 0 errors on these files.

## Unresolved questions
- Should the deep link `?open=terminals` keep auto-creating a PTY, or should it open the window with a Launch button?
- Should `terminal:open` (explicit folder) be migrated onto `app.terminals.new-window` and `terminalCreate` in this plan, or deferred with an explicit contract waiver?
