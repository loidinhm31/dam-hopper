# Independent plan review — Android Agent Hub

## Result and provenance
- **Status: COMPLETE** — independent initial plan-only challenge; **revision required** for F1/F2 before readiness. Review completion is not implementation acceptance or user approval.
- Canonical selection unchanged: `plans/261107-0305-android-agent-hub-redesign/plan.md`.
- Caller reports previous `AndroidPlanReview` attempt FAILED exit1 on provider `usage_limit_reached`, producing no report/approval. This authorized retry is the initial review, not a targeted follow-up or a prior successful gate.
- Product, plan, task state and supporting evidence read-only. Sole write: this report. Parent owns triage/revision, final validation and any one targeted follow-up.

## Material findings

### F1 — High: verification prohibition deadlocks evidence-backed dependency scheduling
- **Plan:** `plans/261107-0305-android-agent-hub-redesign/phase-01-shared-contracts.md:74-84,97-98`; `phase-02-atomic-api-cutover.md:300-311,393-403,419-420` in the same directory; `execution-ownership.md:7-13`; `phase-08-qualification-docs-handoff.md:77-105`.
- **Spec evidence:** `~/.omp/agent/skills/planning/references/task-management.md:79-83,96-120`: dependent claims require completed prerequisites; implementation terminal != completion; applicable compile, tests, smoke and passing review precede evidence-backed completion. Helper does not execute verification strings or grant waivers.
- **Failure:** P01 forbids every build/test/smoke until P08, yet P02 is blocked by P01. P08 transitively depends on P02/G-A/P07. Thus the coordinator cannot truthfully complete P01 to admit P02, or reach P08 to obtain P01's deferred evidence. The same contradiction repeats inside P02 and each feature chain. “Terminal authoring result”/“compile conceptually” cannot substitute for helper completion.
- **Impact:** implementation scheduling stalls immediately, or bypasses durable gates using unverified completion. Structural DAG/allowlist success does not detect this semantic cycle. **Confidence: high.**
- **Smallest fix:** retain existing helper and task IDs; allow the designated coordinator to run scoped applicable compile, focused regression tests, meaningful task-local smoke and independent review after coherent tasks/waves stop, before recording completion/releasing dependents. Explicitly prohibit checks while siblings are editing; hold ready successors until that barrier. Keep full integrated/device/live release suites in P08. Separate task-local completion criteria from final end-to-end release criteria so tasks do not require dependent future work to complete. Propagate through all P01–P07 constraints/verification/barriers, C9, ownership and acceptance A27/command timing; no new scheduler/task engine or fabricated waiver.

### F2 — High: canonical shared-map design does not settle native document lifetime
- **Plan:** `plans/261107-0305-android-agent-hub-redesign/phase-01-shared-contracts.md:22`; `phase-06-codebase-files-editor-git.md:21,91-96,175-182`; `phase-07-root-lifecycle-integration.md:21,87,180-183` in the same directory; `acceptance-matrix.md:16-17`.
- **Source evidence:** `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt:91-122,396-415,782-790` creates/replaces sessions and closes them on tab/all-tab closure; `features/editor/EditorSession.kt:309-314` under that same commonMain prefix closes its document. `features/workspace/ProjectWorkspaceState.kt:460-474` closes all tabs on workspace close. `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt:521-529` closes the native authority and disables undo; attaching a closed document fails at lines474-475.
- **Failure:** workspace alias A and project alias B share the proposed native holder. Closing A's tab/workspace, or replacing A's session during a tier-changing reload, can still run the existing session-owned close against B's shared document. A shared map deduplicates lookup but does not specify who owns disposal, which alias releases only a view/reference, or how reload/discard affects all aliases. Keeping the closed holder breaks B/reopen; deleting/recreating it loses native undo and may split retained dirty state.
- **Impact:** loss of undo/usable dirty authority or closed-document failure under the explicitly required alias flows. This is a missing design contract, not a claim the future implementation already contains the bug. **Confidence: high.**
- **Smallest fix:** freeze lifetime/attachment rules alongside identity in P01: existing retained owner owns the canonical document; alias/tab/session closure releases only its own reference/listeners/view, never closes a holder another alias or retained dirty state owns. Define final disposal, in-flight-save protection, and explicit canonical reload/discard/tier replacement reconciliation across aliases. Adapt existing EditorSession/EditorTabsState/ProjectWorkspaceState/native attach-detach paths in their already-owned phases; no new registry/runtime. Add acceptance for edit A → open B → close A/its workspace → undo/save B; reverse close order; alias reload/tier change; and old-view detach after successor attachment. Native attach/detach currently shares one receipt (`AndroidEditorDocument.kt:474-514`), so release must also be exact-view-owned.

## Risk coverage and non-findings
- Explicit REST/nested WS FS targets, mixed outer casing, nested camelCase identity and WS base64 data are correctly distinguished. Same-content-response identity is required before editable publication; no stat/read identity race fallback. No additional wire mismatch established from inspected source.
- C6 preserves original create PTY UUID and lossless numeric u64, distinct agent/workspace epochs, exact guarded POST End, acknowledgement != exit, local hide/reopen and hidden/restart/unknown counts. Unknown-create storage precedes dispatch and survives process death; no retry/TTL/list-absence/retirement-as-proof. Terminal WS remains raw ID/data/dimensions/from_offset; no invented fields.
- Settings explicitly separates A/B/C, sparse omission versus JsonNull, TOML storage representation, raw unrelated/unknown fields and destructive root consent. Notification read-mark versus route, once-per-process intake, pre/post consent owner/socket/agent checks, fresh terminal identity, privacy cover/input gating and owner-scoped retirement are specified.
- Four G-A branches have genuinely separated declared domains; shared-root integration is serial and missing callers require deliberate scope revision. Parent's structure-only report records zero unordered overlaps; not rerun here. F1 concerns completion/barrier semantics, not a newly alleged path collision.
- P02/P07 “Create” lists repeat P01-created files (`phase-02-atomic-api-cutover.md:25-27`, `phase-07-root-lifecycle-integration.md:25-28`). No consequential duplicate writer: exact transfer ledger and dependencies order them; not a material finding. Treat as Modify at transfer, not permission to overwrite prior definitions.
- Reverse-DAG client rollback preserves remote sessions/config/uncertain creates/dirty memory; no server rollback/reset/secret deletion. F2 must clarify document disposal under this retained-state promise.
- Missing ready physical devices/API/ABI/human captures, authenticated fixture/crypto-storage isolation and actual retirement qualification are future execution gates, not demands that implementation exist during planning. WS read success and close1006 failure remain separate; no rerun or suppression requested.

## Exact inspected scope
Repository-relative paths below; ranges inclusive. Entries on the same line remain separate inspected files, not directory-wide coverage.

### Selected plan and all linked/support artifacts
- `plans/261107-0305-android-agent-hub-redesign/plan.md:1-66`
- `plans/261107-0305-android-agent-hub-redesign/phase-01-shared-contracts.md:1-101`
- `plans/261107-0305-android-agent-hub-redesign/phase-02-atomic-api-cutover.md:1-423`
- `plans/261107-0305-android-agent-hub-redesign/phase-03-hub-terminal-presentation.md:1-163`
- `plans/261107-0305-android-agent-hub-redesign/phase-04-settings-ui-preferences.md:1-146`
- `plans/261107-0305-android-agent-hub-redesign/phase-05-notifications-feed-platform.md:1-132`
- `plans/261107-0305-android-agent-hub-redesign/phase-06-codebase-files-editor-git.md:1-236` (long line21 additionally read raw).
- `plans/261107-0305-android-agent-hub-redesign/phase-07-root-lifecycle-integration.md:1-206`
- `plans/261107-0305-android-agent-hub-redesign/phase-08-qualification-docs-handoff.md:1-194`
- `plans/261107-0305-android-agent-hub-redesign/architecture-contracts.md:1-46` (long lines19-43 additionally read raw).
- `plans/261107-0305-android-agent-hub-redesign/execution-ownership.md:1-269`
- `plans/261107-0305-android-agent-hub-redesign/acceptance-matrix.md:1-66`
- `plans/261107-0305-android-agent-hub-redesign/reports/planning-intake.md:1-20`
- `plans/261107-0305-android-agent-hub-redesign/reports/android-evidence.md:1-113`
- `plans/261107-0305-android-agent-hub-redesign/reports/api-compatibility-evidence.md:1-94`
- `plans/261107-0305-android-agent-hub-redesign/reports/android-ui-ux-design.md:1-108` (long line4 additionally read raw).
- `plans/261107-0305-android-agent-hub-redesign/reports/design-dispositions.md:1-23`
- `plans/261107-0305-android-agent-hub-redesign/reports/local-api-smoke.md:1-53`
- `plans/261107-0305-android-agent-hub-redesign/reports/authoring-validation.md:1-36`
- `plans/261107-0305-android-agent-hub-redesign/reports/coordinator-structural-validation.md:1-17`
- `plans/261107-0305-android-agent-hub-redesign/reports/planner-handoff.md:1-50` (long line38 additionally read raw).

### Repository/spec evidence
- `README.md:1-122`; `docs/project-overview-pdr.md:1-145`; `docs/code-standards.md:1-180`; `docs/architecture/android-native-client.md:1-125`. Long truncated historical table cells are not relied on; remaining architecture/standards sections excluded.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt:1-260,273-334,350-417,761-809`; additionally targeted grep of session install/remove/close/reload sites, not whole-file review.
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt:12-90,300-321`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinator.kt:1-151`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt:220-296,390-455,460-511`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt:468-534`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1310-1408,1430-1495`
- Targeted grep excerpts only: `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt:19-29,48-72,139-149`; `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt:85-98,132-152`. Not whole-file source coverage.
- `server/src/api/ws_protocol.rs:1-142,175-245`; `server/src/workspace_target.rs:35-168`
- `server/src/api/fs.rs:95-105,116-159,298-387`; targeted identity grep at lines184-217.
- `server/src/api/terminal.rs:209-239,337-410,414-452,607-657`; targeted validation grep at lines555-606.
- `server/src/api/config.rs:592-637,672-721`; `server/src/config/global.rs:156-189,256-270` (targeted grep excerpts only).
- `server/src/crypto/opaque.rs:33-63`
- `~/.omp/agent/skills/planning/SKILL.md:1-113`; `~/.omp/agent/skills/planning/references/plan-review.md:1-46`; `~/.omp/agent/skills/planning/references/task-management.md:1-137`
- `~/.omp/agent/skills/code-review/SKILL.md:1-143`; `~/.omp/agent/evcrate/workflows/development-rules.md:1-44`; `~/.omp/agent/evcrate/AGENTS.md:1-87`

## Checks, exclusions and unresolved questions
- Performed: actual eight-phase/support-artifact reading; manual contract/dependency/failure/rollback/ownership challenge; targeted current-source/spec corroboration for material findings. Planning/code-review guidance directly loaded; plan-only branch applied.
- Not performed: builds/tests/lint/formatters/smoke/installs/Git/helper execution/task hydration, device/UI/human runtime validation, external research, nested delegation or Advisor. No execution results invented. Prior runtime/structural observations are attributed report evidence, not reviewer execution.
- Excluded: full repository/security audit, unlisted source sections, re-review of all historical plans/web code, secret contents and independent reproduction of reported local/API/device observations. No final user interview/approval.
- **Unresolved:** parent disposition/propagation of F1/F2; parent-owned product confirmations (direct Hub/adaptive chrome, already-connected-profile breadth). No additional unreachable evidence prerequisite identified for this completed challenge. Runtime/device/auth/crypto qualifications remain pending implementation gates.
