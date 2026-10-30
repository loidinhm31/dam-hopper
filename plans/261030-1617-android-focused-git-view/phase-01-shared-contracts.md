# Phase 01 — Additive compile-closed shared contracts

## Context / overview
Priority P2. Status completed. Effort unestimated. Owner: one **G0 prerequisite** owner at each stable task boundary.
Predecessors: none. Successors: 02 mainline and05 graph.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- Accepted F1: deleting live DTO/scope/receipt APIs before their callers migrate creates a completion/evidence cycle. Additive01 avoids that cycle.
- Existing enum can move atomically; graph input GitLogEntry already exists.

## Functional / nonfunctional requirements
- Freeze eventual signatures in contracts.md, but implement only additive types/interfaces/helpers here. No future runtime or constructor dependency.
- All current native sources/tests continue compiling at01 completion; actual caller cutovers happen03/04/06. AC03/08 contracts.

## Architecture / data flow
New GitRequestIdentity has explicit owner/generation/root/ref/search/offset/sequence independent of the baseline GitOperationScope constructor. GitHostPorts may reference existing scope type without constructing it. Graph models are immutable data only. Move existing GitPanelSection from screen into contracts in this task; no duplicate same-package enum.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceContracts.kt` | Additive shared contract or enum move and real helper tests |
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphModels.kt` | Additive shared contract or enum move and real helper tests |
| Modify | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt` | Additive shared contract or enum move and real helper tests |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitContractTest.kt` | Additive shared contract or enum move and real helper tests |
| Modify | `native/android-app/shared/build.gradle.kts` | Keep default JVM tests deterministic; add explicit external Git smoke task |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitRewriteModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt`

## Ordered steps / task IDs
### freeze-git-client-contracts
1. Add complete GitRequestIdentity, GitRoute, refresh/outcome/impact values, GitHostPorts interface and path/ref normalization helpers from contracts. Keep GitOperationScope, GitRootStatus/GitDiffSummary and SquashReceipt LIVE baseline APIs unchanged; none is deprecated/re-exported as a shim.
2. Move GitPanelSection enum atomically from GitPanelScreen to new shared contracts; do not change GitPanelScreen constructor/wiring. Add only GraphPoint/Segment/Row/Layout data models; layoutGitGraph and Canvas are documented05 signatures, not bodyless executable placeholders.
3. Author GitContractTest without constructing a future scope or fake host. Test exact-owner request identities, canonical refs and nested-root path rejects/translation through real helpers; retain runnable consumer smoke.
3a. Configure ONLY the existing default `jvmTest` provider with `exclude("**/*LiveSmoke.class")`; do not apply that exclusion through tasks.withType<Test>(). Register test-only `jvmGitSmoke: Test`, dependsOn("jvmTestClasses"), taking testClassesDirs/classpath from the existing jvmTest provider and `include("**/*LiveSmoke.class")`. Copy classpath/directories only, never the default task's exclusion/filter. Default existing deterministic tests unchanged, no dependency/product flag/API/scheduler.
3b. Verify real test discovery using a one-shot temporary `DiscoveryProbeLiveSmoke` class inside already-owned GitContractTest.kt with an observable body: default jvmTest must not execute it, explicit jvmGitSmoke --tests exact probe must execute it. Run existing deterministic tests with live env absent. Remove temporary class after evidence; no extra permanent file or wiring/source-text assertion. This same-task build-configuration smoke needs no later03 class/server/07 fixture.
4. Stop editor; run task-local compile/tests/smoke/review. Only evidence-complete01 unlocks02 and05.

## Compile-dependency closure (planned, not observed)
01 additive types/enum use existing model/Compose/coroutine types; shared Gradle configuration reuses existing JVM Test outputs/classpath and dependencies, without requiring any future live-smoke class. No active wire return type/constructor/receipt/controller API removed. GitContractTest remains deterministic; same-file temporary discovery probe verifies default/explicit task separation then is removed. No03/04/06 artifact required to compile/test/smoke01.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "freeze-git-client-contracts",
    "title": "Add compile-closed identity, safety-port and graph value contracts",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceContracts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitPanelScreen.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitContractTest.kt"
      ,"native/android-app/shared/build.gradle.kts"
    ],
    "constraints": [
      "Only listed literal files writable. Change every affected caller atomically; no compatibility shim, fake host, no-op implementation or verification waiver.",
      "Stop editing before verification. Compile, scoped behavioral tests, real smoke and passing review must be evidenced at this task boundary before completion/dependents; Q1 after06 is additional, not a deferred prerequisite gate."
    ],
    "acceptance": [
      "Only additive complete value/helper/interface definitions plus atomic existing GitPanelSection enum move; baseline active scope/DTO/receipt/constructors remain unchanged.",
      "Graph models and root-relative path/request identity helpers are real testable code; no declarations of unimplemented executable layout/runtime/host methods."
      ,"Default jvmTest excludes only standalone external *LiveSmoke classes; explicit jvmGitSmoke includes them with original JVM test classpath/directories, without copied exclusion. No permanent default test requires external server environment."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitContractTest\"; require all scoped behavior assertions pass.",
      "Smoke: run :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitContractTest.pathAndIdentityConsumerSmoke\" against actual helper/model consumers; record normalized nested-root and collision/owner rejection outputs.",
      "Future build-configuration smoke: insert one-shot temporary DiscoveryProbeLiveSmoke class in already-owned GitContractTest.kt; default :shared:jvmTest with live env absent must not execute its observable body; explicit :shared:jvmGitSmoke --tests exact probe must execute it. Remove temporary class after evidence, no extra permanent file/source-text test.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [x] <!-- evcrate-task:freeze-git-client-contracts --> Add compile-closed identity, safety-port and graph value contracts

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
Run the listed compile command and GitContractTest now at stable future01 boundary. Parent may consolidate same-boundary compiler invocations, never postpone prerequisite proof to06. These are planned commands, not performed during authoring.

## Risks / security / failure / rollback
No source-wording tests as behavior evidence. Additive ports are legitimate interfaces, not success-returning stubs. No dependencies/server changes. Roll back client-only additive change if failed; never mutate remote Git.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
