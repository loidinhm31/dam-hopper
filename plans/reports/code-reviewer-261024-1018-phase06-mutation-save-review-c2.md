# Phase 06 Code Review — Cycle 2 (mutation/save identity + unknown reconciliation, C4/C5)

Reviewer: Phase06ReviewerC2 · Plan: `plans/261023-1429-native-editor-file-explorer/phase-06-mutation-save-integration.md` · Prior: `code-reviewer-261024-1003-phase06-mutation-save-review-c1-7.md`

## Score: 5/10
Several Cycle 1 fixes landed and work in the real flow: owner alignment, preservation of the Unknown-save baseline, rekey before release, a single tab emission, and the subtree collision check. However, a new Critical breaks the default dirty-save path for every rename, move, and delete. C1 #3, #4, #5, #7 and #11 are still open, and the explicit-overwrite path bypasses the arbiter.

## Validation
- `.\native-app\gradlew.bat -p native-app :shared:jvmTest --rerun --tests FileEditorMutationTest --tests FileOperationArbiterTest --tests FileMutationCoordinatorTest --tests EditorSaveRaceTest`: BUILD SUCCESSFUL.
- `.\native-app\gradlew.bat -p native-app :shared:jvmTest --rerun`: BUILD SUCCESSFUL.
- `.\native-app\gradlew.bat -p native-app :androidApp:compileDebugKotlin`: BUILD SUCCESSFUL.
- Reviewer scratch probe `ZzReviewerScratchC2Test.kt` was run and then **deleted**. Observed output:
  - P1: dirty `src/Main.kt`, `renameWithOutcome("src","sources")` with the default SAVE → `Rejected(code=ERROR, message=Nothing to save)`, 0 fs:op dispatched.
  - P3: wildcard-owner (`project="*"`) repo; a mutation reserves `src`, then `saveTab` → `Error(...currently reserved...)`. **C1 #1 fixed.**
  - P4: real `saveTab` with the commit send failing → `UnknownOutcome`; the user types more; `reconcileUnknownSave` → `Reconciled`, dirty=true, newer text intact, path released. **C1 #2 fixed.**
  - P5: Unknown rename through the dialog → `abandonUnresolvedOperation` → rename again → `Confirmed`, **2 fs:ops dispatched**.
- Not run: real-server journey (phase08), device UI.

## Critical
1. **Default dirty SAVE always fails (new regression).** `FileMutationCoordinator.executeReservedMutation` calls `tabsState.freezeDocuments(...)` (L741) *before* `settleDirtyDocuments`. `EditorSession.snapshotSave()` (L100) returns null when `!isInputPermitted`, which includes `isFrozen`. So `EditorTabSaveCoordinator.save` returns `Error("Nothing to save")`, and `saveTab` maps that to `Rejected("ERROR")`. Dialog submit always passes `CloseDecision.SAVE`, so any rename/move/delete over a dirty doc fails with a fake "server rejection" (probe P1). Tests miss this because every coordinator test uses `DISCARD`. Fix: let the save snapshot bypass the freeze. For example, `snapshotSave(allowFrozen = true)` from the child-capability path, or check `isInputAllowed()` only for save and keep `isFrozen` for edits. Add a coordinator test that uses SAVE with a dirty descendant and asserts Confirmed plus a rekeyed clean tab.

## High (warnings)
2. **Abandon still lifts quarantine (C1 #4 open).** `abandonUnresolvedOperation` calls `arbiter.abandonQuarantine`, after which a duplicate dispatch is possible (P5). This violates C5 ("retained quarantine remains … until reconcilable") and step 4 ("without lifting owner quarantine"). Token lookup is still by path (`findActiveReservation`), not by token id. Fix: discard only local dialog/record state and keep the arbiter quarantine; key `QuarantinedOperation` by token id.
3. **Explicit overwrite bypasses C5.** `EditorTabsState.forceOverwriteTab` → `saveCoordinator.forceOverwrite` → `EditorRepository.forceOverwrite` never reserves the path and passes no token. During an in-flight rename/delete it can write to the old path and recreate the file. An Unknown result is not quarantined, so blind retry is possible. `EditorRepository.saveDocument` (EditorSavePort) and the encrypted save path also skip the arbiter and quarantine. Fix: route through `tryReserveSave` with the effective owner, as `saveTab` does.
4. **Parent leak / wrong record key when a child save is Unknown (C1 #3, latent behind #1).** The child stays QUARANTINED. `releaseIfActive(parent)` → `releaseToken` throws ISE (L184), which is swallowed, so the parent stays ACTIVE forever and blocks saves across the whole subtree. `recordUnresolvedMutation(actionId = parentToken.id, …)` uses the token-id namespace, so dialog Abandon/Reconcile (keyed by dialog actionId) can't find it and could hit an unrelated actionId. The Unknown is also reported for an fs:op that was never sent. Fix: pass the dialog actionId; return NotSubmitted("save outcome unresolved"); explicitly release the parent while the child keeps its quarantine (an arbiter API for that), or record the parent. Add a test.
5. **No dirty Save/Discard/Cancel prompt (C1 #5 open).** Dialogs/`FileModalsHost` never ask. Submit uses an implicit SAVE, so consent is never collected, and `capturedDirtyRevisions` (captured at dialog open) only matters for DISCARD, which the UI can't reach. Docs that became dirty after the dialog opened have no captured revision, so the DISCARD guard skips them (`expectedRev == null`).
6. **Rename/move tree/watch rekey incomplete (C1 #6 partial).** `FileTreeState.rekeyPath` still updates only the selection. Expanded/loaded descendant nodes and explorer watch demands under the old subtree are neither rekeyed nor released, so watches leak on dead dirs. Release on delete is now done (`handleConfirmedDeletion`). Document-parent demand is still not wired.
7. **reconcileUnknownSave identity checks missing (C1 #11 open).** `tabIncarnation` and `submittedRevision` are stored but never compared with the current tab/session. The quarantine lookup is `find { it.path == tab.path }` with no `operationKind=="write"` filter. Release uses `findActiveReservation(path)`, which can return an ancestor parent token: `abandonQuarantine` then fails `require(QUARANTINED)`, the error is swallowed, and the quarantine stays forever. If the tab was reopened, the fallback builds a synthetic snapshot and calls `markSaved(oldRev)` on the new document; if revision numbers happen to coincide, the doc is wrongly marked clean. The `loadServerContent` fallback branch (L657) can still erase edits.

## Medium
8. Reconcile is still unreachable in production (C1 #7). `reconcileUnknownSave`/`reconcileUnknownOperation` have no UI or reconnect callers. `reconcileUnknownMutation` fetches parent listings it never uses (wasted requests, YAGNI). `effectiveOwner` is computed but unused in both repository reconcile functions. `MutationReconciliationResult.Reconciled` is never produced.
9. `FileRepository.executeFsOpWithOutcome` swallows `CancellationException` and returns Unknown, so the coordinator's `catch (CancellationException)` branch (L776) is dead for the repository path and structured cancellation is broken (C1 #12). `submitCurrentDialog` still maps any Throwable (including rethrows from settle) to `Unknown(AWAITING_RESULT)` with no record, leaving the dialog stuck with a no-op Abandon.
10. Freeze is weak. `isFrozen` is a plain var (no `@Volatile`). freeze/unfreeze don't call `updateMetadataFlow()`, so the "frozen" reason never shows. The flag is not propagated to `AndroidEditorDocument.isInputAllowed`/`EditorScreens` (L233 uses `session.isInputAllowed` only), so native-widget typing is not frozen.
11. `saveTab` maps `EditorSaveResult.Error` (local "reserved", "Nothing to save") to `Rejected`, which mislabels local failures as server rejections (C1 #14). This is how Critical #1 hides.
12. External delete is not wired. Only a confirmed in-app delete calls `markPathDeleted`. Watch delete events do not mark tabs unavailable (step 4 "confirmed/external delete").
13. Production `WorkbenchScreen.kt:849` builds `FileMutationCoordinator(repo, newState)` with no `editorTabsState`/dirty guard, so the whole editor integration is inert in the shipped app. Phase07 wiring is outside this phase's ownership; flag it to Main.

## Low (suggestions)
- Dead code: the coordinator's Unknown-branch `quarantineToken(...)` never runs because the repository already quarantined the token.
- `rekeyPath`: `_activeTabKey`/`_activeTabId` change before `_tabs` is replaced, so observers briefly see an active key with no tab. `_saveOutcomes` emits once per doc. Assign them after the `_tabs` swap.
- DRY: the Abandon button block is repeated in 4 dialogs and the lambda 5× in `FileModalsHost`. The `capturedDirtyRevisions` build is repeated 3× in the open*Dialog functions.
- Quarantined `submittedBytes` (≤5 MB each) are retained without a bound.
- `settleDirtyDocuments` uses the live `target`, not `capturedTarget`.
- `FileEditorMutationTest.testUnknownSaveReconciliationWithMatchingBytes…` asserts Conflicted, and `/api/fs/read-match` is unused. There is no wildcard-owner regression test, although P3 shows the fix works. The planned deterministic latches at reservation/prompt/send/result are absent.

## Positive
- Owner unified via `resolveEffectiveOwner` across saveTab, writeFileWithOutcome, executeFsOpWithOutcome and the coordinator (verified).
- An Unknown save keeps `submittedSnapshot`, and reconcile uses `completeSave(snapshot)`/markSaved, so newer keystrokes survive (verified on the real path).
- fs:op token lifetime moved to the coordinator: rekey/markDeleted → release → refresh.
- Destination collision covers the whole subtree. The rekey publishes one `_tabs` emission and preserves undo/document identity.
- Arbiter: foreign-token guards, release refuses a parent with a quarantined child, `abandonQuarantine` requires QUARANTINED.

## Recommended actions (priority)
1. Fix the freeze-vs-snapshot conflict (#1); add a SAVE-path coordinator test.
2. Stop lifting the quarantine on Abandon; look up by token id (#2, #7).
3. Reserve in `forceOverwriteTab`/`saveDocument`/encrypted save (#3).
4. Fix the child-Unknown parent leak and record key (#4).
5. Add a real dirty prompt with consent-time revisions (#5); finish the rename watch/tree rekey (#6).
6. Wire reconcile triggers/UI, drop the unused listings and vars, rethrow cancellation (#8, #9).

## Plan status
No checkbox change. Both tasks stay `[ ]`: acceptance is unmet ("Dirty consent…", "No in-flight conflicting save…", "Ambiguous directory mutation remains … quarantined … no duplicate dispatch"). Main is the sole owner of phase-file state.

## Unresolved questions
- Will phase07 wire `editorTabsState` into `FileMutationCoordinator` in `WorkbenchScreen`? Until then all Phase 06 editor integration is inert in production.
- Does the server's fs:write with a stale `expected_mtime` on a missing file reject, or create the file? This decides how serious the remote-recreate risk is for deleted/externally deleted tabs.
- Should "informed local discard" close the affected tabs, or only dismiss the dialog?
