# Phase 03 — Atomic current-wire and daily Git cutovers

## Context / overview
Priority P2. Status in-progress (implementation landed; open for W4 uncertainty/reconciliation, W6 diff navigation). Effort unestimated. Owner: one **G1 serialized mainline** owner at each stable task boundary.
Predecessors: guard-workspace-targets. Successors: 04; graph05 independent.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- F1 source closure: GitChangesController62–67 consumes old summary fields; Workbench749–755 and mixed Git tests construct old scope. Both definitions and every consumer belong to the atomic cutover.
- Diff constructor/load/save calls exist only in DiffReviewScreen and multiple Workbench paths; defer neither when replacing diff API.

## Functional / nonfunctional requirements
- Correct current wire, full logical-owner scope, truthful changes/discard and read-only review; no temporary broken native source set.
- Sync/branch/worktree hardening preserves callable baseline constructors until real host06 exists. Final guard/exposure criteria remain06/07, not claimed from dormant controls. AC02/06/08/09/10.

## Architecture / data flow
Task1 changes models/query/facade + actual consumers/tests at once. Task2 changes diff definition/screen + every Workbench constructor/load/save/commit-details consumer at once. Task3 hardens still-live baseline controller callback API.03 never instantiates GitWorkspaceRuntime or references06-only constructor/revoke methods.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModels.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitQueryRepository.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRepository.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesController.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitModelsSerializationTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRepositoryTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryAndBranchRepositoryTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitChangesBehaviorTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt` | Extend prior02 account/generation regression to enriched scope |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireCutoverTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireLiveSmoke.kt` | Explicit mandatory current-server S-WIRE, excluded from default JVM discovery |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewController.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitReadOnlyDiffTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitDiffLiveSmoke.kt` | Explicit mandatory current-server S-DIFF, excluded from default JVM discovery |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSyncController.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchController.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchesWorktreesView.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeDialogs.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt` | Atomic current-wire/scope/diff caller closure or baseline API behavioral hardening |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncLiveSmoke.kt` | Explicit mandatory current-server S-SYNC, excluded from default JVM discovery |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPublicationModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitMutationRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchWorktreeRepository.kt`
- `server/src/git/types.rs`
- `server/src/api/git_diff.rs`
- `docs/api/git.md`

## Ordered steps / task IDs
### align-current-git-wire
1. Atomically replace root/status and diff DTOs and return types with exact constructors in contracts; decode current conflict/operation GETs, non-Git409 and unavailable/error distinct. Remove GitRootStatus/GitDiffSummary only with all query/facade/changes/model/repository fixtures updated; shared mixed test source belongs here now, not01.
2. In the same task change GitOperationScope to (owner,generation,root) and factory(owner,connection,root), preserving computed existing profileId/project/worktreePath/targetRef/matches APIs. Migrate Workbench scope construction from its real AuthStatus.Authenticated account, endpoint/current transport/target; absent account means no scope, not fallback. Migrate existing mixed test constructors, new02 WorkspaceGitSafety/test inputs and its prior02 root owner-binding regression; update safety full-owner equality. GitContractTest01 contains no active scope constructor to migrate.
3. Changes partitions actual entries by staged/status; same path may appear both staged and unstaged, untracked raw offsets/count/truncation/load-more preserved. Confirm discard and invalidate only after actual ok=true; false/failure/uncertain callbacks are not success. Update leaf callback wiring in existing Workbench where present without changing controller constructors. Final workspace dirty guard integration is06, not a no-op03 host.
4. Tests cover actual source-shaped JSON, metadata/error envelopes, account/root/generation scope mismatch, full messages and path encoding. Stop editor, compile/test/real S-WIRE/review before next task.
4a. Put ONLY external mandatory S-WIRE methods in same-task GitWireLiveSmoke; keep GitWireCutoverTest and other default classes deterministic/fixture-independent. Run :shared:jvmGitSmoke --tests "dev.damhopper.nativeapp.features.git.GitWireLiveSmoke" with mandatory isolated server env BEFORE task completion; no skip/assume on missing fixture.01 already supplies explicit task/discovery isolation.

### implement-readonly-git-diff
1. Atomically replace DiffReviewController constructor/load/revoke/read state with frozen read-only API and remove draft/save/hunk-discard/stat fields/methods. Update DiffReviewScreen toolbar/editor replacement and its callback signature in this task, not06.
2. Migrate ALL Workbench references: constructor328, file-open load824, editor-diff1237, DiffReviewScreen1255 + save1258, commit-details load1365 and editor-return1385 (source lines are inspection anchors, refresh before coding). Remove stale comment/callbacks rather than shim. For Open in Editor use existing retained editor object available in this baseline caller; current exact target+root mapper, never historical text injection.
3. Capture full scope/path/commit/request/layout revision before network/Default computation and check before every state/error/loading/layout publication. Keep binary/deleted/empty/unavailable states explicit, no root-relative filesystem stat. Tests/smoke directly invoke actual read-only controller; all modified Workbench paths compile immediately.
3a. Same-task GitDiffLiveSmoke owns external S-DIFF methods and runs via :shared:jvmGitSmoke --tests "dev.damhopper.nativeapp.features.git.GitDiffLiveSmoke" before completion. GitReadOnlyDiffTest remains deterministic with local boundary fixtures; no external env required by default jvmTest.

### implement-sync-worktrees
1. Keep existing two-argument controller constructors and synchronous removal callbacks LIVE baseline until06 actually replaces every caller with real ports. Harden actual per-target result success/error and refresh callbacks, fresh equal error identities, canonical viewed-vs-checked-out labels and confirmations. No additive fake host/default guard.
2. Disable/refuse secondary-root fetch/pull (no root field exists), primary one exact target, root-qualified ordinary push; no force fallback. Use current read-only conflict/operation query methods and display block/handoff recommendations in existing panel; no resolver/POST operation mounting.
3. Delete stale discovery `?: worktree` fallback; refuse changed/missing/main/locked/bare/unavailable mappings, preserve projected path removal. Existing baseline synchronous dirty/terminal guards remain until the actual async all-owner host cutover06; do not claim they qualify final deletion safety yet. Update current host/modal/Workbench callers whenever a callback is changed, all in this task.
4. Existing API create/prune act on configured repository, no invented nested-root selector. Real current-server sync/worktree smoke + scoped tests and compile/review close this boundary before04.
4a. Same-task GitSyncLiveSmoke owns external S-SYNC methods and runs via :shared:jvmGitSmoke --tests "dev.damhopper.nativeapp.features.git.GitSyncLiveSmoke" before completion. GitSyncWorktreeSafetyTest stays deterministic; no external method in default test classes.

## Compile-dependency closure (planned, not observed)
Source-mapped breaking groups: status/diff models -> query/facade/GitChangesController + serialization/repository tests; scope -> Workbench + mixed Git tests + WorkspaceGitSafety/new02 test; diff -> DiffReviewController, DiffReviewScreen and every Workbench load/save constructor path. All are in the task that removes the old API. Remaining controllers read stable computed scope properties, so need no future constructor. No RewriteReceipt rename until04; no host/runtime API cutover until06. Expected compile closure is reasoned from targeted searches, not a build claim.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "align-current-git-wire",
    "title": "Atomically cut over current wire, exact-owner scope and every consumer",
    "blocked_by": [
      "guard-workspace-targets"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitQueryRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitChangesView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitModelsSerializationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryAndBranchRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitChangesBehaviorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireCutoverTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitWireLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "GitRootStatus/GitDiffSummary removed only with all query/facade/changes/test consumers migrated in this same task; current envelope/count/truncation/metadata/error behavior correct.",
      "Full-owner GitOperationScope replaces old constructor/from only with Workbench and existing/new02 test callers migrated; WorkspaceGitSafety compares enriched owner; no fake account, alias or ambient fallback.",
      "Daily stage/unstage/commit/amend/discard reflects actual completion; existing controller/public host constructor signatures stay LIVE until06."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "Compile and execute the changed prior02 Android unit caller now: run :androidApp:testDebugUnitTest --tests \"dev.damhopper.nativeapp.platform.workspace.GitWorkspaceRuntimeBindingTest\"; do not defer its enriched-scope constructor/assertion closure to06.",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitModelsSerializationTest\" --tests \"dev.damhopper.nativeapp.features.git.GitRepositoryTest\" --tests \"dev.damhopper.nativeapp.features.git.GitControllersAndEligibilityTest\" --tests \"dev.damhopper.nativeapp.features.git.GitHistoryAndBranchRepositoryTest\" --tests \"dev.damhopper.nativeapp.features.git.GitChangesBehaviorTest\" --tests \"dev.damhopper.nativeapp.features.git.GitWireCutoverTest\" --tests \"dev.damhopper.nativeapp.features.workspace.GitWorkspaceSafetyTest\"; require all scoped behavior assertions pass.",
      "Real S-WIRE: run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitWireLiveSmoke\" with mandatory isolated DAMHOPPER_GIT_SMOKE_SERVER_URL/AUTH_TOKEN/PROJECT env; actual stage/unstage/commit/discard and external Git index/tree/bytes comparison. Missing fixture fails this explicit smoke, never default jvmTest; no07 prerequisite.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "implement-readonly-git-diff",
    "title": "Atomically replace diff API and every live dormant caller",
    "blocked_by": [
      "align-current-git-wire"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/DiffReviewScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitReadOnlyDiffTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitDiffLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "DiffReviewController/Screen replacement and every Workbench constructor/load/save/detail action caller migrate together; no old draft/save/discard-hunk API retained.",
      "All live/historical review read-only; network/background layout fully fenced; binary/deleted/empty/unavailable explicit; editor authority remains sole writable buffer."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitReadOnlyDiffTest\"; require all scoped behavior assertions pass.",
      "Real S-DIFF: run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitDiffLiveSmoke\" with mandatory isolated current-server env; actual read-only controller current/historical content versus external Git, layout race, zero writes. Default GitReadOnlyDiffTest remains fixture-independent; no07 dependency.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "implement-sync-worktrees",
    "title": "Harden existing sync, branches and worktree API without future host",
    "blocked_by": [
      "implement-readonly-git-diff"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSyncController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeMutationController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitBranchesWorktreesView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorktreeDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncWorktreeSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitSyncLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Secondary-root fetch/pull controller refuses before request and UI explains; primary exact targets/results and root push supported, repeated same errors observable.",
      "Fresh worktree discovery never falls back to missing stale row, projected removal path used, current public callbacks preserved and actual domain outcomes reconciled.",
      "No future GitHostPorts constructor/preflight signature used yet; final async all-owner authority/active-root guarding is wired atomically06, not faked here."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitSyncWorktreeSafetyTest\" --tests \"dev.damhopper.nativeapp.features.git.GitControllersAndEligibilityTest\"; require all scoped behavior assertions pass.",
      "Real S-SYNC: run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitSyncLiveSmoke\" with mandatory isolated current-server/worktree/bare-remote fixture; external refs/discovery, per-target outcome and zero secondary fetch/pull. Default test classes require no external env; no07 dependency.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [x] <!-- evcrate-task:align-current-git-wire --> Atomically cut over current wire, exact-owner scope and every consumer
- [ ] <!-- evcrate-task:implement-readonly-git-diff --> Atomically replace diff API and every live dormant caller (open for W6 mounted diff callback wiring)
- [x] <!-- evcrate-task:implement-sync-worktrees --> Harden existing sync, branches and worktree API without future host

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
Each task runs listed compile/tests/current-server smoke/review before dependent task; disposable smoke uses only current source and existing seed helper, not07 scripts/classes. Q1 after06 remains additional full integration. Tests using HTTP boundary doubles distinguish errors/races but do not replace the required current-server smoke.

## Risks / security / failure / rollback
Serialize Workbench/shared tests/scope/wire definitions across03 tasks and later04/06. No new product surface is exposed before complete safety06. Generic mutation is not server CAS. Unknown accepted mutation reconciles/no resend. Preserve current TLS/auth credential rules; no remote Git reset as rollback.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
