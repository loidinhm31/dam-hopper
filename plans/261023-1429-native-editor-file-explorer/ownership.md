# Exclusive writable ownership and sequential transfers

[Overview](plan.md) owns scheduling/readiness. This ledger expands repeated-file handoffs; full literal file/action lists and task contracts remain in linked phases. Main is sole integration owner; EditorCore/Explorer/AndroidEditor own phases03/04/05 only after01/02 gates. No code changes/checks executed during authoring.

## Scheduling contract
- Complete phase01 qualification and phase02 freeze before starting the three disjoint workers. Inside each worker, task dependencies remain sequential. Main waits for all three terminal results before phase06; phase07 and phase08 are sequential after06.
- A transfer is permitted only after the predecessor writer is terminal and its dependent task prerequisites accepted. Previous owner relinquishes that path. No whole-directory ownership, concurrent build/test storms, inferred permissions or cross-plan lock assumptions.
- If a public facade/path must change after freeze, stop affected workers and revise all caller tasks/dependencies/ownership first. Missing ownership escalates; no speculative edits outside allowed_files.

## Repeated-file transfer chains
| Literal project-relative path | Ordered writer task IDs |
|---|---|
| `native-app/androidApp/build.gradle.kts` | `qualify-pinned-editor-artifacts` → `author-active-app-server-journeys` |
| `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/platform/editor/EditorDocumentQualification.kt` | `qualify-retained-native-document` → `implement-android-native-document` |
| `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/WorkbenchJourneys.kt` | `bridge-shared-editor-presentation` → `author-active-app-server-journeys` |
| `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt` | `retain-native-workspace-runtime` → `mount-focused-workspace-and-guard-departures` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepository.kt` | `freeze-file-owner-and-operation-boundary` → `implement-bounded-tiered-loading` → `implement-incarnation-safe-tabs-saves` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt` | `implement-document-backed-sessions` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabSaveCoordinator.kt` | `implement-incarnation-safe-tabs-saves` → `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt` | `implement-incarnation-safe-tabs-saves` → `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileActionDialogs.kt` | `implement-focused-explorer-actions` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModalsHost.kt` | `implement-focused-explorer-actions` → `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinator.kt` | `freeze-file-owner-and-operation-boundary` → `implement-focused-explorer-actions` → `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiter.kt` | `freeze-file-owner-and-operation-boundary` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileOperationOutcome.kt` | `freeze-file-owner-and-operation-boundary` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt` | `freeze-file-owner-and-operation-boundary` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt` | `implement-shared-directory-watchers` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt` | `freeze-file-owner-and-operation-boundary` → `implement-shared-directory-watchers` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FsWriteCoordinator.kt` | `freeze-file-owner-and-operation-boundary` → `integrate-unknown-outcome-reconciliation` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt` | `retain-native-workspace-runtime` → `retain-current-terminal-panel` → `mount-focused-workspace-and-guard-departures` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` | `retain-native-workspace-runtime` → `retain-current-terminal-panel` → `mount-focused-workspace-and-guard-departures` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` | `retain-current-terminal-panel` → `mount-focused-workspace-and-guard-departures` |
| `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt` | `freeze-file-owner-and-operation-boundary` → `bridge-shared-editor-presentation` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorSaveRaceTest.kt` | `implement-incarnation-safe-tabs-saves` → `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` → `author-active-app-server-journeys` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorRepositoryTest.kt` | `freeze-file-owner-and-operation-boundary` → `implement-bounded-tiered-loading` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt` | `freeze-file-owner-and-operation-boundary` → `implement-incarnation-safe-tabs-saves` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinatorTest.kt` | `freeze-file-owner-and-operation-boundary` → `implement-bounded-tiered-loading` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileEditorMutationTest.kt` | `integrate-subtree-mutation-transactions` → `integrate-unknown-outcome-reconciliation` → `author-active-app-server-journeys` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileMutationCoordinatorTest.kt` | `implement-focused-explorer-actions` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileOperationArbiterTest.kt` | `freeze-file-owner-and-operation-boundary` → `integrate-subtree-mutation-transactions` |
| `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/files/FileTreeStateTest.kt` | `freeze-file-owner-and-operation-boundary` → `implement-shared-directory-watchers` |
| `plans/261023-1429-native-editor-file-explorer/runtime-qualification.md` | `qualify-integrated-runtime` → `document-qualified-scope-and-distribution` |

Every adjacent pair above has a transitive blocked_by edge in phase task JSON. This is a design assertion to be independently checked by parent read-only source loader/ownership validator, not runtime qualification.

## Exclusive single-writer files
All other literal files are exclusive to their one task in the phase lists. In particular `core/transport/WsConnection.kt`, new `SocketBoundMessage.kt` and `core/transport/WsConnectionTest.kt` under the full source/test prefixes are exclusive to phase02 `freeze-file-owner-and-operation-boundary`; no later/concurrent writer owns them. `features/editor/EditorSessionPorts.kt` is exclusive to phase02 `freeze-document-and-watch-facades`; phases03/04/05 implement or consume it read-only. `native-app/scripts/run-editor-explorer-journeys.sh` is exclusive to phase08 `author-active-app-server-journeys`; existing `run-device-journeys.sh` is untouched. Transport scope is socket origin/expected-socket dispatch only, no exported-signature rewrite, new runtime/schema or filesystem API. Proposed new Kotlin files use PascalCase. Read-only frozen contracts can be consumed by any worker; consumption does not grant writes. No server, web/Tauri source, unrelated plan or parent-collected evidence report appears in allowed_files.

## Cross-plan arbitration
- `plans/261015-1647-android-native-app/plan.md`: open editor/files/host/Gradle/docs domains overlap; one coordinator must serialize any resumed writers with this plan. No completion status imported, no tasks hydrated/merged, and broader preview/TS/semantic requirements preserved.
- `plans/261018-1643-android-core-flow-refactor/plan.md`: informational active-root baseline; active resumed host/navigation writers would conflict and must wait.
- `plans/261023-1058-native-terminal-font-resize/plan.md` and `plans/261023-0747-android-icon-font-reuse/plan.md`: preserve current font/icon/terminal behavior; any resumed UI/font writer serialized with05/07. Existing ANR/replay constraints are not rewritten.

## Readiness and authority
Phase01 native document/language/version evidence unresolved; phase02 concrete facade not yet implemented/frozen. Parent independent planning review and final structural validation pending. Plan is not implementation approval. No session activation claimed; explicit canonical selected path required.
