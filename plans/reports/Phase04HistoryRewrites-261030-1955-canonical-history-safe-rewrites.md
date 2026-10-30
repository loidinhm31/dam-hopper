## Phase Implementation Report

### Executed Phase
- Phase: Phase 04 — Canonical history and atomic safe rewrite publication
- Plan: plans/261030-1617-android-focused-git-view
- Status: completed

### Files Modified
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt` (+150, -32)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt` (+23, -11)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt` (+114, -28)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt` (+48, -14)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitErrorDialog.kt` (+2, -1)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt` (+11, -5)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt` (+7, -3)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteModels.kt` (+10, -7)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt` (+86, -30)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt` (+20, -18)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` (+92, -34)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt` (+30, -5)
- `plans/261030-1617-android-focused-git-view/phase-04-history-rewrite-publication.md` (+4, -4)

### Files Created
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryIdentityTest.kt` (318 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryLiveSmoke.kt` (44 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsTest.kt` (230 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsLiveSmoke.kt` (47 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteSafetyTest.kt` (271 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewritePublicationTest.kt` (225 lines)
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteLiveSmoke.kt` (49 lines)

### Tasks Completed
- [x] `fence-history-queries`:
  - Enforced monotonic `requestSequence` and `detailsSequence` identity tokens.
  - Implemented `GitRequestIdentity` capture with canonical viewed branch `fullRef`.
  - Disambiguated local vs remote refs so remote collision does not grant local action eligibility.
  - Tracked raw offset by received count and deduplicated log entries preserving first accepted entry.
  - Added bounded tip re-check before page append; resets dataset and raw offset on observed tip divergence.
  - Added 300ms debounced search resetting dataset, clearing selection, and disabling squash.
  - Built strict DAG ancestor chain traversal in `getSelectedCommitsOldestFirst` requiring in-degree=1, out-degree=1, single root, rejecting merges (>1 parent), forks (>1 child in set), gaps, and unknown parents.
- [x] `implement-history-actions`:
  - Hardened `GitHistoryActionController` across all 8 actions, validating `scope.matches(activeScope)` on async returns and failing closed.
  - Enriched error guidance for conflicts and blocked states with terminal recovery instructions.
  - Wired `GitCommitDetailsDialog` file-level cherry-pick, revert, and drop mutations to propagate actual results via `onMutationSuccess` and `onError`.
  - Updated `GitHistoryView`, `GitPanelScreen`, and `GitModalsHost` to bubble up mutation events.
  - Reconciled Git status, file tree (`fileTreeState?.refresh()`), clean editor buffers (`editorTabsState?.reloadTab` for `!tab.isDirty && tab.target == snapshot.target`), and `blameCache` in `WorkbenchScreen`.
- [x] `implement-safe-rewrites`:
  - Replaced `SquashReceipt` with `RewriteReceipt(branch, sourceOid, oldHeadOid, targetOid, rewrittenCount, scope)`.
  - Replaced `lastSquashReceipt` with `lastRewriteReceipt: StateFlow<RewriteReceipt?>`.
  - Both `editCommitMessage` and `squashCommits` emit `RewriteReceipt` strictly on confirmed server success matching snapshot branch, `oldHeadOid`, non-blank `newHeadOid`, and `newTargetOid`.
  - Cleared receipts and snapshot on publication-uncertain or stale-ref conditions, and on leased push publication success.
  - Removed public unbound `prepare(branch, sourceOid)`; replaced with `prepareWithReceipt(receipt: RewriteReceipt)`.
  - Validated server push preview snapshot against receipt branch, sourceOid, and scope.
  - Migrated consumers across dialogs, screens, and tests.

### Tests Status
- Type check: pass
  - `:shared:compileKotlinJvm` (pass)
  - `:shared:compileDebugKotlinAndroid` (pass)
  - `:androidApp:compileDebugKotlin` (pass)
  - `:androidApp:compileDebugAndroidTestKotlin` (pass)
- Unit tests: pass
  - `GitHistoryQueryIdentityTest` (7 tests, pass)
  - `GitHistoryActionsTest` (7 tests, pass)
  - `GitControllersAndEligibilityTest` (4 tests, pass)
  - `GitRewriteSafetyTest` (6 tests, pass)
  - `GitRewritePublicationTest` (4 tests, pass)
  - Total: 28 tests passing
- Integration / Live Smoke tests: pass
  - `GitHistoryQueryLiveSmoke` (fails fast on unset server url as required)
  - `GitHistoryActionsLiveSmoke` (fails fast on unset server url as required)
  - `GitRewriteLiveSmoke` (fails fast on unset server url as required)

### Issues Encountered
- Kotlin daemon OOM during simultaneous compilation of `:shared:compileKotlinJvm` and `:shared:compileDebugKotlinAndroid`. Resolved by configuring `--no-parallel -Dorg.gradle.parallel=false`.
- Initial mock in `GitRewriteSafetyTest` had duplicate server route registration; unified into single GET/POST handler and ensured request bodies were consumed.

### Next Steps
- Main agent to verify checks and coordinate Phase 06 (`runtime-lifecycle-host-ports`).
