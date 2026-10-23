# Editor/widget evidence

Status: terminal scout `EditorWidgetContracts` completed read-only investigation; parent collected full response. No files changed by scout; no build/test/resolution/device proof. Five external calls total (tag README, release, failed Maven search HTTP400, POM, official-guide web search). Source paths below use repository root prefix `native-app/`.

## Current contracts and gaps
- `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt:10–125`: shared text, baseline/mtime/dirty/model/edit epochs, submitted save snapshot, selection and 50-snapshot `EditorUndoManager`. Existing successful submitted-save handling preserves later edits as dirty; retain that invariant, not its competing authority implementation.
- `features/editor/EditorTabsState.kt:50–110,116–189,195–205`: tab incarnation allocated but async open/range/reload completions generally publish by key. Close/reopen same path can accept old results. Error/listener cleanup also needs captured incarnation/session identity.
- `features/editor/EditorTabSaveCoordinator.kt:14–140`: save snapshots submitted text and reports conflicts/errors/unknown; completion maps by key, allowing old session completion to change replacement tab flags.
- `features/editor/EditorRepository.kt:13–122`: stat→tier→read, conditional mtime save, fresh-stat explicit overwrite; encryptedRequested without valid crypto session fails closed. Timeout maps to unknown even before commit; phase-aware submission classification needed.
- `features/editor/EditorContentLoader.kt:10–75`, `FileTierPolicy.kt:9–150`, `LargeFileView.kt:20–90`: normal <1MiB, degraded 1–<5MiB editable, >=5MiB 64KiB range read-only, binary/media precede size. UTF8 tail trimmed but view advances fixed 65536, losing boundary bytes. Binary path can whole-read/Base64/hex a large file. Bound received bytes despite stat/read race, strict decoding, and range offset from consumed bytes are necessary.
- `features/files/FileRepository.kt:36–127`: default decodeToString is lossy; any WS failure except cancellation can fall back to REST text; binary fallback lacks content. Do not publish malformed text as editable or widen a bounded read on fallback.
- `features/editor/NativeTextEditorView.kt:18–80`, `EditorScreens.kt:17–205`: actual visible TextField performs full-value edits and eager line gutter; toolbar routes shared undo.
- `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt:8–13,55–162,229–270`: model-only prototype with StringBuilder + separate snapshot stacks; attachView only toggles flag. No mounted Sora instance. Claimed AAR dynamic linkage/relinking is not proof.
- `features/editor/EditorModels.kt:124–139`: metadata-only persisted state. Dormant WorkbenchScreen remember state closes tabs on connection reconstruction; do not mount it for this increment or infer rotation retention.

## Pinned upstream evidence
- [Tagged README](https://github.com/Rosemoe/sora-editor/blob/0.23.4/README.md): syntax, undo, TextMate/TreeSitter advertised; LGPL-2.1-or-later.
- [Release](https://github.com/Rosemoe/sora-editor/releases/tag/0.23.4): prerelease, preserve pin unless separately approved.
- [Maven POM](https://repo.maven.apache.org/maven2/io/github/Rosemoe/sora-editor/editor/0.23.4/editor-0.23.4.pom): exact `io.github.Rosemoe.sora-editor:editor:0.23.4`, AAR, Kotlin stdlib1.9.22 and LGPL metadata. Existing lowercase group claim differs; exact casing matters. Actual resolution unexecuted.
- **Unresolved essential qualification:** version-pinned Content/undo reattachment APIs, language-module coordinates/signatures, exact minSdk/Java build requirements. Current guide is not evidence for older pin. Existing project Java17/minSdk29 preserved. No silent language module assumption, upgrade, TextField fallback or semantic language-service claim.
- Retained document must own interactive text/undo and expose shared metadata/save snapshots/incremental callbacks. Widget must release Activity context/listeners on destruction; Content+undo/selection/scroll retention must be executable-proven before dependent implementation. LGPL notices/source/relinking mechanism and asset licensing remain release gates.

## Existing checks to adapt later
Paths are under `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/`: `EditorSessionTest.kt:11–135`, `EditorTabsStateTest.kt:50–198`, `EditorRepositoryTest.kt:20–115`, `FileTierPolicyTest.kt:10–69`. Prototype Android test: `androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt:9–145`; replace model-only assertions with behavior where applicable, no wording/static-source tests. Existing tests do not prove close/reopen callback isolation or mounted widget IME/rotation.

Future commands from repository root, not executed:
- `.\native-app\gradlew.bat -p native-app :shared:jvmTest --tests "dev.damhopper.nativeapp.features.editor.EditorTabsStateTest" --tests "dev.damhopper.nativeapp.features.editor.EditorSessionTest" --tests "dev.damhopper.nativeapp.features.editor.EditorRepositoryTest" --tests "dev.damhopper.nativeapp.features.editor.FileTierPolicyTest"`
- `.\native-app\gradlew.bat -p native-app :androidApp:testDebugUnitTest --tests "dev.damhopper.nativeapp.platform.editor.AndroidEditorSurfaceTest"`
- `.\native-app\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugRuntimeClasspath --dependency editor`

## Unresolved questions
No product choice; hard feasibility evidence gates above block unconditional downstream readiness. Build/device/license results must not be invented from planning or Maven metadata.
