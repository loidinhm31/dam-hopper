# Phase 06 Code Review — Mutation/save identity + unknown reconciliation (C4/C5)

Reviewer: Phase06ReviewerC1-7 · Plan: `plans/261023-1429-native-editor-file-explorer/phase-06-mutation-save-integration.md`

## Score: 5/10
Compiles; tests pass. Core C5 arbitration has an owner-identity split, and the real unknown-save reconciliation path can erase edits. Several acceptance items are only covered by tests that assert nothing useful.

## Validation
- `native-app/gradlew.bat -p native-app :shared:jvmTest --rerun --tests FileEditorMutationTest --tests FileOperationArbiterTest --tests FileMutationCoordinatorTest --tests EditorSaveRaceTest`: BUILD SUCCESSFUL, 32/32 PASSED.
- `native-app/gradlew.bat -p native-app :shared:jvmTest`: exit 0, no failures.
- Not run: androidApp compile, real-server journey (phase08).

## Critical
1. **Owner split breaks save-vs-mutation arbitration.** `EditorTabsState.saveTab` reserves with `fileRepository.owner`, and `FsWriteCoordinator`/`executeFsOpWithOutcome` quarantine with that same raw owner. `FileMutationCoordinator` reserves and checks with `FileWatchCoordinator.resolveEffectiveOwner(...)`. In production, `WorkbenchScreen` uses the secondary `FileRepository` constructor, whose owner has `project="*"`, so the two owners differ. `hasConflictLocked` skips tokens with a different owner. Result: a save and a rename/move/delete on the same path never conflict, and `isPathUnresolved` cannot see quarantined Unknown saves. Tests miss this because they all use a concrete project owner. Fix: derive one effective owner in a single place, use it for every arbiter call (save, child save, quarantine, reconcile), and add a wildcard-owner test.
2. **Unknown-save reconciliation erases newer edits in the real flow.** On `UnknownOutcome`, `EditorTabSaveCoordinator.save` calls `session.abortSave()`, which sets `submittedSnapshot` to null. Later, `EditorTabsState.reconcileUnknownSave` sees no snapshot and calls `session.loadServerContent(submittedBytes)`. That replaces the buffer and resets edit state, so anything typed after submission is lost. This breaks C4 and the phase acceptance item about preserving edits made after submission. `EditorSaveRaceTest` passes only because it calls `snapshotSave()` by hand and never goes through `saveTab`. Fix: on Reconciled, call `document.markSaved(quarantined.submittedRevision, mtime)` using the quarantine record and never call `loadServerContent`. Keep the snapshot on Unknown, and test through `saveTab` → Unknown → edit → reconcile.

## High
3. **Parent token leaks when a child save is Unknown.** In `settleDirtyDocuments`, a child save that ends Unknown stays quarantined. `releaseIfActive(parent)` then hits `releaseToken`, which throws ISE because a child is quarantined, and the exception is swallowed. The parent mutation reservation stays ACTIVE for the life of the process. There is also no `recordUnresolvedMutation`. The mutation is reported as `Unknown` even though the fs:op was never sent, and the dialog's Abandon button does nothing because no record exists for that actionId. Fix: report the mutation as NotSubmitted with a "save outcome unresolved" reason, keep the parent's ownership explicit (record it, or release it while leaving the child quarantined), and add a test.
4. **Abandon Quarantine breaks C5.** C5 says "retained quarantine remains for return to that owner until reconcilable", and phase step 4 says "without lifting owner quarantine". `abandonUnresolvedOperation` instead removes the record and lifts the arbiter quarantine, after which retry or duplicate dispatch is possible. Neither `abandonQuarantine` nor the lookup via `findActiveReservation` checks the QUARANTINED state, so an unrelated ACTIVE token covering the path could be released. Fix: allow informed local discard of buffers/dialog only, keep the quarantine, look the token up by id, and require QUARANTINED state.
5. **No dirty-consent prompt; the revision guard does nothing.** Dialog submit calls rename/move/delete with the default `CloseDecision.SAVE`, so dirty buffers are saved silently with no Save/Discard/Cancel prompt. `capturedRevisions` is taken inside `executeReservedMutation` *after* the decision was made, so the DISCARD guard can never fire. `testDirtyConsentDiscardCancelledIfNewerEditsOccurred` makes no assertion on the outcome and passes even though the rename was Confirmed. Fix: prompt first, capture revisions at the consent boundary, pass them in, and assert NotSubmitted with no dispatch.
6. **Confirmed rename/move rekey is incomplete.** `FileTreeState.rekeyPath` updates only the selection. Expanded or loaded descendant nodes and explorer watch demands for the old subtree are not rekeyed or released, so watches on dead directories leak and expansion is lost. `handleConfirmedDeletion` releases demand only for the exact deleted path, not for expanded descendants. Open-document parent demand is not wired at all (`acquireDocumentParentDemand` has no callers). This misses C5's "loaded tree paths and watch demands rekey together".
7. **Reconciliation is unreachable and partly a stub.** `reconcileUnknownSave` and `reconcileUnknownOperation` have no production callers: no reconnect trigger and no UI. `reconcileUnknownMutation` always returns Unresolved, which is allowed by the contract. But it fetches parent listings it never uses (wasted requests, YAGNI), and it reports stat failures as "not found". `MutationReconciliationResult.Reconciled` is never produced. Late-ACK handling on the original authority is missing.

## Medium
8. **Reservation released before local rekey.** In `executeFsOpWithOutcome`, `abandonQuarantine` is called on Confirmed and Rejected *before* the coordinator rekeys or publishes errors. The coordinator comment "Apply atomic local settlement FIRST before releasing reservation" is therefore false. On `Dispatchers.Default`, a save to the old path could reserve in that window and recreate the old file. Move the release into the coordinator.
9. **Rekey is not atomic.** `EditorTabsState.rekeyPath` emits `_tabs` once per affected key, so observers can see half-rekeyed descendants (and the loop is O(n²)). Build the new list once and assign it once.
10. **Collision check covers only the exact destination.** Tabs under `dest/...` (for example a retained unavailable tab) are not checked, and `sessions[newKey] = session` can silently overwrite an existing session. Check the whole destination subtree.
11. **No incarnation check in `reconcileUnknownSave`.** `tabIncarnation` and `submittedRevision` are recorded in the quarantine but never compared with the tab and session, so a reopened tab at the same path can be settled by an old operation.
12. **Generic exceptions misclassified.** `submitCurrentDialog` turns any Throwable into `Unknown(AWAITING_RESULT)`, including failures rethrown from `settleDirtyDocuments` before dispatch, and records nothing, so the dialog stays stuck. `executeFsOpWithOutcome` swallows `CancellationException`; it should record Unknown and then rethrow.
13. **Freeze flag.** `EditorSession.isFrozen` is a plain `var` (no `@Volatile`) written from a coroutine and read by the UI, and freeze/unfreeze do not call `updateMetadataFlow()`, so the "frozen" reason never shows up in the UI.
14. **Wrong outcome kind for local save errors.** `saveTab` maps `EditorSaveResult.Error` (including the local "reserved" error) to `Rejected`, which the mutation then reports as a server rejection even though nothing was sent.

## Low
- The richer `QuarantinedOperation` (dest/operationKind) built in the coordinator's Unknown branch is dead code: the token is already QUARANTINED by the repository, so the record that stays stored has no destination.
- `FileEditorMutationTest`: `testUnknownSaveReconciliationWithMatchingBytes...` actually asserts Conflicted (size mismatch), and the `/api/fs/read-match` context is never used. The child-save and save-blocked tests call the arbiter directly instead of going through the coordinator. The planned deterministic latches at reservation/prompt/send/result are absent. Missing tests: postcommit timeout, disconnect at each stage, a vs ab through the coordinator, failed op, and callback rekey.
- Quarantined `submittedBytes` (up to 5 MB each) are kept without bound until abandoned.
- `isFileDirty` in `settleDirtyDocuments` uses the live `target` instead of `capturedTarget`.
- The four dialogs repeat the same Abandon button block (DRY).

## Positive
- Segment-aware conflict detection (`a` vs `ab`), atomic source+destination reservation, foreign-arbiter token guard, and a parent release that refuses while a child is quarantined.
- Commit is marked Unknown before send; pre-commit chunk failure is NotSubmitted; `force_git` is blocked and `.git` is guarded client-side.
- Undo and document identity are kept across rekey (tested). Delete marks tabs unavailable and blocks saves while keeping dirty text.
- Dialog completion is fenced by actionId, and cancellation resets isSubmitting.

## Recommended actions (priority)
1. Unify the effective owner for all arbiter calls (#1) and add a wildcard-owner test.
2. Fix reconcile to use `markSaved(submittedRevision)` and never `loadServerContent`; keep the snapshot on Unknown (#2, #11).
3. Fix the parent leak and misclassification on child-save Unknown (#3).
4. Remove the quarantine lift from Abandon and add a state-checked, id-based lookup (#4).
5. Add a real dirty prompt with consent-time revision capture; make the tests assert outcome and dispatch (#5).
6. Complete tree/watch rekey and release; wire reconcile triggers; drop the unused listings (#6, #7).
7. Move reservation release into the coordinator after local publish (#8); make the rekey a single emission (#9).

## Plan status
Not toggling the phase checkboxes: Main is the sole integration owner and other reviewers are working in parallel. Both tasks (`integrate-subtree-mutation-transactions`, `integrate-unknown-outcome-reconciliation`) should stay `[ ]` because acceptance is unmet (#1–#7).

## Unresolved questions
- Will the phase07 workspace keep the wildcard-owner `FileRepository` constructor? If yes, #1 is live in the shipped flow.
- Is a protocol-level late-ACK listener in scope for phase06, or deferred to phase08?
- Should "informed local discard" for an unresolved fs:op close the affected tabs, or only dismiss the dialog?
