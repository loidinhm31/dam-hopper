# Independent focused-Git plan review

**Terminal: COMPLETE — plan-only coverage complete; changes required before readiness.**
Findings: **2 High, 1 Medium**. Not implementation review, final user validation, authorization to code, or release qualification.
Only this report written; overview/phases/contracts/source/task state unchanged.

## Exact inspected coverage

Plan prefix `P = plans/261030-1617-android-focused-git-view/`:
- `P/plan.md:1-61`; `P/contracts.md:1-222` (including untruncated signatures); `P/acceptance-matrix.md:1-52`.
- `P/phase-01-shared-contracts.md:1-164`; `P/phase-02-workspace-safety-runtime.md:1-203`.
- `P/phase-03-daily-git.md:1-165`; `P/phase-04-history-rewrite-publication.md:1-200`.
- `P/phase-05-native-history-graph.md:1-117`; `P/phase-06-focused-workspace-integration.md:1-137`.
- `P/phase-07-live-qualification.md:1-155`; `P/phase-08-documentation-release-evidence.md:1-93`.
- `P/reports/coordinator-evidence.md:1-45`; `git-contract-evidence.md:1-45`; `workspace-safety-evidence.md:1-32`; `planner-authoring.md:1-48` (last three also under `P/reports/`). Evidence reports reused, not treated as executed results.
- `plans/reports/brainstorm-261030-1451-android-focused-git-view.md:1-150`.

Direct repository/spec refresh; prefixes expand to exact repository-relative paths:
`K = native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`;
`A = native/android-app/androidApp/`;
`H = ~/.omp/agent/` (installed HOME resources, not repository writes).
- `README.md:1-108`; `docs/project-overview-pdr.md:1-12,45-64,76-90`; `docs/code-standards.md:45-100`.
- `docs/architecture/android-native-client.md:19-100,124-153,188-210,294-365`; `docs/android-native-acceptance.md:609-638`.
- `docs/api/git.md:14-145,404-525,687-735`.
- `server/src/git/types.rs:1-105,330-405,425-455,655-717,900-1010`; `server/src/git/repository.rs:1627-1750`.
- `server/src/api/router.rs:163-248`; `server/src/api/git.rs:20-42,110-224,320-423,530-690,790-900`; `server/src/api/git_diff.rs:1-145,440-510`.
- `K/features/git/GitRepository.kt:1-56`; `GitOperationScope.kt:1-48`; `GitChangesController.kt:1-175`; `GitHistoryModels.kt:1-125` (latter three same Git directory).
- `K/features/workspace/ProjectWorkspaceState.kt:1-325`; `K/features/workspace/WorkspaceFileOwner.kt:1-65,118-160`.
- `K/ui/screens/ProjectTerminalState.kt:1-125,190-280`; `K/features/terminal/TerminalSessionController.kt:1-335,400-455,470-515` plus targeted sink/authority occurrences through659; `K/features/terminal/TerminalAttachQueue.kt:1-95`.
- `K/ui/screens/ProjectTerminalScreen.kt:440-555,660-714,752-820` plus targeted attachment/collector occurrences; `K/ui/screens/DamHopperMobileApp.kt:250-385,720-860`.
- `K/ui/screens/WorkbenchScreen.kt:300-342,739-779,1245-1263`; `K/features/profiles/ProfileRepository.kt:30-95,165-305`.
- `A/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:920-978,1310-1405`; `A/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt:1-200`; `A/build.gradle.kts:1-115`.
- `native/android-app/scripts/run-editor-explorer-journeys.sh:1-240`; `server/examples/application_e2e_seed.rs:1-190`.
- Targeted native source/test searches: changed DTO/scope/receipt/diff/rebind callsites, profile bootstrap, RetainedRootServices implementations. Searches supplement, not replace, line reads above.
- `H/evcrate/AGENTS.md:1-56`; `H/evcrate/workflows/development-rules.md:1-44`; `H/skills/code-review/SKILL.md:1-143`; `H/skills/planning/SKILL.md:1-113`.
- `H/skills/planning/references/plan-review.md:1-46`; `task-management.md:1-137` (same references directory).
- `H/evcrate/scripts/plan-tasks/source.cjs:1-62`; `markdown.cjs:1-57`; `evidence.cjs:1-59` (same helper directory).

## Material findings

### F1 — High: prerequisite completion depends on its own blocked integration
**Confidence: high.** Plan: `P/phase-01-shared-contracts.md:17,55-67,83-93,110-120,134-144`; `P/phase-06-focused-workspace-integration.md:64-73,93-118`; `P/contracts.md:185-189,210-215`.
- Phase01 changes shared DTO return types, scope constructor and receipt type without migrating all consumers until03/04/06. It expressly defers constructor compilation and all coherent checks until06, while06 requires those predecessor tasks complete. The same deferred-only pattern extends across02–05 and the first06 task.
- Current proof: `K/features/git/GitChangesController.kt:62-67` requires `diff.staged`, `diff.unstaged` and a bare untracked list, incompatible with phase01's new envelope. `K/features/git/GitRewriteActionController.kt:22-23,138-145` and `GitHistoryView.kt:22-27` still use the removed SquashReceipt; `K/ui/screens/WorkbenchScreen.kt:749-755` still constructs the old scope. Constructor/diff API callers are also postponed to06.
- Governing gate: `H/skills/planning/references/task-management.md:96-120`; actual `H/evcrate/scripts/plan-tasks/evidence.cjs:14-33` requires applicable compile, tests, smoke and passing review. An implementer's terminal result is not evidence-complete dependency satisfaction.
- **Failure/impact:** execution cannot honestly complete01 to start its dependent lanes, or complete those lanes to start06, without checks deliberately deferred until06 and a temporarily uncompilable common source set. Treating them as complete invents alternate execution semantics or false evidence.
- **Smallest correction:** re-slice shared API changes with every affected caller/test migration in the same coherent, compilable task; explicitly transfer literal ownership and dependency edges. Serialize dependent mainline boundaries where necessary rather than forcing four lanes; pure graph work may remain parallel only against genuinely frozen, verifiable contracts. Let one verifier perform scoped compile/behavioral smoke/tests/review at stable task boundaries; keep post06 Q1 as an additional integration gate. No shims, no-op hosts, test waivers or unverified prerequisite completion. Also remove forward verification dependencies such as07 fixture task Q2 requiring its later journey class.

### F2 — High: required terminal rebind cannot reinstall the retained controller's callbacks within declared ownership
**Confidence: high.** Plan: `P/contracts.md:128`; `P/phase-02-workspace-safety-runtime.md:23-40,55-59,86-105`; no phase's allowed_files includes ProjectTerminalScreen.kt.
- Contract requires clearing old raw input/reattach callbacks and assumes the existing root reinstalls fresh ones without replacing the controller/surface/grid.
- Contrary source: `K/ui/screens/ProjectTerminalScreen.kt:448-455` immediately returns an existing same-incarnation controller. Callback installation at471-553 therefore never runs for that retained controller: resize, raw input sink, recovery closure remain missing after mandated clearing, or stale if preserved. `K/features/terminal/TerminalSessionController.kt:450-452,606-610` uses those callbacks for recovery/input.
- The screen's `664-708` collectors also dispatch into the retained controller map with no captured transport-binding token; controller event methods currently receive no source generation. Cancellation alone cannot meet the explicitly required late-old-generation rejection.
- **Failure/impact:** same-owner reconnect with unchanged PTY incarnation preserves the grid but loses input/recovery, or retains old-runtime closures/output admission. This breaks AC01/AC08 and the narrow-rebind prerequisite, not an adjacent terminal redesign.
- **Smallest correction:** explicitly add this screen's narrowly scoped callback reinstall/current-generation stream admission to the rebind task's literal writes and steps; install fresh callbacks for existing as well as new controllers, invalidate old attach/write work and fence all old stream/attach results by binding identity. Extend targeted behavior tests to exercise actual retained-screen binding across generation/tab reattachment, not only direct rebind methods. Preserve controller/surface/grid/replay offset/drafts and remote PTY; serialize related recovery-plan ownership.

### F3 — Medium: canonical overview is rejected by installed phase-link parsing
**Confidence: high.** Plan: `P/plan.md:57` links directly to `../261015-1647-android-native-app/phase-12-complete-git-and-safe-history-workflows.md`.
- Support: `H/evcrate/scripts/plan-tasks/source.cjs:9-29` treats every Markdown link ending in phase-NN-*.md as a selected phase, then requires a normalized sibling basename. The external legacy phase link violates that rule before loading this plan's eight phases.
- Parent supplied observed `source.load` failure: `SPEC_INVALID: Phase links must be normalized local sibling Markdown paths`. Reused as reported evidence; not rerun by reviewer.
- **Failure/impact:** later hydration/readiness cannot load the otherwise structurally authored plan. The author's custom schema/DAG inspection is not equivalent to this parser gate.
- **Smallest correction:** link the legacy overview `../261015-1647-android-native-app/plan.md`; retain the exact superseded phase path in inline code/plain prose or supporting contracts. Parent reruns the normal structural gate after revision; no helper change needed.

## Checks performed / sound design retained

- Reviewed all ten approved criteria against tasks, negative cases and independent evidence requirements: no criterion intentionally dropped; native graph remains mandatory, search flat, details/diff nested and read-only, no resolver/editable-diff/server/dependency/runtime expansion.
- Inspected literal02/03/04/05 unions:18/12/16/4 files, six pairwise intersections empty; repeated planned writes are transitively ordered, history row/view transfer to sole06 explicit. This textual write-set proof does **not** cure F1's compile/evidence closure or F2's missing writer.
- Refreshed exact status/lastCommit/gitlink/diff/conflict/operation fields and current route/body limits. Fetch/pull have no root; root push does. Canonical refs, full messages, exact CAS/snapshot/receipt validation for BOTH rewrites, no-op/uncertain exclusions and separate leased publication are specified.
- Graph covers actual ordered parents, earlier-row parents/upward edges, unresolved page/shallow boundaries, merge/octopus, raw-offset dedup and non-atomic pagination reconciliation; no adjacency ancestry or per-draw layout claim.
- Checked owner/account fail-closed authority, query/details/background-layout identity, acknowledged discard/details reconciliation, actual dirty-draft discard, post-prompt revision/discovery validation, consistent flow/store commit, all-retained exact-owner dirty checks and authoritative fresh qualified/legacy terminal preflight/projected removal mapping. No additional established design defect found beyond F2.
- Fixture design uses current server plus existing seed helper (`--stdin` supports protected secret input), vault/profile bootstrap followed by real auth refresh, disposable real Git/bare remote and independent host Git oracle. Current Gradle already supplies Compose instrumentation dependencies. Future runner/API/commands explicitly labelled future; old optional/direct-state journeys not misrepresented as mounted proof.
- Hardware absence remains blocked release evidence; H1–H5 are historical, not five newly reproduced defects; rollback installs prior client without server reset or reversing completed Git actions.
- Advisor challenged the three candidate findings/corrections; advisory is not independent source, product verification or approval.

## Exclusions, missing evidence and unresolved questions

- **Not performed:** builds, typechecks, tests, linters, formatters, installs, Git commands, server/HTTP/device execution, task hydration or plan updates; no nested delegation, research or interview. Parent's reported parser failure was not repeated.
- Read-only source review is targeted to material contract/lifecycle/fixture claims, not a whole-repository audit. Existing unrelated implementation defects and minor wording/path/style issues excluded.
- Missing by design: implemented behavior, current binaries/auth fixture operation, exercised real-server request/Git results, emulator/physical ARM64/API29 and phone/tablet visual evidence. These remain future execution/release gates, not asserted passes or a blocker to completing this review.
- **Unresolved questions:** no new product decision. Parent must triage F1–F3 and propagate accepted corrections through every affected contract/task/write-set/dependency/check; one targeted follow-up may review revised failure surfaces. Review COMPLETE does not make the plan ready or authorize implementation.
