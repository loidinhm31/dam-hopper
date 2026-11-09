# Completion Report: freeze-native-contracts (P01 / W01)

## Summary
Additive native models, schemas, and port contracts frozen cleanly across core/model, files, terminal, settings, workspace, and editor packages. All downstream providers and feature presenters can bind against these settled contracts.

## Created Files
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/FilesystemTargetRef.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubPorts.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubContractsTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalLifetimeContractTest.kt`

## Modified Files
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt`

## Verification Evidence
1. Shared JVM Compilation:
   - Command: `cmd.exe /c gradlew.bat :shared:compileKotlinJvm`
   - Exit Code: 0 (BUILD SUCCESSFUL)
2. Contract Test Suite:
   - Command: `cmd.exe /c gradlew.bat :shared:jvmTest --tests "dev.damhopper.nativeapp.features.workspace.AgentHubContractsTest" --tests "dev.damhopper.nativeapp.features.terminal.TerminalLifetimeContractTest"`
   - Exit Code: 0 (BUILD SUCCESSFUL)
   - Results: 12 tests executed, 12 passed, 0 failed.
   - Verified:
     - `FilesystemTargetRef` query params and nested WebSocket `ServerFsTarget` serialization.
     - `CanonicalDocumentKey` tuple deterministic formatting.
     - `SparseUiConfigPatch` JSON null preservation for unbound fields vs omitted fields.
     - Mixed identity casing (`fileIdentity` and `file_identity`) in `FileStatDto`.
     - `AgentHubSnapshot` and `AgentHubAction` variants (local hide vs remote guarded terminate).
     - Document lease lifecycle, alias survival, and view lease retention guards.
     - `EditorLoadResult` and `DocumentSaveSnapshot` identity bearing fields.
     - `TerminateSessionRequest` wire size <= 512 bytes with u64 incarnation decimal string and lowercase UUID.
     - `UncertainCreateRecord` serialization without leaking credentials or command text.
     - `TerminalTerminationOutcome` 202/200/409 semantics.
