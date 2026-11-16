# Phase 02 — Cycle 4 code review

**Score: 6/10 — changes required.** Cycle 3 follow-up fixes added `browser-admission-guard.ts` (`commitNativeTargetAdmission`, `reserveCloseOrRelease`), wired `runtime` identity into `closeSelectedInventorySession` and `dispatchBrowserCreateIntent` late/withheld cleanup, added post-settlement owner/tab recheck before adoption (`browser-create-lifecycle.ts:117`), added post-stage `operationId` check in `coordinateBrowserWindowClose` (`browser-window-close-coordinator.ts:72`), and preserved `withheldCleanups` entries until `"closed" | "released"` resolution (`browser-create-lifecycle.ts:58-60`). However, several high-impact concurrency, durability, and schema-validation gaps from Cycle 3 and Phase 02 acceptance criteria remain unresolved. Review-only: source and plan/task state unchanged.

Findings below are **[INFERENCE] from inspected control flow**, high confidence; not dynamic reproductions. `Phase02FinalTester` verified `pnpm --filter @dam-hopper/ui test src/os/browser/ src/os/persistence.test.ts` (9/9 files, 64/64 tests pass) and `pnpm --filter @dam-hopper/ui build` (0 errors).

## Critical issues

1. **Native-target release/admission still races simultaneous closes and leaves closing gates stuck on rejection.**
   - `packages/ui/src/os/browser/browser-window-close-coordinator.ts:73,82-99` marks all tabs in the closing window `phase: "closing"` in `useWindowStore` *before* iterating `closeBrowserTarget`, while `countRetainedNativeReferences` (`browser-native-reference-census.ts:31`) skips any tab with `tab.phase === "closing"`. If two tabs in the same window or two windows closing concurrently share a native target, the first `closeBrowserTarget` call sees `remaining === 0` (because the sibling's `phase` is already `"closing"`) and issues `DELETE` prematurely. Conversely, if two callers invoke `closeBrowserTarget` without pre-mutating `tab.phase = "closing"`, both pass `stageRecoveryOperation` and each sees the other's still-`"live"` tab in `reserveCloseOrRelease` (`browser-close-lifecycle.ts:90-98`), so both return `"released"` with zero `DELETE`.
   - `browser-close-lifecycle.ts:90,111-114,130-133,147-150`: `reserveCloseOrRelease` adds `targetKey` to `closingTargetGates`, but the three `{ kind: "rejected" }` branches (owner mismatch pre-GET, runtime mismatch on GET, owner mismatch post-GET) return without calling `removeClosingGate(targetKey)`, permanently blocking local admission for that target key. Additionally, runtime mismatch on GET (`130-132`) calls `stageUnknown()` even though zero `DELETE` was issued and the live target was proven replaced.
   - `browser-native-reference-census.ts:36` uses `isBrowserRuntimeCompatible(runtime, tab.snapshot)` to filter retained references, so a tab holding a conflicting snapshot is ignored (`count = 0`) instead of conservatively withholding destructive deletion (`design.md:31`).
   - **Correction:** Track per-view release atomically before census or exclude only already-released views, recheck census after `getBrowserSession` before `closeBrowserSession`, release `closingTargetGates` on known pre-DELETE rejections, and treat conflicting retained runtime evidence as a blocker against destructive `DELETE`.

2. **Late-create group linkage and exact-session recovery can still be lost or throw unhandled rejections.**
   - `packages/ui/src/os/browser/browser-create-lifecycle.ts:116-125`: When `ownerStillCurrent && tabStillCurrent` initially holds, `await settleRecoveryOperation(operationId)` (`116`) deletes the operation (and any `groupId` attached by a concurrent `coordinateBrowserWindowClose`) from recovery storage *before* line `117` rechecks `isCapturedBrowserOwnerCurrent` and `isTabCurrent()`. If the tab closed or owner changed during that lock wait, line `124` reads `existingOp` after deletion (`groupId === undefined`), unblocking automatic restore of the closing group while late cleanup is still pending/unknown.
   - `browser-create-lifecycle.ts:123,175` calls `loadBrowserRecoveryDisk()` *outside* `withBrowserRecoveryLock` (TOCTOU race against concurrent `coordinateBrowserWindowClose`), and if `loadBrowserRecoveryDisk()` throws on corrupt/oversized storage inside `catch` (`175`), the rejection escapes `execute()` unhandled.
   - If `closeBrowserTarget` or `settleRecoveryOperation` throws after `createBrowserSession` succeeded (`116,140`), execution enters `catch` (`166-188`) and overwrites the recovery record back to `kind: "create"` without `sessionId: session.browserSessionId`.
   - `WithheldCleanup` (`29-36,50-57`) omits `groupId` and `tabId`, so `processWithheldCleanups` restages `operationId` via `closeBrowserTarget` (`browser-close-lifecycle.ts:79-88`) with `groupId: undefined` and `kind: "close-window"`, and lacks a `.catch(...)` on `void closeBrowserTarget(...)`.
   - **Correction:** Preserve existing `groupId` and `sessionId` inside `stageRecoveryOperation` under the recovery lock when updating an existing `operationId`; do not delete the recovery operation before confirming final adoption; carry `groupId`/`tabId` on `WithheldCleanup` and guard `processWithheldCleanups` against duplicate in-flight dispatches and unhandled rejections.

## Warnings

1. **High — `coordinateBrowserWindowClose` still has replacement-window and initial-stage failure bugs.**
   - `packages/ui/src/os/browser/browser-window-close-coordinator.ts:57-80,130-139`: `curState.closing` is set only *after* `await stageRecoveryOperation(...)` (`57`). If `stageRecoveryOperation` throws (e.g., Web Locks unavailable or storage quota exceeded), `catch` (`135`) checks `if (curState.closing?.operationId !== windowOpId) return state;` which evaluates `undefined !== windowOpId` (`true`) and silently drops the error without marking the window `unknown` or notifying the user.
   - If the original window was replaced by a new window at the same `windowId` while `stageRecoveryOperation` was awaiting, the new window has `curState.closing === undefined`, so line `72` (`if (curState.closing && curState.closing.operationId !== windowOpId)`) does not trip; it marks the replacement window closing and closes the old `appState.tabs` (`82`).
   - Legacy branch (`150-158`) still has no `.catch(...)` on `void closeBrowserTarget(...)`.
   - **Correction:** Capture and fence against the exact initial window reference (or mark `closing: { operationId: windowOpId, status: "pending" }` before awaiting `stageRecoveryOperation`, reverting/transitioning to `"unknown"` on failure) and attach `.catch(...)` to the legacy close promise.

2. **High — Malformed or oversized Browser state in OS session is silently dropped instead of failing closed.**
   - `packages/ui/src/os/persistence.ts:69-85`: When `parseBrowserWindowDisk` returns `{ valid: false, error }`, `sanitizeAppState` returns `undefined`. Neither `validateOsSession` (`304-657`) nor `loadOsSession`/`importOsSessionJson`/`importOsEnvelope` surfaces `parsed.error` or suspends autosave (`preservedCorruptBytes`).
   - `packages/ui/src/os/browser/browser-persistence.ts:119-188`: `parseBrowserWindowDisk` silently skips non-object tab entries (`120`), invents replacement UUIDs for missing `tabId`s (`122`), repairs missing/invalid `activeTabId` (`163-168`), and retains `tab.sessionId` with `phase: "connecting"` (`130-135`) even when `ownerScope` (`170-187`) is missing or invalid (`phase-02-persistence-and-lifecycle.md:56`: *"Local ordinary tabs keep exact session hints only within owner scope"*).
   - Also in `persistence.ts:83-84`, `sanitizeAppState` runs `projectBrowserWindowState` even on `"import"` and `loadOsSession`, stripping runtime `phase`, `kind`, `draft`, and `actionSequence` computed by `parseBrowserWindowDisk`.
   - **Correction:** Validate `ownerScope` before admitting local `sessionId` hints; reject malformed tab items/IDs/activeTabId and propagate Browser schema errors in `validateOsSession`/import/load so corrupt bytes are preserved and notices emitted.

3. **High — `validateBrowserRecoveryDisk` still accepts prototype keys, invalid URLs/endpoints, and duplicate groups.**
   - `packages/ui/src/os/browser/browser-recovery-validation.ts:10-23,41-81`:
     - `isValidScope` (`13`) checks `s.endpoint.trim().length > 0` without `normalizeBrowserEndpoint(s.endpoint)`.
     - `ALLOWED_OP_KINDS[op.kind]` (`63`) matches `Object.prototype` properties (`"constructor"`, `"toString"`).
     - Group `addresses` (`48`) only check `a.trim().length > 0` instead of `normalizeBrowserCommittedUrl(a)` (allowing `javascript:` or userinfo URLs).
     - Duplicate `groupId`s, multiple groups for the same `ownerScope`, and non-string optional `op.groupId`/`op.tabId`/`op.sessionId` are not rejected.
   - **Correction:** Use `Object.hasOwn(ALLOWED_OP_KINDS, op.kind)`, validate/normalize `endpoint` and group `addresses`, validate optional string fields, and enforce unique `groupId` and at most one group per `ownerScope`.

4. **High — Single-flight create still forgets consumed `actionSequence` tokens after settlement.**
   - `packages/ui/src/os/browser/browser-create-lifecycle.ts:80-82,189-191`: `inFlightCreates.delete(intentKey)` removes the entry in `finally`. A remount or repeated call with the same `(owner, windowId, tabId, actionSequence)` after resolution (including `"unknown"` or `"rejected"`) mints a new `operationId`/`creationKey` and dispatches a second `POST`.
   - **Correction:** Retain settled/unknown intent outcomes keyed by `(profileId, generation, windowId, tabId, actionSequence)` until the tab advances to a new `actionSequence` or closes.

5. **Medium — Startup recovery gate restoration is unlocked, clears active in-memory gates, and omits initial unknown notices.**
   - `packages/ui/src/os/OsShell.tsx:208-213`: `setSession(loaded)` runs before `restoreClosingGatesFromRecovery()`, which performs an unlocked `loadBrowserRecoveryDisk()` and swallows errors (`browser-closing-gates.ts:25-36`). Startup does not check `disk.operations.some((op) => op.status === "unknown")` to call `setNotice`.
   - `browser-closing-gates.ts:28`: `closingTargetGates.clear()` wipes the shared `Set` on every recovery refresh, which can erase an active in-memory gate added by `reserveCloseOrRelease`.
   - **Correction:** Separate active in-memory closing gates from durable-recovery closing gates (union on `isNativeTargetClosing`), and restore gates + unknown-operation notices from the locked recovery read during `loadOsSession`.

6. **High — Missing fault-injection and race regression tests from Phase 02 verification list.**
   - Existing 64 tests pass, but test lock doubles still execute callbacks immediately without queuing (`browser-recovery-store.test.ts:37-42`), and key regressions remain unauthored: queued-lock concurrent interleavings, close-during-create group blocker retention, `processWithheldCleanups` on owner return, `commitNativeTargetAdmission` vs final-close race, coordinator rejected/mixed child outcomes and replacement-window fencing, portable OS export/import Browser sanitization in `persistence.test.ts`, stale-document autosave under address suppression, and malformed recovery validation edge cases.

## Suggestions

- **KISS / YAGNI / DRY:** Module boundaries (`<200` LOC each) are clean and well-factored. Centralize recovery operation upsert logic in `stageRecoveryOperation` so `groupId` and `sessionId` are never dropped across status transitions.
- **Dead code / hygiene:** Remove unused imports `closeBrowserSession` and `getConnectionSnapshot` and `ConnectionRef` in `packages/ui/src/os/window-store.ts:43,45-46`; remove unused `win` parameter in `coordinateBrowserWindowClose` (`browser-window-close-coordinator.ts:28`) and unused `currentScope` parameter in `processWithheldCleanups` (`browser-create-lifecycle.ts:46`).
- **Active tab fallback:** `resolveActiveTabId` (`browser-url-normalization.ts:29-40`) still falls back to `ordinaryTabs[0]` instead of the nearest surviving ordinary tab when a popup's opener tab is absent (`design.md:101`).

## Reviewed files

- `packages/ui/src/os/browser/browser-admission-guard.ts`
- `packages/ui/src/os/browser/browser-close-lifecycle.ts`
- `packages/ui/src/os/browser/browser-closing-gates.ts`
- `packages/ui/src/os/browser/browser-create-lifecycle.ts`
- `packages/ui/src/os/browser/browser-group-projection.ts`
- `packages/ui/src/os/browser/browser-native-reference-census.ts`
- `packages/ui/src/os/browser/browser-persistence.ts`
- `packages/ui/src/os/browser/browser-recovery-store.ts`
- `packages/ui/src/os/browser/browser-recovery-validation.ts`
- `packages/ui/src/os/browser/browser-session-inventory.ts`
- `packages/ui/src/os/browser/browser-url-normalization.ts`
- `packages/ui/src/os/browser/browser-window-close-coordinator.ts`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/window-store.ts`
- `packages/ui/src/os/browser/browser-persistence.test.ts`
- `packages/ui/src/os/browser/browser-recovery-store.test.ts`
- `packages/ui/src/os/browser/browser-create-lifecycle.test.ts`
- `packages/ui/src/os/browser/browser-close-lifecycle.test.ts`
- `packages/ui/src/os/browser/browser-session-inventory.test.ts`
- `packages/ui/src/os/browser/browser-window-lifecycle.test.ts`
- `packages/ui/src/os/persistence.test.ts`

## Validation commands / results

- `git status --short && git diff --stat` — exit 0 (5 tracked modified files, 21 untracked files).
- `git diff -- packages/ui/src/os/OsShell.tsx packages/ui/src/os/persistence.ts packages/ui/src/os/window-store.ts` — exit 0; inspected all hunks.
- `grep` for `TODO|FIXME|HACK|XXX` across all scoped Phase 02 files — 0 matches.
- Prior tester verification (`Phase02FinalTester`):
  - `pnpm --filter @dam-hopper/ui test src/os/browser/ src/os/persistence.test.ts` — 9/9 test files passed, 64/64 tests passed (1.65s).
  - `pnpm --filter @dam-hopper/ui build` — exit 0, 0 errors (9.29s).

## Unresolved questions

- None requiring product decisions; all findings have deterministic fixes specified in `design.md` and `phase-02-persistence-and-lifecycle.md`.
