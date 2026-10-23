# Phase 01 — Dependency and Artifact Qualification (`qualify-pinned-editor-artifacts`)

## 1. Qualified Pinned Coordinates & Checksums

| Coordinate | Packaging | Resolved Version | License | Artifact SHA-256 | Role |
|---|---|---|---|---|---|
| `io.github.Rosemoe.sora-editor:editor:0.23.4` | AAR | `0.23.4` | LGPL-2.1 | `ab676f8c3f19b6e3351bed4706c9095d59191dfc2d720f7f90f96bb9e4a43392` | Core Android `CodeEditor` view, `Content`, `UndoManager`, `Cursor`, `EditorSearcher`, `EmptyLanguage` |
| `io.github.Rosemoe.sora-editor:language-java:0.23.4` | AAR | `0.23.4` | LGPL-2.1 | `ce092684e47ded1ac610aef753612f6bbdb7aaac3e970a4e6b5c764b84415dd3` | Incremental lexer/tokenizer syntax grammar (`JavaLanguage`) with zero external asset bundle or JNI `.so` dependencies |
| `androidx.test:core:1.6.1` | AAR | `1.6.1` | Apache-2.0 | Maven Google | `androidTestImplementation` host for `ActivityScenario` lifecycle recreation |
| `androidx.compose.ui:ui-test-junit4:1.7.3` | AAR | `1.7.6` (atomic group constraint from `org.jetbrains.compose:1.7.3`) | Apache-2.0 | Maven Google | `androidTestImplementation` Compose test synchronization host |
| `androidx.compose.ui:ui-test-manifest:1.7.3` | AAR | `1.7.6` (atomic group constraint from `org.jetbrains.compose:1.7.3`) | Apache-2.0 | Maven Google | `debugImplementation` manifest provider for `androidx.activity.ComponentActivity` |

- **Group ID casing**: Maven Central requires exact case-sensitive group `io.github.Rosemoe.sora-editor` (capital `R`). Lowercase `io.github.rosemoe.sora-editor` does not exist on Maven Central for `0.23.4`.
- **Published 0.23.4 BOM inventory (`io.github.Rosemoe.sora-editor:bom:0.23.4`)**:
  - `editor:0.23.4` — selected core widget/document module.
  - `language-java:0.23.4` — selected verified syntax module (`io.github.rosemoe.sora.langs.java.JavaLanguage`, `JavaIncrementalAnalyzeManager`, `JavaTextTokenizer`).
  - `language-textmate:0.23.4` — not selected for minimum qualification (pulls runtime transitive dependencies `gson:2.10.1`, `jcodings:1.0.58`, `joni:2.2.1`, `snakeyaml-engine:2.7`, `org.eclipse.jdt.annotation:2.2.800` and requires external TextMate grammar/theme bundle assets with separate asset licensing).
  - `language-treesitter:0.23.4` — not selected (requires per-language native JNI TreeSitter grammar `.so` artifacts).
  - `editor-lsp:0.23.4` — excluded by plan scope (no LSP/semantic services).

## 2. Verified Tag `0.23.4` Source Symbols

Inspected directly against upstream tag `0.23.4` (`editor-0.23.4-sources.jar` / `language-java-0.23.4-sources.jar`):

- **Document & Undo Authority (`io.github.rosemoe.sora.text`)**:
  - `Content(CharSequence src, boolean threadSafe)` — line-indexed mutable text buffer (`List<ContentLine>`), `getDocumentVersion()`, `length()`, `getLineCount()`, `getColumnCount(int)`, `getLineString(int)`, `insert(int, int, CharSequence)`, `delete(int, int, int, int)`, `delete(int, int)`, `replace(int, int, int, int, CharSequence)`, `beginBatchEdit()`, `endBatchEdit()`, `isInBatchEdit()`, `resetBatchEdit()`, `runReadActionsOnLines(int, int, ContentLineConsumer2)`, `addContentListener(ContentListener)`, `removeContentListener(ContentListener)`, `getCursor()`, `getUndoManager()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `isUndoManagerWorking()`, `setUndoEnabled(boolean)`, `isUndoEnabled()`, `setMaxUndoStackSize(int)`, `getMaxUndoStackSize()`.
  - `UndoManager` — `canUndo()`, `canRedo()`, `undo(Content)`, `redo(Content)`, `isModifyingContent()`, `setMaxUndoStackSize(int)`, `getMaxUndoStackSize()`, `setUndoEnabled(boolean)`, `isUndoEnabled()`, `UndoManager.getMergeTimeLimit()`, `UndoManager.setMergeTimeLimit(long)`.
  - `Cursor` — `getLeft()`, `getRight()`, `getLeftLine()`, `getLeftColumn()`, `getRightLine()`, `getRightColumn()`, `isSelected()`, `set(int, int)`, `setLeft(int, int)`, `setRight(int, int)`, `getIndexer()`.
  - `CharPosition` (`line`, `column`, `index`), `TextRange` (`getStart()`, `getEnd()`).
- **Widget & Events (`io.github.rosemoe.sora.widget`, `io.github.rosemoe.sora.event`)**:
  - `CodeEditor(Context)` — `setText(CharSequence, boolean reuseContentObject, Bundle extraArguments)`, `getText()`, `setEditorLanguage(Language)`, `getEditorLanguage()`, `setEditable(boolean)`, `isEditable()`, `getEditable()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `setUndoEnabled(boolean)`, `isUndoEnabled()`, `setSelection(int, int)`, `setSelectionRegion(int, int, int, int)`, `ensurePositionVisible(int, int, boolean)`, `getOffsetX()`, `getOffsetY()`, `getScroller()`, `getEventHandler()`, `getSearcher()`, `setLineNumberEnabled(boolean)`, `isLineNumberEnabled()`, `setWordwrap(boolean)`, `isWordwrap()`, `setBasicDisplayMode(boolean)`, `isBasicDisplayMode()`, `setHighlightBracketPair(boolean)`, `hasComposingText()`, `onCreateInputConnection(EditorInfo)`, `hideSoftInput()`, `release()`, `isReleased()`, `getStyles()`, `subscribeEvent(Class<T>, EventReceiver<T>)`.
  - `EditorSearcher` — `search(String, SearchOptions)`, `gotoNext()`, `gotoPrevious()`, `replaceThis(String)`, `stopSearch()`, `hasQuery()`, `getMatchedPositionCount()`, `getCurrentMatchedPositionIndex()`.
  - `ContentChangeEvent` — `ACTION_SET_NEW_TEXT` (`1`), `ACTION_INSERT` (`2`), `ACTION_DELETE` (`3`), `getChangeStart()`, `getChangeEnd()`, `getChangedText()`, `isCausedByUndoManager()`.
  - `SelectionChangeEvent`, `ScrollEvent`, `PublishSearchResultEvent`, `SubscriptionReceipt`.
- **Syntax & Plain-Text Languages (`io.github.rosemoe.sora.lang`, `io.github.rosemoe.sora.langs.java`)**:
  - `io.github.rosemoe.sora.langs.java.JavaLanguage` — incremental tokenizer/analyzer (`JavaIncrementalAnalyzeManager`) producing syntax highlight spans and identifier auto-completion without semantic/LSP claims.
  - `io.github.rosemoe.sora.lang.EmptyLanguage` — built-in zero-overhead plain-text language (`EmptyAnalyzeManager.INSTANCE`, `EmptyFormatter.INSTANCE`, `EMPTY_SYMBOL_PAIRS`) for unsupported file extensions or degraded tiers.

## 3. Toolchain, Java 17, `minSdk 29`, and ABI Compatibility

- **Upstream build baseline (`Versions.kt` at tag `0.23.4`)**:
  - `minSdkVersion = 21` for `editor` and `language-java` (well below project `minSdk = 29`).
  - `compileSdkVersion = 34`, `targetSdkVersion = 34`.
  - `sourceCompatibility = JavaVersion.VERSION_17`, `targetCompatibility = JavaVersion.VERSION_17`, `jvmToolchain(17)`.
- **Project baseline (`native-app/androidApp/build.gradle.kts`)**:
  - `compileSdk = 35`, `minSdk = 29`, `targetSdk = 35`, `JavaVersion.VERSION_17`, `jvmTarget = "17"`.
  - `abiFilters = ["arm64-v8a", "x86_64"]` unchanged.
  - Core library desugaring is not required: all `java.util.*` / `java.nio.*` APIs used by `editor:0.23.4` and `language-java:0.23.4` are natively present in Android API 29 (`minSdk 29`).
  - Both AARs contain pure JVM/DEX bytecode and Android resources with zero native `.so` libraries, so both `arm64-v8a` and `x86_64` APK targets package cleanly.

## 4. Transitive Dependency Resolution Evidence

### Command 1: Runtime Classpath Insight
`.\native-app\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugRuntimeClasspath --dependency io.github.Rosemoe.sora-editor`

- `io.github.Rosemoe.sora-editor:editor:0.23.4` (variant `releaseVariantReleaseRuntimePublication`, AAR):
  - `androidx.annotation:annotation:1.7.1 -> 1.8.1`
  - `androidx.collection:collection:1.4.0 -> 1.4.2`
  - `org.jetbrains.kotlin:kotlin-stdlib:1.9.22 -> 2.1.10`
- `io.github.Rosemoe.sora-editor:language-java:0.23.4` (variant `releaseVariantReleaseRuntimePublication`, AAR):
  - `androidx.annotation:annotation:1.7.1 -> 1.8.1`

### Command 2: Instrumentation Classpath Insight
`.\native-app\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugAndroidTestRuntimeClasspath --dependency ui-test`

- `androidx.compose.ui:ui-test-junit4:1.7.3 -> 1.7.6` (aligned by Gradle atomic group constraint with `androidx.compose.ui:ui-android:1.7.6` from `org.jetbrains.compose:1.7.3`)
- `androidx.compose.ui:ui-test-manifest:1.7.3 -> 1.7.6` (`debugRuntimeClasspath` provides `androidx.activity.ComponentActivity` manifest entry)
- `androidx.test:core:1.6.1` (`ActivityScenario` host)

### Command 3: Debug Assembly
`.\native-app\gradlew.bat -p native-app :androidApp:assembleDebug` — `BUILD SUCCESSFUL`.

## 5. Risks, Licensing, and Release Blockers

1. **Prerelease status**: Upstream GitHub release `0.23.4` is tagged as a prerelease (`versionCode = 85`). The pin `0.23.4` is preserved per contract without silent upgrade.
2. **LGPL-2.1 distribution compliance gate (Phase 08 blocker)**:
   - `editor:0.23.4` and `language-java:0.23.4` are licensed under `LGPL-2.1-or-later`.
   - Standard Android AAR consumption statically merges library classes into the application DEX image during `assembleDebug`/`assembleRelease`. AAR packaging alone does **not** constitute dynamic linking or user relinkability.
   - Before any binary distribution release (Phase 08), the project must ship LGPL-2.1 notices, full license text, exact source/tag provenance, and a demonstrated relinking/object-replacement mechanism.
3. **Grammar scope**:
   - `language-java:0.23.4` + `EmptyLanguage` qualify the Phase 01 gate (one real syntax grammar + honest plain-text fallback). Any broader multi-language syntax support via `language-textmate:0.23.4` or `language-treesitter:0.23.4` would require separate dependency, asset-licensing, or ABI qualification.
