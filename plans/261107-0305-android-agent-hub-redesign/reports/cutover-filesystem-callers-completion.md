# Completion Report: cutover-filesystem-callers (P02 / W02)

## Summary
Migrated explicit filesystem targets (`FilesystemTargetRef` and `ServerFsTarget`) across WebSocket `ClientMsg` envelopes, REST query mappers, and media ticket issuance without flat+nested duplication. Added bounded response metadata support in `ApiClient` to decode REST text `x-file-identity` header directly from the read response and binary JSON `file_identity`, eliminating the stat/read race. Updated `WorkspaceRepository` with guarded `markProject` and `unmarkProject`. Succeeded canonical document sharing and alias lease lifetime plumbing in `EditorTabsState`, `EditorSession`, and `AndroidEditorDocument`.

## Modified Key Files
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ClientMsg.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/TestEditorDocument.kt`
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceRepository.kt`
- `native/android-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/transport/WireSerializationTest.kt`

## Verification Evidence
1. Shared JVM Compilation:
   - Command: `cmd.exe /c gradlew.bat :shared:compileKotlinJvm`
   - Exit Code: 0 (BUILD SUCCESSFUL)
2. Android Debug Compilation:
   - Command: `cmd.exe /c gradlew.bat :androidApp:compileDebugKotlin`
   - Exit Code: 0 (BUILD SUCCESSFUL)
3. Regressions Suite:
   - Command: `cmd.exe /c gradlew.bat :shared:jvmTest --tests "dev.damhopper.nativeapp.core.transport.WireSerializationTest" --tests "dev.damhopper.nativeapp.features.files.FileRepositoryTest" --tests "dev.damhopper.nativeapp.features.editor.EditorTabsStateTest" --tests "dev.damhopper.nativeapp.features.editor.EditorSessionTest"`
   - Exit Code: 0 (BUILD SUCCESSFUL)
   - Results: 38 tests executed, 38 passed, 0 failed.
   - Verified:
     - `ClientMsg.FsSubscribeTree`, `FsRead`, `FsWriteBegin`, `FsOp`, `FsUploadBegin`, `FsPutBegin` serialize `target` without duplicate flat fields.
     - `ApiClient.getBytesBoundedWithHeaders` receives `x-file-identity` header from `/api/fs/read`.
     - `FileRepository.readFile` parses identity without pre-stat race.
     - `EditorTabsState` shares canonical documents across aliases and respects `canDispose` before destruction.
     - Tier replacement rotates incarnation and updates active document ID.
