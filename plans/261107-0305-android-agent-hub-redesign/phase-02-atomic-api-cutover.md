# P02 — Atomically migrate current Android contracts and callers

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/api-compatibility-evidence.md](reports/api-compatibility-evidence.md) | [reports/local-api-smoke.md](reports/local-api-smoke.md) | [reports/design-dispositions.md](reports/design-dispositions.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 28h.
- Owner: Api02 (single sequential writer). Parallelization group: `S-2`.
- Prerequisite task IDs: `freeze-native-contracts`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
REST missing-target request fails INVALID_FS_TARGET on real API. Rust accepts some legacy project selectors but Android must always emit current explicit targets. Corrected WS read verified data bytes/file_identity, not a clean close. Existing active ProjectTerminalScreen and dormant Workbench both invoke unsafe remove/kill; removing repository methods requires migrating both. ProjectPlansRepository has a separate REST read fallback. ApiClient currently discards metadata needed to bind read identity/create epoch.

## Requirements
Functional: perform each producer/signature/serializer/caller migration as one coherent authoring unit, including tests and dormant compiled callers; no API-only intermediate handoff. Apply explicit targets to list/stat/read/language scan/search/watch/plain writes/op/plain upload/OPAQUE put and image/video tickets. Add workspace root/project listing and mark/unmark API use with admission guards. Canonical baseline comes from actual read response, not separately raced stat. Termination uses guarded POST only; uncertain create is retained across lifecycle/process death and never retried as recovery. Settings sparse patches preserve raw unknowns/nulls and sole selected config.
Nonfunctional: no Rust/web edits, legacy fallback, dual target selectors, terminal WS epoch extension, new background service or provider runtime. Keep read bounds, atomic WS header/binary sends, CAS and request-local owner fences. P02 ends with all current callers on new contracts, before presentations consume them.

## Architecture and ports
Three ordered atomic cutovers share Api02 ownership. Filesystem cutover updates transport plus every affected file/editor/search/watch/media/root/test caller together. Existing project-only operations may retain ProjectTargetRef as their true domain, but actual filesystem envelopes emit FilesystemTargetRef.Project explicitly; new workspace APIs use Workspace. No deprecated overloads. Metadata-bearing bounded HTTP response is added to existing ApiClient with unchanged request admission/credential policy; read header identity and create/inventory headers survive intact. Remove permissive guessed identity aliases where source exact casing differs.
Terminal cutover updates repository/state/UI callers in the same task; absence of protocol disables End but not local hide. Preserve raw ID WS operations, validate owner/socket/replay/required local instance at dispatch. Unknown launch identity is stored through existing PreferencesStore/AndroidPreferencesStore storage hooks, then hosted by existing retained terminal/workspace state; no separate launch service. Settings cutover uses raw JSON merge plus per-field explicit-null patch construction, not whole default DTO serialization. Shared sequential paths transfer Api02 -> owning G-A slice -> Integration07; root/ports remain closed to G-A.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- None.

### Modify (existing files, including P01-created files after completed handoff)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/FilesystemTargetRef.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalLifetimeContractTest.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ClientMsg.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ProjectTargetRef.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchContracts.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeHelpers.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FederatedSearchCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchReplaceView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTransferPlatformHost.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileItemActionsModal.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MediaPreviewCard.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameCache.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaSurfaceHost.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceContracts.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkspaceSearchView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaSurfaceHost.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidImageSurface.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/SearchAndReplaceTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepositoryAndParsingTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStoreTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/RetainedGitTransportTest.kt`
- `native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/transport/WireSerializationTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClientTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeFileServerFixture.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPorts.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembership.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjection.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinator.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepositoryIntegrationTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModelsTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionControllerTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembershipTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjectionTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinatorTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsIntegrationTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinatorTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidTerminalAgentsFilterStoreTest.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsPorts.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistry.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesPrivacyView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/GlobalSettingsView.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepositoryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModelsTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistryTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/PreferenceConsumersTest.kt`
- `native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### cutover-filesystem-callers
1. Replace target wire fields in ClientMsg and media ticket DTOs with the settled union; map REST targetType/project/worktreePath once per existing port. Keep kind, req_id and each existing field casing; no flat+nested duplication.
2. Add bounded response metadata support in ApiClient. Decode REST stat fileIdentity, REST text x-file-identity from the same content response, REST binary file_identity and WS file_identity + base64 data; nested workspaceId/workspaceEpoch/canonicalPath remain camelCase. Reject missing/inconsistent identity for editable baseline; no stat/read race fallback.
3. Migrate FileRepository, all write/op/search/federation/replace/tree/watch/transfer/encrypted-save callers, media hosts/clients, ProjectPlansRepository direct REST and compiled root/dormant callers. Preserve leading slash, drive and punctuation of worktree paths; never turn an absolute worktree into a relative target.
4. Update WorkspaceRepository for explicit configured root and guarded POST /api/config/projects mark plus DELETE /api/config/projects/{name} unmark. Keep project picker selection separate from destructive root switching. Recognize unconfigured root/unknown project/unsupported target without discovery fallback.
5. Migrate the P01 lifetime ports and every EditorSession/EditorTabsState/ProjectWorkspaceState/factory/AndroidEditorDocument/AndroidEditorSurface caller atomically with baseline structures: existing retained owner alone disposes; aliases release their leases/listeners/exact widget, never shared native authority. Preserve single-active-view exact widget+lease attachment; late old detach only cleans old resources. No old session-owned native close or alias-local reload/tier replacement path remains. Use current owner/factory component before P07 cross-workspace wiring; no new registry.
6. Propagate same-read identity through EditorLoadResult -> baseline/document factory -> immutable save snapshot; update existing EditorDocument/TestEditorDocument contracts atomically with all affected caller constructors. Do not rebuild baseline identity from a later stat.
7. Implement canonical guarded close/reload/discard/tier transaction plumbing against captured revision/owner: busy during in-flight save/snapshot, explicit dirty consent + post-consent revalidation, all-alias atomic successor/incarnation update, failure retains original. Final dirty alias save/discard/cancel remains reachable; only owner retires/disposes once when all lease/dirty/save guards reach zero. Author session/workspace-close, save-race and native late-detach regressions in already-owned tests; P06 exercises shared-factory aliases, P07 wires retained-root scope.

### cutover-terminal-lifetime
1. Preserve create response original PTY epoch/header and numeric u64 exactly (ULong or lossless decimal parsing, never Double); bind only to fresh matching inventory incarnationExact. Keep PTY UUID/agent epoch/workspace epoch domain types distinct.
2. Remove killSession/removeSession and all active/dormant/test callsites. End/Cancel Restart sends exactly version=1, expectedServerEpoch canonical lowercase UUID and expectedIncarnation positive u64 decimal string via POST /api/terminal/{id}/terminate, body <=512 bytes. No DELETE fallback.
3. Model 202 acknowledgement, 200 restartCancelled, refusal/409, transport-unknown and observed exit separately. Do not clear/retarget a terminal row from an acknowledgement. Keep local hide/reopen separate from remote lifetime and inventory counts.
4. Persist unresolved create admission identity/outcome before dispatch with request-local receipts in existing storage/state; UUID per explicit intent. Never retry on timeout/cancellation/rotation/background/reconnect. Process restore blocks replacement; absent list/retired client/TTL is not proof the original cannot still commit.
5. Update current screen and dormant compiled terminal actions to the guarded API without activating new navigation. Author dropped-create/dropped-terminate, >2^53/max-u64, original-epoch mismatch and process-restored-unknown fixtures; remove obsolete unsafe assertions.
6. Use the existing ApiClient metadata-bearing POST path for original create epoch and list headers; preserve status/body/request-admission metadata without changing generic callers or bearer/redirect policy.

### cutover-settings-patches
1. Switch source preference hydration/editing to null-aware fields; construct sparse {ui:{changedField:...}} patches using explicit JsonNull for unbound known scalar/extra shortcut bindings. Omitted means unchanged, null means unbound; do not emit TOML empty string as JSON null.
2. Preserve remote web-only/unknown UI fields untouched; raw full-config/import merge retains unrelated sections. Remove active defaults.workspace/discovery/fallback assumptions; workspace.root is explicit sole authority.
3. Migrate all nullable preference consumers/storage/shortcut rendering in the same task; unsupported notification policy stays read-only/off without overwriting raw bytes. Keep device preferences, source A, admin B and active Hub C independent.
4. Author fixtures for omitted/null/empty values, extra bindings, unknown OS placement keys, interrupted hydration, removed source, and root-edit destructive impact handoff. No blanket no-auth read-only policy.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "cutover-filesystem-callers",
    "title": "Migrate explicit filesystem targets and canonical identity atomically",
    "blocked_by": [
      "freeze-native-contracts"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ClientMsg.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ServerMsg.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/FilesystemTargetRef.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ProjectTargetRef.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchContracts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeHelpers.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/ReplaceModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FederatedSearchCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/SearchReplaceView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTransferPlatformHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileItemActionsModal.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinator.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/MediaPreviewCard.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/BlameCache.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaSurfaceHost.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceContracts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitWorkspaceRuntime.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/GitOperationScope.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkspaceSearchView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaSurfaceHost.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidImageSurface.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/SearchAndReplaceTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workflow/ProjectPlansRepositoryAndParsingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectTargetStoreTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/RetainedGitTransportTest.kt",
      "native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/transport/WireSerializationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClientTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModelTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/GitWorkspaceRuntimeBindingTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeFileServerFixture.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt",
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocumentTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Every existing filesystem/media/encrypted/plan-read caller emits a current explicit target; no compatibility serializer remains.",
      "Text baseline bytes and canonical identity come from one authorized response; no missing identity produces editable authority.",
      "Root/absolute worktree targets and wire bytes retain meaning; migrated current components obey canonical owner/alias/view leases, final dirty close, busy save/reload and all-alias replacement without downstream root dependence."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Use current provider/editor component entry with an owned disposable filesystem fixture: capture actual REST/WS target and same-read identity/bytes; open two lease aliases, close one, keep the other editable with undo. Include close/reload during an in-flight save and late old-widget detach on the native component host. No future Hub root required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/cutover-filesystem-callers-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "cutover-terminal-lifetime",
    "title": "Replace all unsafe terminal lifecycle callers atomically",
    "blocked_by": [
      "cutover-filesystem-callers"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionController.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembership.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjection.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/git/WorkspaceGitSafety.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinator.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepositoryIntegrationTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModelsTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalLifetimeContractTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalSessionControllerTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembershipTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjectionTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/GitWorkspaceSafetyTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinatorTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/RetainedTerminalAgentsIntegrationTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsActivationCoordinatorTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidTerminalAgentsFilterStoreTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "No Android kill/remove DELETE caller or obsolete repository API survives.",
      "Local Close sends zero server mutation; End targets exact original PTY epoch/incarnation and never retries/retargets.",
      "Current provider/storage re-instantiation restores minimal ambiguous-create identity and blocks replacement absent exact success/noncreation proof; full Activity/process recreation remains P07/P08 acceptance."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Through the current terminal provider/screen on an owned PTY, observe actual create header/u64, stream bytes, local-close zero mutation and exact guarded End body; drop a create response and reinstantiate existing storage/provider to demonstrate blocked replacement. No future Hub lifecycle wiring required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/cutover-terminal-lifetime-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  },
  {
    "id": "cutover-settings-patches",
    "title": "Migrate null-aware Settings and single-config callers atomically",
    "blocked_by": [
      "cutover-terminal-lifetime"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigRepository.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistry.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesPrivacyView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/GlobalSettingsView.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigScreen.kt",
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsRepositoryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModelsTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditorTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/HardwareShortcutRegistryTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/settings/PreferenceConsumersTest.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SettingsPreferencesPhase17Test.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "Editing one supported preference leaves all unedited/unknown/null UI values unchanged.",
      "Only selected config/root authority is used; import preserves unrelated fields and existing mutation admission.",
      "Applicable current shared/app compilation actually passes against settled nullable contracts before G-A admission; source-only conceptual compilation is not evidence."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Through the current Settings provider/screen, edit one supported value then explicitly unbind; capture sparse value/JsonNull requests and compare raw unrelated fields before/after against owned config. No future retained Hub overlay required.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/cutover-settings-patches-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:cutover-filesystem-callers --> Migrate explicit filesystem targets and canonical identity atomically
- [ ] <!-- evcrate-task:cutover-terminal-lifetime --> Replace all unsafe terminal lifecycle callers atomically
- [ ] <!-- evcrate-task:cutover-settings-patches --> Migrate null-aware Settings and single-config callers atomically

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: API signatures widen across dormant/test code; all declared callers migrate in their atomic task, not later integration fixes. If another source caller is discovered, pause this cutover and extend the literal allowlist before editing; never use a shim. Privacy: never log raw config/token/media ticket/create command. Failure: unavailable/malformed/403/409 remains explicit, mutations are not replayed. Rollback: reverse Settings, terminal, then FS as coherent client changes; retain persisted unknown-create records and dirty content; never roll server APIs or remote PTYs back.

## Downstream barrier
Each atomic P02 task stops alone at W02/W03/W04 and receives coordinator applicable compile, focused behavioral regressions, separate current-provider smoke and passing independent review before evidence-backed completion/admission of the next task. G-A W05 begins only after all three completed cutovers and settled producer/caller/lease handoff; no terminal-only or defer-to-P08 completion.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
