# Phase 06 Code Review — Cycle 3 (final) — mutation/save identity + unknown reconciliation (C4/C5)

Reviewer: Phase06ReviewerC3 · Plan: `plans/261023-1429-native-editor-file-explorer/phase-06-mutation-save-integration.md` · Prior: `code-reviewer-261024-1018-phase06-mutation-save-review-c2.md`

## Score: 7/10
C2 Critical fixed and verified on the real path; W2/W3/W7 mostly fixed; W6 fixed for rename only. W4 claimed fixed but probe shows child-save Unknown still permanently locks the subtree and reconcile reports success while quarantine stays. Dirty prompt (C2 #5) and production wiring still open.

## Validation
- `native-app\gradlew.bat -p native-app :shared:jvmTest --rerun --tests FileEditorMutationTest --tests FileOperationArbiterTest --tests FileMutationCoordinatorTest --tests EditorSaveRaceTest` (+ scratch probe): BUILD SUCCESSFUL.
- `native-app\gradlew.bat -p native-app :shared:jvmTest --rerun :androidApp:compileDebugKotlin -q`: exit 0 (scratch deleted first).
- Scratch probe `ZzReviewerScratchC3Test.kt` run then **deleted**. Observed:
  - P3: dirty `d/x.kt`, rename dir `d→e` default SAVE → `Confirmed`, 1 op, session path `e/x.kt`, clean. CANCEL → NotSubmitted, unfrozen, unreserved. **C2 Critical fixed.**
  - P2: Unknown rename → `dismissDialog` → rename again → `NotSubmitted`, ops=1. **Dismiss retains quarantine (W2 fixed in UI).** But `abandonUnresolvedOperation(actionId)` → rename → `Confirmed`, **ops=2** (public API still lifts quarantine).
  - P1: dirty `src/Main.kt`, commit send throws, rename `src→sources` via dialog → `Unknown`, 0 fs:op. unresolved=`[1:save:src/Main.kt]` (actionId = parent token id; equals dialog id 1 only by counter coincidence). `src`, `sources`, `src/Other.kt` reserved. Then `reconcileUnknownSave` → `Reconciled(300)`, tab marked clean, **but `write:src/Main.kt` still quarantined and `src`/`sources` still reserved**; rename retry → NotSubmitted forever.
- Not run: real-server journey (phase08), device UI.

## Critical
None.

## High (warnings)
1. **Child-save Unknown → orphaned parent + unreleasable quarantine (W4 not fixed, C2 #4/#7 residual).** `FileMutationCoordinator.settleDirtyDocuments` L926-937 records with `actionId = parentToken.id` (token namespace, not dialog actionId). `executeReservedMutation` L749-751 → `releaseIfActive(token)` → `releaseToken` throws (quarantined child, Arbiter L184) → swallowed → parent stays ACTIVE, untracked. `EditorTabsState.reconcileUnknownSave` L690 `findActiveReservation(path)` returns the ancestor parent (insertion order) → `abandonQuarantine` `require(QUARANTINED)` fails → swallowed. Result (P1): tab shows clean/reconciled, arbiter still blocks subtree + exact save of that file until app restart; UI state and arbiter diverge. Fix: store `tokenId` in `QuarantinedOperation` (or arbiter `findQuarantinedToken(owner,path,kind)`); on child Unknown either quarantine parent with same op record or add arbiter `detachChild/releaseParentRetainingChildren`; pass dialog `actionId` into settle; reconcile abandons by token id; add test.
2. **No dirty Save/Discard/Cancel prompt (C2 #5 open).** Dialogs still submit implicit SAVE; DISCARD/CANCEL unreachable from UI; `capturedDirtyRevisions` captured at dialog open, docs dirtied later have none so DISCARD guard skips them. Step 2 / acceptance "Dirty consent…" unmet. (SAVE path now works, so impact = no consent, not data loss.)
3. **Move rekey not coherent for tree/watch (W6 partial).** `FileTreeState.rekeyPath` L287-316 rekeys node in place under *source* parent. For move, `onConfirmedRefresh` reloads source parent (drops rekeyed node + expanded subtree) and dest dir (fresh collapsed node via `updateChildren` L98-100), while L294 re-acquired explorer demand for every descendant `newSub` → orphan watches on collapsed dirs, expansion lost. Also re-acquires explorer demand for subs whose old demand was only document-parent. [INFERENCE: code read; not probed]. Rename path coherent.

## Medium
4. `abandonUnresolvedOperation` (L956-972) still calls `arbiter.abandonQuarantine` (P2: duplicate dispatch). No prod callers now → dead code violating C5/step 4. Delete it, or make it local-only (drop record/dialog, keep quarantine).
5. `reconcileUnknownSave` L661-673: `find { it.path == tab.path }` then rejects on kind; a mutation quarantine at same path shadows a write quarantine. Filter `operationKind == "write"` inside `find`. Fallback branch L687-688 (`loadServerContent`) can still drop newer edits when no revision known.
6. `FileRepository.reconcileUnknownSave`/`reconcileUnknownMutation` catch `Throwable` (incl. `CancellationException`) → structured cancellation broken; `executeFsOpWithOutcome` L347 same (C2 #9). Unused `effectiveOwner` in both reconcile fns; `reconcileUnknownMutation` fetches parent listings never used (YAGNI, wasted HTTP). `MutationReconciliationResult.Reconciled` never produced.
7. Reconcile still unreachable in prod (no UI/reconnect caller); `WorkbenchScreen.kt:849` builds `FileMutationCoordinator(repo, newState)` without `editorTabsState` → Phase 06 editor integration inert in shipped app (phase07 ownership; flag to Main).
8. `saveTab`/`saveDocumentWithToken`/`forceOverwriteTab` map local `EditorSaveResult.Error` (e.g. "reserved") to `Rejected("ERROR")` — local failure labelled server rejection (C2 #11). Mapping triplicated (DRY).
9. `isFrozen` plain var, no metadata emission on freeze/unfreeze; not propagated to native widget input (C2 #10).

## Low (suggestions)
- `EditorTabsState.rekeyPath` L577-580: active key/id set before `_tabs` swap; `_saveOutcomes` emits per doc. Assign after swap.
- Coordinator Unknown-branch `quarantineToken` (L858-872) dead: repository quarantines pre-send.
- DRY: `capturedDirtyRevisions` builder ×3 in open*Dialog; `effectiveOwner` resolution repeated across 6 sites (`FileWatchCoordinator.resolveEffectiveOwner` FQN inline) — import it.
- Quarantined `submittedBytes` (≤5 MB each) retained unbounded.
- `settleDirtyDocuments` uses live `target` not `capturedTarget`.
- `testUnknownSaveReconciliationWithMatchingBytes…` asserts Conflicted (name misleading). Planned deterministic latches at reservation/prompt/send/result still absent.

## Positive
- Freeze vs save snapshot cleanly separated: `snapshotSave` uses `isInputAllowed()`; edits/undo/redo gate on `isInputPermitted`. New SAVE-path test covers regression.
- Save reservations now uniform: `saveTab`, `forceOverwriteTab`, port `saveDocument` all reserve under effective owner, release in `finally` only when ACTIVE (quarantine preserved on Unknown).
- Arbiter foreign-instance guards on every token entry point; parent release refuses quarantined child.
- Quarantine records richer (kind, dest, incarnation, baselineMtime); incarnation + kind validation in reconcile; wildcard-owner regression test added.
- Dismiss no longer lifts quarantine; reopen/retry blocked (verified P2).
- Rename tree rekey preserves expansion via path-keyed merge; watch demands migrated.

## Recommended actions (priority)
1. Fix #1 (token-id keyed quarantine lookup; parent handling on child Unknown; dialog actionId) + test reconcile-after-child-Unknown frees subtree.
2. Delete/neutralize `abandonUnresolvedOperation` (#4).
3. Real dirty prompt with consent-time revisions (#2).
4. Move rekey: relocate rekeyed node under dest parent (or release descendant demands and let refresh re-acquire) (#3).
5. Rethrow cancellation; drop unused listings/vars (#6); filter write kind in reconcile lookup (#5).

## Plan status
No checkbox change. Both tasks stay `[ ]`: acceptance "Dirty consent…", "Ambiguous … quarantined … no duplicate dispatch" (API path), "confirmed directory moves update every descendant coherently" (tree/watch on move) not fully met; phase08 real-server evidence pending. Main is sole owner of phase-file state.

## Unresolved questions
- Will phase07 wire `editorTabsState` into `FileMutationCoordinator` in `WorkbenchScreen`? Until then Phase 06 is inert in prod.
- Intended UX for permanently ambiguous quarantine (no reconcile UI): is app-restart the only exit acceptable for this phase?
- Server behaviour for fs:write with stale `expected_mtime` on missing file (recreate vs reject) — still unconfirmed.
