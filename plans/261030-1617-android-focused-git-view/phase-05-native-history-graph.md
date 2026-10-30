# Phase 05 — Pure ancestry graph and Canvas renderer

## Context / overview
Priority P2. Status in-progress (implementation landed; open for W11 geometry measurement and draw optimization). Effort unestimated. Owner: one **G1 independent graph** owner at each stable task boundary.
Predecessors: freeze-git-client-contracts. Successors: 06 after04 also complete.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [accepted review triage](reports/review-triage.md), [source evidence](reports/coordinator-evidence.md), [Git](reports/git-contract-evidence.md), [safety](reports/workspace-safety-evidence.md). Source facts/static reasoning are not compiled/runtime evidence.

## Key insights
- Graph alone genuinely independent after additive01: existing GitLogEntry already has full OIDs/ordered parents; immutable graph models01 have no runtime future methods.
- Non-topological rows require global parent lookup, not newest-first adjacency.

## Functional / nonfunctional requirements
- Exact OID ancestry, upward/merge/octopus edges, unresolved missing/shallow/off-page parents, no phantom nodes/adjacency.
- Separate pure Kotlin computation and Canvas consuming immutable primitives; no history/row/controller/transport writes. AC03.

## Architecture / data flow
Dataset -> OID index -> ordered real parent edges -> deterministic interval lane allocation -> row-clipped immutable geometry -> Canvas. No dependency on mainline02/03/04; all APIs consumed already implemented01.05 implements documented functions with real bodies now, not declarations in01.

## Exact writable actions
Literal normalized repository-relative paths. Each task is atomic: stop its editor(s), then one verifier checks the coherent changed source set before completing the task. No successor starts from an unverified/broken predecessor.
| Action | File | Purpose |
|---|---|---|
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLayout.kt` | Pure graph implementation/Canvas or dedicated tests |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLayoutTest.kt` | Pure graph implementation/Canvas or dedicated tests |
| Create | `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLane.kt` | Pure graph implementation/Canvas or dedicated tests |
| Create | `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitGraphSegmentsTest.kt` | Pure graph implementation/Canvas or dedicated tests |

Delete files: none; obsolete members/calls deleted atomically inside listed files when their replacement is usable. No shims.

Read-only references:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitHistoryController.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitCommitRow.kt`

## Ordered steps / task IDs
### implement-oid-graph-layout
1. Build OID->row map for whole accepted dataset first. Parent at earlier row creates upward edge; later row downward edge; absent parent unresolved labelled stub, never fabricated node. Ordered parent index distinguishes first-parent/merge/octopus routes.
2. Deterministically assign node/edge interval lanes using real min/max row spans, lowest compatible lanes and first-parent continuity; crossings do not become ancestry. Split at row boundaries using rowIndex-local rendering coordinates; duplicate OID accepted once, contradictory metadata cannot create ghost commits.
3. Test independently expected topology for linear/root/merge/octopus/skewed dates/parent earlier/absent parents/shallow/page append/dedup/empty/stable repeat. Oracle from explicit fixture parent map, not same layout routine. Close compile/tests/actual pure consumer smoke/review before renderer task.

### render-graph-lanes
1. Implement GitGraphLane exactly, theme-compatible row geometry and unresolved styling; pure computation file stays separate. Canvas only reads cached segments/node and translates row coordinates, no graph/query/dataset allocation in draw.
2. Add segment continuity/bounds tests and semantic shape/style support, not color-only identity. No GitCommitRow/GitHistoryView edits;06 integration owns those after this task completes.
3. Compile and run scoped geometry tests + actual primitive/renderer consumer smoke and passing review at this boundary. Phone/tablet screenshots and accessibility07 additionally required; do not claim JVM smoke proves pixel/device qualification.

## Compile-dependency closure (planned, not observed)
Graph model types already compile01 and GitLogEntry is unchanged baseline. Algorithm task only adds actual callable layout and tests. Renderer depends on evidence-complete algorithm and adds actual Canvas+tests. Neither requires04/06;05 final output is complete before06 imports it. Concurrent mainline never writes these four files; verifier schedule still avoids native compiles while another worker edits shared source.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "implement-oid-graph-layout",
    "title": "Lay out real OID ancestry including non-topological rows",
    "blocked_by": [
      "freeze-git-client-contracts"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLayout.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLayoutTest.kt"
    ],
    "constraints": [
      "Only listed graph files writable; pure immutable graph contract01 is frozen. No mainline/history/controller/runtime edits.",
      "Stop own editing before scoped compile/tests/smoke/review; verifier serializes checks with mainline stable boundaries, never over half-edited shared native sources. Complete evidence before dependent task."
    ],
    "acceptance": [
      "Deterministic pure Kotlin layout uses ordered parents/OIDs; upward parent edges, merges/octopus and absent/shallow/off-page stubs preserve actual parent identity.",
      "No invented commits/adjacency edges; appending later parent resolves previous stub without duplicate nodes; layout allocates/computes per changed dataset only."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitGraphLayoutTest\"; require all scoped behavior assertions pass.",
      "Smoke: run actual layoutGitGraph over deterministic linear/merge/octopus/earlier-parent/page-append dataset and inspect produced OID edges (GitGraphLayoutTest.graphConsumerSmoke).",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  },
  {
    "id": "render-graph-lanes",
    "title": "Render immutable graph row primitives with native Canvas",
    "blocked_by": [
      "implement-oid-graph-layout"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitGraphLane.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitGraphSegmentsTest.kt"
    ],
    "constraints": [
      "Only listed graph files writable; pure immutable graph contract01 is frozen. No mainline/history/controller/runtime edits.",
      "Stop own editing before scoped compile/tests/smoke/review; verifier serializes checks with mainline stable boundaries, never over half-edited shared native sources. Complete evidence before dependent task."
    ],
    "acceptance": [
      "Canvas renders only supplied row segments/node using rowIndex-local coordinates, theme/contrast and accessible semantic support; no query/layout/allocation-heavy ancestry work in draw.",
      "Renderer contract independent of history controller/runtime/GitCommitRow; row segment continuity and unresolved style explicit."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "After editors terminate, run & .\\native\\android-app\\gradlew.bat -p native/android-app :shared:jvmTest --tests \"dev.damhopper.nativeapp.features.git.GitGraphSegmentsTest\"; require all scoped behavior assertions pass.",
      "Smoke: run actual Canvas row geometry/semantics consumer with production row primitives (GitGraphSegmentsTest.rowConsumerSmoke); compile renderer now, additional real device visuals07.",
      "Obtain passing scoped implementation review and record actual compile/tests/smoke/review reports before completing this task; no dependency on later06 or07 source."
    ]
  }
]
```

- [x] <!-- evcrate-task:implement-oid-graph-layout --> Lay out real OID ancestry including non-topological rows
- [ ] <!-- evcrate-task:render-graph-lanes --> Render immutable graph row primitives with native Canvas (open for W11 measured row height & layout caching)

## Ownership / transfers / concurrency
Mainline01 ->02 ->03 ->04 ->06 is serialized. Graph05 alone may overlap02/03/04 after evidence-complete additive01. Every repeated writable has a transitive blocked_by ordering. No worker verification over half-edited active sources; one verifier serializes Gradle/device checks at stable boundaries, even when graph editing is independently eligible. Preserve unrelated user/other-plan changes.

## Acceptance / future checks
Task-local compile/tests/consumer smoke/review close both05 tasks. The verifier may pause independent editors to get a coherent working tree, never label task complete without evidence. Additional07 actual Git parent/screenshot inspection remains mandatory.

## Risks / security / failure / rollback
Non-topological crossing cosmetic risk cannot excuse invented edge. Computation per dataset not draw; no global cache/added dependency. Mainline source files read-only. No remote mutation; rollback graph client files only.

## Next / unresolved
No product decision unresolved. Required task compile/tests/smoke/review and later current-server/device/release evidence remain future gates, never waived by this plan. Parent owns final review/validation and execution authorization.
