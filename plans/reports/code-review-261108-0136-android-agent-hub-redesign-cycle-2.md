# Android Agent Hub — Code Review Cycle 2

## Score: 4/10

**Disposition: changes requested.** C-06 is addressed in the inspected production source. C-01–C-05, C-07 and C-08 remain incomplete; several fixes address one local branch rather than the original end-to-end invariant.

## Scope and evidence

Static re-review of the eight Cycle 1 critical findings, their production callers, editor/terminal/notification security boundaries, supporting regression sources and C1–C10 architecture contracts. Read `README.md`, `docs/project-overview-pdr.md`, `docs/code-standards.md`, published development rules and code-review skill. Reviewed approximately 3,000 lines across relevant source/test/document excerpts; not a full Android/security audit.

Source references below use these prefixes, relative to `native/android-app/`:
- `common/` = `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`
- `android/` = `androidApp/src/main/kotlin/dev/damhopper/nativeapp/`

No production code, plan or task-state changes. No builds, tests, lint, device checks or live-server checks executed; integrated verification belongs to Main. Findings are source-path evidence, not device reproductions. Report is the only file added.

## Eight-fix reassessment

| Cycle 1 issue | Source-review result |
| --- | --- |
| C-01 active Hub | **Incomplete:** snapshot collected and callback passed, but receiving Composable never uses either. |
| C-02 canonical document identity | **Partial:** first install and native snapshot retain identity; missing-identity admission and reload/replacement gaps remain. |
| C-03 reconnect authority | **Incomplete:** equality rejects explicitly different epochs, but production owners still omit epoch and no fresh identity reauthorization occurs. |
| C-04 disposal ownership | **Partial:** immediate disposable replacement cleanup added; deferred disposal, final discard and same-widget stale detach remain unsafe. |
| C-05 privacy/input cover | **Partial:** notifications now suspend terminal input; project picker is omitted while masked. Other separate-window dialogs and editor dispatch gates remain uncovered. |
| C-06 worktree targeting | **Addressed in source:** session selection requires exact project/worktree and both visible creation requests include worktreePath. Runtime regression not executed. |
| C-07 notification activation | **Partial:** captured non-null socket is compared; post-consent authoritative inventory and exact route incarnation remain absent. |
| C-08 guarded target commit | **Partial:** picker uses deferred request seam; Hub actions still mutate targetStore before consent, and picker revalidation is unconditional. |

C-06 evidence: `common/ui/screens/ProjectTerminalScreen.kt:511-520,723-738,1628-1635,1752-1755`. No root/sibling fallback survives the inspected selectable-session filter.

## Critical Issues (7): MUST FIX

### C-01 — Active Hub wiring is still inert
- Evidence: `common/ui/screens/DamHopperMobileApp.kt:540,838-869,1093-1278`.
- Root collects `hubSnapshot` and passes `onAction`, but `AgentHubEmptyRoot` never reads either parameter. It still renders the empty-project card and disables Files/Editor. Selected-project branch still mounts the previous project workspace without the Hub snapshot/actions. Fleet sessions, free terminals, zero-session targets and Hub actions therefore remain unreachable through the claimed integration.
- Correction: render retained Hub inventory/actions in the active stage; expose workspace Files/Editor without requiring a project. Do not count passing unused parameters as integration. C1/C2/C4. **Confidence: high.**

### C-02 — Canonical identity remains optional for editable admission and is lost on replacement
- Evidence: `common/features/editor/EditorContentLoader.kt:77-100`; `EditorTabsState.kt:328-355,385-417,599-620,1207-1214,1262-1274`; `android/platform/editor/AndroidEditorDocument.kt:494-503`.
- Initial `installSession` now installs non-null identity and native save snapshots carry it: that part is corrected. However, successful editable reads still accept null/invalid identity and manufacture a target/path key. Tier-changing reload constructs a successor without installing the read identity; same-tier reload replaces content without checking/updating its canonical baseline. A replacement save can again have null identity, or a changed file can retain an old key.
- Correction: reject or read-only downgrade unqualified reads before editable publication; validate same-response identity and preserve/reconcile it in every reload/replacement path. C4. **Confidence: high.**

### C-03 — Production reconnect still restores authority without fresh file authorization
- Evidence: `common/ui/screens/DamHopperMobileApp.kt:365-371`; `common/features/workspace/WorkspaceFileOwner.kt:19-27,45-54`; `ProjectWorkspaceState.kt:282-320`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1562-1590`.
- Explicit non-null epoch mismatch is rejected by owner equality, but the active root still creates owners with null workspace epoch/root. Reconnect finds the same owner, replaces repositories and clears retirement immediately, with no authorized read matching retained canonical identity. Same endpoint/account after a server workspace change can re-enable old dirty buffers; mtime CAS is not identity authorization.
- Correction: capture authoritative workspace identity/epoch and retain document-level write revocation until a fresh authorized read matches the original baseline. Preserve dirty/undo recovery on mismatch. C4. **Confidence: high.**

### C-04 — Final-close/replacement disposal and stale native detach remain unsafe
- Evidence: `common/features/editor/EditorTabsState.kt:119-134,156-190,689-705`; `EditorSession.kt:324-328`; `android/platform/editor/AndroidEditorSurface.kt:98-105,159-162`; `AndroidEditorDocument.kt:78-82,115-117,559-580`.
- Mounted last-alias close prunes before its view lease is released. Surface release calls the document directly, not registry pruning; dirty Discard intent is not remembered. Reopening can recover edits already discarded. Replacement only closes the old document if immediately disposable; an outstanding old view has no later disposal owner, and registry pruning explicitly ignores replaced documents.
- Token comparison now protects receipt/view-state mutation, but `detachEditor` always executes `hideSoftInput`, `clearFocus`, and `release` even after a token mismatch. Same-widget/new-token stale detach still releases the successor widget.
- Correction: retain exact-document disposal ownership until all lease/save settlements, remember final discard, and reject stale same-widget detach before any widget mutation/release. C4. **Confidence: high.**

### C-05 — Privacy still leaves separate-window dialogs and editor dispatch unprotected
- Evidence: `common/ui/screens/DamHopperMobileApp.kt:544-549,572-574,996`; `common/ui/screens/ProjectTerminalScreen.kt:1742-1747,2375-2405,2450-2455,2522-2523`; `ProjectWorkspaceScreen.kt:471-475,554-556`; `common/ui/components/CognitoOverlay.kt:57-84`; `common/features/workspace/ProjectWorkspaceState.kt:460-483`; `common/features/editor/EditorSession.kt:73-76,271-287`.
- Notifications now participate in terminal suspension and the root project picker is omitted while masked. Terminal create/close/hidden/diagnostics and dirty-departure dialogs still mount without mask checks in separate Compose windows, outside the in-content overlay. The editor session gate still ignores `_inputSuspended`; `setInputSuspended` updates only the terminal, so session edits remain permitted under cover despite surface/focus blocking.
- Correction: apply privacy/input policy to every dialog window while preserving retained intent, and enforce cover at editor session/document dispatch as well as the widget. C7/C8. **Confidence: high for code gaps; device behavior unexecuted.**

### C-07 — Notification consent still validates cached state instead of fresh terminal authority
- Evidence: `android/platform/workspace/NativeWorkspaceViewModel.kt:806-809,822-847,2067-2099`; `common/ui/flow/AppFlowNavigation.kt:309-339`.
- Non-null captured socket comparison is present. But authoritative `listDetailed()` runs only before departure consent; post-consent callback merely repeats synchronous `checkLive` against cached reducer state. Terminal exit/project/worktree mutation while consent is open can route stale data. `routeToTerminal` explicitly commits `required = null`, so notification routing does not retain the resolved incarnation for selection/attachment.
- Correction: after consent, re-fetch exact authoritative terminal inventory, revalidate owner/account/socket/agent, then commit the captured incarnation through the existing exact-route machinery. C7. **Confidence: high.**

### C-08 — Only the picker migrated to guarded target commits
- Evidence: `android/platform/workspace/NativeWorkspaceViewModel.kt:1867-1881`; `common/ui/screens/DamHopperMobileApp.kt:1002-1021`; `common/ui/flow/AppFlowNavigation.kt:366-409`.
- `SelectProjectTarget` and `OpenZeroSessionProject` still write targetStore before guarded `selectProject`; Cancel leaves shared target and visible owner disagreeing. Picker defers store mutation correctly, but passes `revalidate = { true }`, not captured owner/generation/account authority. Delayed consent can commit a stale picker selection.
- Correction: migrate all target-changing callers to one post-consent, owner-revalidated commit; cancelled/busy/stale attempts must change neither flow nor targetStore. C8. **Confidence: high.**

## Warnings (7): SHOULD FIX

1. **Unqualified duplicate Hub state (C2/C6).** `android/platform/workspace/NativeWorkspaceViewModel.kt:1176-1201,1288-1319,1930-1943`; `common/features/workspace/AgentHubModels.kt:17-29`: pin/hidden sets use raw IDs across profiles/incarnations; free-terminal rows lack owner qualification, and owner lookup falls back to any workspace in a profile. Reuse one exact retained qualified authority; never let equal IDs or stale account/target state affect another owner.
2. **Uncertain-create admission/settlement gaps (C6).** `common/features/terminal/TerminalRepository.kt:109-145`; `TerminalModels.kt:213-220`: intent IDs are timestamp strings despite UUID contract, project-null ambiguity does not block a different-ID free-terminal create, records omit endpoint/account, and every 4xx clears ambiguity. Persist exact logical-owner/explicit UUID intent and clear only on definitive original success/refusal, not ambiguous gateway timeout.
3. **Termination support inferred, not advertised (C3/C6).** `common/features/terminal/TerminalRepository.kt:47-61`; `TerminalPresentationPolicy.kt:124-129`: ignores `X-DamHopper-Termination-Version`; UUID/incarnation syntax enables End Session. Require advertised version 1 and matching fresh inventory; preserve local Close View when unsupported.
4. **Command rename/delete still retains old entries (C5).** `common/features/settings/RemoteConfigEditor.kt:544-548,687-693`: original command map is overlaid with current rows; deleting one of several commands or renaming keeps the removed name. Reconcile represented original row names, preserving only genuinely unknown/unrepresented entries.
5. **Upload serializer still sends duplicate selectors (C3).** `common/features/files/TransferCoordinator.kt:68-76`: sends nested target and flat project/worktree fields. Remove flat selectors and update serializer assertions for exact clean-cutover payload.
6. **Repeated full-document allocations (performance/DRY).** `common/features/editor/EditorSession.kt:28-31`; `EditorTabSaveCoordinator.kt:23-31`; `EditorTabsState.kt:1214-1240`: mtime getter serializes the entire UTF-8 document after save already captured a snapshot; replacement listener plus explicit session reconstruction duplicates replacement work. Use captured snapshot mtime/O(1) baseline and one replacement publication path.
7. **Readiness and documentation overclaim (C10).** `plans/261107-0305-android-agent-hub-redesign/reports/live-api-qualification.md:3-27` labels mock/unit/oracle checks runtime verification while explicitly deferring real multi-server qualification. `docs/code-standards.md:16,65` and PDR lines 7/45 still document the replaced linear flow. Mark live gate incomplete, retain the honest blocked-device gate (`device-visual-qualification.md:3,17-25`), and update architecture/docs/changelog without claiming release readiness.

## Suggestions (2): NICE TO HAVE

1. Add production-root regressions, not only helper/equality assertions: render nonempty Hub inventory and dispatch a real action; open identity-less reads; reload across tiers; final discard with mounted native view; same-widget/new-token late detach; terminal mutation during notification consent; cancelled/stale picker and Hub-action target transitions. Existing `AppFlowNavigationTest.kt:456-498` proves a supplied revalidation callback runs, not that production callers supply meaningful authority checks.
2. Split the >2,000-line retained ViewModel and terminal screen along existing ownership/presentation boundaries once the cutover is correct; do not introduce another runtime/coordinator.

## Positive observations

- Worktree selection and both visible create payloads now preserve worktree targeting.
- Initial canonical read identity reaches native save snapshots.
- Feed visibility now suspends retained terminal input; project-picker privacy guard added.
- REST client disables redirects and guards bearer attachment (`common/core/transport/ApiClient.kt:101,444-452`). Notification PendingIntents remain explicit/immutable and public lock-screen text generic (`android/platform/notifications/AndroidNotificationSink.kt:106-129,142-158`). No new local PTY/Git or WebView runtime identified in the reviewed paths.

## Invariant conclusion and remaining verification

C1/C2 active Hub/qualified ownership incomplete; C3 duplicate selectors/capability negotiation incomplete; C4 identity, reconnect authority and disposal incomplete; C5 structured command reconciliation incomplete; C6 worktree fix present but owner-qualified presentation/uncertainty incomplete; C7 privacy and post-consent notification fences incomplete; C8 target commit/input isolation incomplete. Historical C9 execution-wave compliance was not audited. C10 live/device release gates remain incomplete.

Main should run applicable shared/Android compilation and focused regressions after fixes land; then execute isolated live-server and physical-device IME/hardware-key/TalkBack/privacy journeys. Type/test coverage percentages and lint metrics unavailable; no pass claimed.

## Unresolved evidence

No reviewer-executed runtime/device reproduction, fresh integrated build/test/lint result, isolated multi-server qualification, physical-device privacy/IME/accessibility acceptance, or measured coverage. No unresolved product-design question blocks the corrections above.
