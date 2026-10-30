# Phase 04 — Canonical history and atomic safe rewrite publication

## Context / overview
Priority P2. Status in-progress (implementation landed; open for W4 uncertainty/reconciliation, W5 clean reload). Effort unestimated. Owner: one **G1 serialized mainline** owner at each stable task boundary.
Predecessors: implement-sync-worktrees. Successors: 06 after graph05 is evidence-complete.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- Current selection uses display adjacency; log is not guaranteed topological or snapshot-paged.
- F1 requires receipt rename and public prepare removal to include history view/panel and mixed test166 in the same task. Keep old constructor/receipt live baseline until this task, not a compatibility shim.

## Functional / nonfunctional requirements
- Full request identity, canonical viewed versus checked-out ref and OID chain selection.
- Complete message snapshots/CAS/consent/occupancy; both edit/squash actual receipt and separate exact lease; generic actions truthful. No host constructor or future runtime use before06. AC03/04/05/07/08.

## Architecture / data flow
Existing controller constructors remain usable. Task1 owns query/view changes without graph dependency; task2 actual result propagation across leaf/modal/Workbench; task3 producer/receipt/consumer rename + leased-publication migration is atomic. Exact-owner scope already exists03. Graph05 input remains existing GitLogEntry, integrated06 only.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryIdentityTest.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryLiveSmoke.kt` | Explicit mandatory current-server history-query smoke, not default JVM discovery |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitActionConfirmDialogs.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitErrorDialog.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsTest.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsLiveSmoke.kt` | Explicit mandatory current-server action smoke, not default JVM discovery |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteModels.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitMessageEditDialog.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSquashDialog.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPushDialog.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Modify | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteSafetyTest.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewritePublicationTest.kt` | Compile-closed history/actions or receipt/publication consumer migration |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteLiveSmoke.kt` | Explicit mandatory current-server rewrite/publication smoke, not default JVM discovery |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPublicationModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitQueryRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryMutationRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPublishRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphModels.kt`
- `docs/api/git.md`

## Ordered steps / task IDs
### fence-history-queries
1. Capture full additive GitRequestIdentity from enriched03 scope.owner/generation/root and canonical viewed ref/normalized search/raw offset/sequence. Separate details/file/load/layout sequence identities; old callbacks/loading/errors cannot affect new view. Ref selection never checkout, local/remote names disambiguated by fullRef, detached/unborn inspectable.
2. Debounce literal search (no new scheduler), flat list, no squash. On root/ref/search change clear unsafe selection/details/eligibility. Before page append re-read bounded tip; changed observed tip resets dataset. Advance raw offset by raw returned count and dedup by OID, preserve valid anchors; no atomic snapshot claim/polling.
3. Build actual selected OID parent map and unique oldest-first single-parent chain, not adjacency/timestamp. Reject gaps/merge/unknown selected ancestry; oldest root valid, server checks descendants/reachability. Keep old receipt UI signatures until task3; graph renderer not referenced before05.

### implement-history-actions
1. Preserve current callable constructors/methods, harden captured scope/result publication. Applicable cherry-pick/revert/reset/drop/undo/file variants keep server pushed/active-branch/topology restrictions; generic mutations are not CAS-protected rewrites.
2. Details-action success must propagate actual result to current GitPanelScreen/GitModalsHost/Workbench callbacks and reconcile Git + clean buffers/tree, no message-only invalidation. Include all callback callers if signature changes; final retained guard/host signature replacement is06 only.
3. Failed/blocked/conflict/unknown event stays truthful with fresh error identity and terminal/web recovery recommendation, not success callback/no-op/fake guard. Complete compile/tests/real smoke/review before receipt migration.

### implement-safe-rewrites
1. Fetch complete message bodies using canonical refs/heads branch. For squash all selected snapshot branch/tips agree; preserve full bodies/newlines. Freeze exact original hash(es), branch/tip/message and explicit signature-removal consent; fresh/ref/owner change invalidates submission.
2. Atomically replace SquashReceipt with RewriteReceipt and lastSquashReceipt with lastRewriteReceipt in GitRewriteModels/Controller, GitHistoryView callbacks/banner, GitPanelScreen state/prepare path, LeasedPublishController and dialogs. Remove public unbound prepare(branch,sourceOid), migrate mixed eligibility test166 to real receipt-bound preparation. All references discovered by source-map are in this task; do not postpone UI/test type changes06.
3. Require ok && !noOp && not publication-uncertain, agreeing oldHeadOid/canonical branch and actual full newHeadOid/newTargetOid before either rewrite emits receipt. sourceOid is returned new branch tip, targetOid rewritten target, count server rewrittenCount, never synthesized from selection/request.
4. Leased prepare checks actual returned branch/sourceOid against receipt plus scope/root, retains exact remoteIdentity/repositoryIdentity/expectedRemoteOid, requires separate user confirmation. Stale-local/remote/config/rejected/auth/unknown distinct; unknown reconciles original owner without automatic reprepare/republish/force. Full guard host constructors remain LIVE baseline until06, so no future port implementation required to compile this task.
5. Run scoped compile/behavior tests and current-server active/inactive rewrite+bare-remote smoke, obtain passing review before completing04. Existing source-wording test assertions removed only when obsolete, not re-pinned.

## Compile-dependency closure (planned, not observed)
Task1 changes no external constructor/callback type and references only03 scope +01 values. Task2 owns actual details/action callback callers in shared panel/modal/Workbench. Task3 owns every source-mapped SquashReceipt/lastSquashReceipt/prepare caller including GitControllersAndEligibilityTest.prepare, so old types disappear only after all consumers migrate together. New focused tests instantiate still-live two-argument constructors;06 later owns their host-argument migration. No runtime06 or layout05 function called in04.

External smoke isolation: each task creates ONLY its assigned standalone GitHistoryQueryLiveSmoke, GitHistoryActionsLiveSmoke or GitRewriteLiveSmoke for mandatory real-server methods. Run it through :shared:jvmGitSmoke --tests exact class before completing that task; default query/actions/rewrite/publication classes contain only deterministic methods and local boundary fixtures. No external env in default suite, no skip/assume fallback.01 already configures discovery;06 explicitly migrates all six live-smoke constructor callers atomically.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "fence-history-queries",
    "title": "Fence canonical history requests and validate actual OID selection",
    "blocked_by": [
      "implement-sync-worktrees"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryIdentityTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryQueryLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Exact owner/generation/root/ref/search/offset/sequence fences history/details/errors/loading; canonical remote/local collisions cannot grant local actions.",
      "Filtered debounced literal search is a flat list and disables squash; actual oldest-first single-parent chain, raw-offset dedup/tip-change reset; no graph implementation dependency."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitHistoryQueryIdentityTest\" --tests \"dev.damhopper.nativeapp.features.git.GitControllersAndEligibilityTest\"; require all scoped behavior assertions pass.",
      "Smoke: GitHistoryQueryIdentityTest.nonTopologicalChainConsumerSmoke executes actual controller against HttpServer boundary responses with earlier parents/overlap/ref race; S-HISTORY current-server log/parent comparison confirms canonical ref/search/offset behavior.",
      "Run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitHistoryQueryLiveSmoke\" (new same-task class) with mandatory isolated current-server env; compare canonical log/search/raw offsets/parent OIDs to external Git. Keep local nonTopologicalChainConsumerSmoke in deterministic GitHistoryQueryIdentityTest; no default external method.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "implement-history-actions",
    "title": "Close actual history and details-action reconciliation callers",
    "blocked_by": [
      "fence-history-queries"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitDetailsDialog.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitActionConfirmDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitErrorDialog.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryActionsLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Existing public constructor/API preserved; actual action/file response triggers success-only refresh only on confirmed success; conflict/block/unknown not suppressed or replayed.",
      "Details file mutation callback now reconciles history/changes and existing clean editor/tree caller path; final retained whole-workspace host guard integration remains06."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitHistoryActionsTest\"; require all scoped behavior assertions pass.",
      "Real S-HISTORY smoke invokes actual action controller/details consumer on disposable current server and compares external Git index/files/history; rejected/uncertain actions do not emit successful consumer refresh.",
      "Run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitHistoryActionsLiveSmoke\" (new same-task class) with mandatory isolated current-server env for S-HISTORY action/index/file comparisons; default GitHistoryActionsTest remains deterministic. No skip/assume or07 dependency.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "implement-safe-rewrites",
    "title": "Atomically replace receipt and all rewrite/publication callers",
    "blocked_by": [
      "implement-history-actions"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteActionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitMessageEditDialog.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitSquashDialog.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPublishController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/LeasedPushDialog.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewritePublicationTest.kt"
      ,"native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteLiveSmoke.kt"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Full fresh message snapshots agree branch/tip, exact oldest-first chain and active/inactive/CAS/occupancy/signature restrictions preserved.",
      "Both edit/squash produce actual nonnoop receipt; SquashReceipt/lastSquashReceipt/unbound prepare removed only with producer/history/panel/leased/tests migrated in this task.",
      "Separate publication verifies receipt branch/newtip/scope and frozen exact server snapshot; unknown/stale no automatic resend or force."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitControllersAndEligibilityTest\" --tests \"dev.damhopper.nativeapp.features.git.GitRewriteSafetyTest\" --tests \"dev.damhopper.nativeapp.features.git.GitRewritePublicationTest\"; require all scoped behavior assertions pass.",
      "Real S-REWRITE smoke uses disposable active/inactive branches and bare remote: actual edit + squash, external tree/index/byte preservation, separate prepare/confirm and remote advance -> stale-remote. No-op/uncertain creates no receipt; no07 runner prerequisite.",
      "Run :shared:jvmGitSmoke --tests \"dev.damhopper.nativeapp.features.git.GitRewriteLiveSmoke\" (new same-task class) for mandatory actual edit/squash and separate leased publication against isolated current server/bare remote. Default rewrite/publication test classes stay deterministic; missing fixture fails explicit smoke, no07 dependency.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [x] <!-- evcrate-task:fence-history-queries --> Fence canonical history requests and validate actual OID selection
- [ ] <!-- evcrate-task:implement-history-actions --> Close actual history and details-action reconciliation callers (open for W5 whole-target clean tab reload)
- [ ] <!-- evcrate-task:implement-safe-rewrites --> Atomically replace receipt and all rewrite/publication callers (open for W4 dropped ack uncertainty handling)

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
Listed scoped compile/tests/current-server smoke/review for EACH stable task; current-server smoke setup is existing helper plus disposable Git commands, no later journey required.07 remains integrated real-root/hardware proof. No compile/test waiver, no completion based only on producer edits.

## Risks / security / failure / rollback
Serialize shared panel/modal/Workbench/tests with03 and06. External writes may invalidate snapshots; server CAS remains final authority. Signature consent explicit, no old receipt/preview can authorize a new root/ref/account. Rollback previous client, never automatically undo published history.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
