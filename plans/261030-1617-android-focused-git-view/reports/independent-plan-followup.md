# Independent plan review — bounded targeted follow-up

**Terminal: COMPLETE — targeted coverage complete; one Medium F1 verification-boundary issue remains.**
Final permitted follow-up, restricted to accepted F1/F2/F3 and revised caller/ownership/verification boundaries. Not a second whole-plan review, implementation verification, final user validation or approval to code. Original review preserved; only this report written.

## Exact revised coverage

`P = plans/261030-1617-android-focused-git-view/`; paths below expand relative to repository root.
- `P/reports/review-triage.md:1-23`; `P/reports/planner-authoring.md:1-68`; `P/plan.md:1-63`.
- `P/contracts.md:1-259`, with untruncated revised terminal/smoke contracts230–259; unchanged wire inventory read only as context for cutover ownership, not re-audited.
- `P/acceptance-matrix.md:1-61`, focused on Q0/Q1, mandatory smoke environment, caller closure and F2 propagation.
- `P/phase-01-shared-contracts.md:1-89`; `P/phase-02-workspace-safety-runtime.md:1-171`, including untruncated steps60–65.
- `P/phase-03-daily-git.md:1-205`; `P/phase-04-history-rewrite-publication.md:1-191`.
- `P/phase-05-native-history-graph.md:1-119`; `P/phase-06-focused-workspace-integration.md:1-168`.
- `P/phase-07-live-qualification.md:1-165`, solely fixture/journey prerequisite closure and independent verification modes. Phase08 and unchanged product-design surfaces excluded from this targeted pass; initial full review coverage remains in independent-plan-review.md.

Direct current-source refresh:
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:387-439,448-555,663-710,754-788`.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAttachQueue.kt:1-95`.
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitControllersAndEligibilityTest.kt:140-175`; `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt:135-168`.
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/git/GitRepositoryTest.kt:1-115`; `native/android-app/shared/build.gradle.kts:1-75`; `native/android-app/README.md:330-385`.
- `AGENTS.md:1-255`; `docs/testing.md:1-210`; targeted testing-policy search in `docs/code-standards.md` and installed development rules. No unsupported claim that web-specific discovery rules automatically govern KMP.
- Native commonMain/JVM/Android source searches refreshed definitions and all current constructor/callers of GitOperationScope, GitRootStatus/GitDiffSummary, DiffReviewController/load/save/draft APIs, SquashReceipt/lastSquashReceipt/prepare, required-host controllers and QueuedWrite. Actual anchor results matched revised closure tables; not a compilation claim.
- Initial review's installed task-management evidence contract and source/evidence parser inspection reused unchanged; no helper execution repeated.

## F1 — Partially resolved; remaining Medium verification discovery regression

**Original High completion-cycle / forward-caller defect: addressed at plan level.**
- `P/phase-01-shared-contracts.md:13-17,37-44,53-71` now adds complete values/interfaces/helpers and atomic enum move, without deleting active scope/DTO/receipt/constructor APIs or declaring future executable bodies.
- `P/phase-02-workspace-safety-runtime.md:57-75` implements actual retained safety without GitWorkspaceRuntime, GIT enum exposure or later host constructors. Scope.owner comparison changes only with03.
- `P/phase-03-daily-git.md:63-81,92-124,133-151` includes changed wire/scope/diff definitions with actual Workbench, old tests and earlier-created02 callers. Read-only diff methods and every known Workbench load/save/details caller migrate together.
- `P/phase-04-history-rewrite-publication.md:67-75,144-171` migrates receipt producer/view/panel/leased consumers and existing prepare test166 atomically; no receipt shim or deferred consumer rename.
- `P/phase-06-focused-workspace-integration.md:23-58,73-86,98-150` owns one coupled runtime/required-host/revoke/provider/caller cutover, including prior03 wire-smoke and04 test constructors; real same-task root smoke avoids a07 forward dependency. Runtime is not instantiated before its actual controllers/host implementation.
- Every stable task now requires applicable compile/scoped tests/real smoke/passing review before completion; post06 Q1 is additional. Mainline is serialized01→02→03→04→06; only four-file pure05 graph branches after01. Declared graph writes are absent from post01 mainline arrays; verifier waits for stable compiler inputs. Shared mainline writes are dependency-ordered.
- `P/phase-07-live-qualification.md:46-55,82-94,106-117,155-159` independently verifies fixture self-test/current-server modes before the later journey class exists. No Q2 invocation is required to complete its own fixture prerequisite.

### F1-R — Medium: mandatory external smoke is discovered by the normal JVM unit suite
**Confidence: high. Correction still required.**
- Plan anchors: `P/contracts.md:244-246`; `P/phase-03-daily-git.md:120-123,148-150,182-184`; `P/acceptance-matrix.md:13,20`. Current-server smoke methods are placed inside permanent `:shared:jvmTest` classes and selected with that test runner. Matrix20 explicitly says unfiltered Q1 must receive mandatory URL/auth-token/project environment and cannot skip absent fixtures.
- Supporting repository evidence: `native/android-app/shared/build.gradle.kts:16-20,38-41,71-75` defines ordinary JVM tests with no dedicated external-smoke discovery boundary. `native/android-app/README.md:351-367` documents plain `:shared:jvmTest` as shared JVM unit tests, separately from connected qualification. Existing `GitRepositoryTest.kt:16-25,28-35` owns an ephemeral loopback boundary fixture and teardown, rather than requiring a separately started credentialed product daemon.
- **Concrete failure:** running the existing plain `:shared:jvmTest` command after these planned changes discovers currentServerSmoke/currentServerReadOnlySmoke/currentServerSyncSmoke without the separately provisioned server/token/disposable Git state. Per matrix20 it must fail instead of skip. Supplying the shared environment instead turns an ordinary unit-suite invocation into credentialed Git mutations dependent on external scenario setup. The plan explicitly introduces this behavior, not merely a speculative annotation choice.
- **Impact:** the F1 cycle itself is removed, but its correction changes default unit/full-suite prerequisites and couples deterministic regressions to live mutable fixture availability. This is an execution/maintenance regression, not permission to weaken required real smoke.
- **Smallest correction:** retain deterministic production-consumer/boundary tests in ordinary jvmTest; run mandatory current-server scenarios through an explicit non-default standalone entry point or separately discovered smoke runner/task implemented in the SAME owning task. Declare exact harness/build writable paths and invocation, preserve isolated fixture ownership/cleanup, compile/test/smoke/review-before-completion, and keep ordinary Q1 free of hidden external-service prerequisites. Do not add assume/skip behavior to claim smoke passed, use a product feature flag, or defer smoke to07. Propagate this separation through contracts, affected03/04/06 task verification and matrix20.

## F2 — Resolved at plan level, including current queue effects

**Confidence: high for design correction; implementation unobserved.**
- `P/phase-02-workspace-safety-runtime.md:28-36,57-65,86-119` now literally owns ProjectTerminalScreen, TerminalAttachQueue, current state/controller/root/VM callers and dedicated TerminalScreenBindingTest/TerminalAttachQueueBindingTest. Required QueuedWrite token migrates with its actual screen and visibility-test constructors.
- Actual retained early return (`ProjectTerminalScreen.kt:448-455`) and creation-only callbacks471–553 are addressed by one production installer invoked for BOTH existing/new controllers, also on same-generation tab/surface reattachment. Tests must exercise that same installer, not just direct rebind methods/source text.
- Complete binding captures owner/current ConnectionRef, repository identity, controller/incarnation and advancing attachment/surface epoch. Steps62–63 and `P/contracts.md:233-239` require current-binding admission for all output/buffer/exit/lag/restart, raw input queue drain/results, resize, attach/recovery connect/send/completion and asynchronous banner/history effects. Cancellation is not treated as identity proof; already-sent uncertain input is never replayed.
- Queue source33,60–82,92–94 can independently call beginAttach/failAttach against the retained controller. Revision explicitly fences EVERY queue admission/success/failure/cancel gate effect with captured binding, not only screen callbacks; stale old queue cannot close/reopen fresh replay/input authority. Dedicated regression covers delayed old pending/connect/send/error/cancel after fresh same-controller binding and unchanged accepted bytes; current admitted failure and replay readiness remain tested.
- Same controller/surface/VT grid/scrollback/accepted offset/incarnation/drafts and editor document/undo retained; no PTY restart/create/kill/move. Explicit recovery-plan writer serialization in phase02:161-168 and overview58 remains required. No remaining material F2 plan gap established.

## F3 — Resolved at plan level; parent-observed parser success reused

- `P/plan.md:23-30,57-59` has eight local sibling phase links and links the legacy overview, with exact legacy phase retained as inline prose, not an external phase Markdown link. Mermaid dependency graph32–42 and corrected07 Gradle reference are present.
- Parent reports installed `source.load` exit0, eight phases/16 tasks, fingerprint `28c243667d4e5a85b5a91de55b5c7272ef581a89334b026afefaea97f8b78a85`. Reused as attributed parent evidence; not reviewer-executed or a runtime pass. No hydration. Original parser rejection condition is removed by static inspection.

## Checks, limits and final disposition

- Performed targeted artifact/caller/write-set/dependency reasoning and refreshed screen/queue effects. No product implementation, builds, tests, typechecks, formatters, installs, Git commands, server/device requests, external research, delegation, interview, hydration or plan/source/task-state edits.
- No assertion that revised code compiles: all proposed APIs/tests/harnesses remain future work. Binary/device/current-server/real Git and physical ARM64/API29/form-factor evidence still required; absent prerequisites block their applicable execution gates honestly.
- F1 original High cycle and F2 High missing terminal writer are corrected in the design; F3 parser issue corrected with parent-reported structural success. **F1-R Medium smoke discovery coupling remains for parent disposition/correction before readiness.** No additional material finding within this bounded scope.
- This is the final permitted targeted review, not approval by review-count exhaustion. Parent retains structural validation, triage and final-plan validation. No further whole-plan audit or automatic review loop requested.

## Unresolved questions

No new product decision. Explicit non-default smoke invocation/ownership needs correction as F1-R; runtime/compiler/device correctness remains unmeasured future evidence, not an unanswered design choice or claimed pass.

## Parent-selected correction after reviewed snapshot

Parent accepted F1-R and selected a separate explicit test-runner boundary: future01 owns `native/android-app/shared/build.gradle.kts`; default jvmTest excludes `**/*LiveSmoke.class`, while explicit `jvmGitSmoke` copies existing test classes/classpath, depends on jvmTestClasses and includes only LiveSmoke classes. Same-task03/04 separately owned LiveSmoke classes run mandatory current-server/bare-remote smoke via `:shared:jvmGitSmoke --tests <FQCN>` before completion;06 owns their changed constructor callers. Default Q1 receives no external smoke environment requirement. This is an accepted corrective direction, **not inspection or closure of not-yet-written revisions**. Parent owns exact literal-file/command/dependency propagation, structural validation and final disposition; no additional independent pass implied.
