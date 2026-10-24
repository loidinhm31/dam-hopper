# Phase 02 — Markdown and Zero-WebView HTML Rich Previews

## Context and Goals
- **Objective:** Enable rich in-app previews for Markdown (`.md`) and HTML (`.html`, `.htm`) files in the focused workspace while strictly honoring the project's **Zero-WebView invariant** and preserving single text authority.
- **Authority:** [Plan](plan.md) | [Preview Architecture Report](../reports/research-261024-1627-preview-sidebar-ux.md)
- **Target Files:**
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/HtmlPreviewView.kt`
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidHtmlSurface.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTopBar.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt`
  - Modify: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt`

---

## Detailed Implementation Tasks

### 1. Zero-WebView Invariant Adherence
- Under NO circumstance may `android.webkit.WebView` or `androidx.webkit` be imported or used. `WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication` must remain 100% green.

### 2. Snapshot Contract & Single Preview State
In `EditorModels.kt`:
- Define the immutable snapshot data structure and composition local:
  ```kotlin
  data class DocumentPreviewSnapshot(
      val documentId: DocumentId,
      val revision: Long,
      val text: String,
      val isTruncated: Boolean,
  )

  typealias DocumentSnapshotProvider = (maxChars: Int) -> DocumentPreviewSnapshot?
  val LocalDocumentSnapshotProvider = compositionLocalOf<DocumentSnapshotProvider?> { null }
  ```
- Retain `markdownPreviewMode: Boolean = false` on `EditorTab` for backward compatibility, and alias:
  ```kotlin
  val previewMode: Boolean get() = markdownPreviewMode
  ```
- In `EditorTabsState.kt`:
  - Retain `toggleMarkdownPreview(key: String)` and alias `togglePreview(key: String)`.
  - **No Second Text Authority:** Toggling preview NEVER mutates `tab.content`, dirty status, revision number, or CAS baseline. Preview renderers consume an immutable snapshot from `LocalDocumentSnapshotProvider.current?.invoke(262_144)` on the Main dispatcher. Stale asynchronous parsing jobs are discarded if the active tab's `(documentId, revision)` changes.

### 3. Toolbar Unhide in Focused Workspace
In `EditorTopBar.kt`:
- Remove the `!focusedMode` restriction so the `Preview / Source` toggle button is displayed whenever `activeTab != null && (FileTierPolicy.isMarkdownFile(activeTab.path) || FileTierPolicy.isHtmlFile(activeTab.path))`:
  ```kotlin
  if (activeTab != null && (FileTierPolicy.isMarkdownFile(activeTab.path) || FileTierPolicy.isHtmlFile(activeTab.path))) {
      Spacer(modifier = Modifier.width(6.dp))
      Button(
          onClick = onTogglePreview,
          contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
          colors = ButtonDefaults.buttonColors(
              containerColor = if (activeTab.previewMode) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
          )
      ) {
          Text(if (activeTab.previewMode) "Source" else "Preview", fontSize = 12.sp, color = DamHopperColors.TextPrimary)
      }
  }
  ```

### 4. Zero-WebView HTML Reader Preview
- In `HtmlPreviewView.kt` (`commonMain`):
  - Define `NativeHtmlSurfaceHost` typealias and `LocalNativeHtmlSurfaceHost` composition local:
    ```kotlin
    typealias NativeHtmlSurfaceHost = @Composable (htmlContent: String, isTruncated: Boolean, modifier: Modifier) -> Unit
    val LocalNativeHtmlSurfaceHost = compositionLocalOf<NativeHtmlSurfaceHost?> { null }
    ```
  - Define `HtmlPreviewView(content: String, isTruncated: Boolean, modifier: Modifier)`: invokes `LocalNativeHtmlSurfaceHost.current` if available, or renders clean monospace fallback text. If `isTruncated`, shows a banner: `"Preview truncated to 262,144 characters; view source for complete file."`
- In `AndroidHtmlSurface.kt` (`androidApp`):
  - Render HTML via Android Jetpack Compose `AnnotatedString.fromHtml(html, linkStyles, linkInteractionListener)`.
  - Set a no-op / local link interaction listener (prevent opening external browser intents without consent).
  - Wrap in a scrollable `SelectionContainer { Text(annotatedString) }` styled with `DamHopperColors.Background` and `DamHopperTypography.bodyMedium`.
  - Parse on `Dispatchers.Default` with an input cap (262,144 characters) to prevent UI thread lockup on huge HTML dumps.

### 5. Verification & Unit Tests
In `EditorTabsStateTest.kt`:
- Test that `togglePreview` toggles preview mode without altering `tab.content`, dirty flags, revision, or CAS mtime.
- Test that stale snapshot results with mismatched revisions are rejected.
- Test that truncation notice displays when `isTruncated == true`.
- Run `WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication` to ensure zero WebView regressions.

---

## Durable Tasks
```evcrate-tasks
[
  {
    "id": "implement-markdown-and-html-previews",
    "title": "Implement Markdown and zero-WebView HTML rich previews in focused workspace",
    "blocked_by": [],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/HtmlPreviewView.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidHtmlSurface.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTopBar.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorModels.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt",
      "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsStateTest.kt"
    ],
    "constraints": [
      "Strict zero-WebView invariant: zero imports of android.webkit.WebView or androidx.webkit.",
      "No second text authority: preview consumes immutable document snapshot, never mutates tab.content, revision, or CAS metadata.",
      "Single preview mode state: previewMode aliases markdownPreviewMode for full backward compatibility.",
      "Accurate code-unit limits: snapshot and HTML reader parsing both capped at 262,144 characters (UTF-16 code units) with truncation notice."
    ],
    "acceptance": [
      "Preview/Source toggle button is visible in focused workspace for Markdown and HTML files.",
      "Markdown renders parsed Compose blocks (headings, lists, code fences); HTML renders AnnotatedString.fromHtml.",
      "Toggling preview preserves document dirty state, revision number, and undo stack.",
      "Stale asynchronous parse results for superseded revisions are dropped."
    ],
    "verification": [
      "Run ./gradlew.bat :shared:jvmTest --tests dev.damhopper.nativeapp.features.editor.EditorTabsStateTest",
      "Run ./gradlew.bat :androidApp:testDebugUnitTest --tests dev.damhopper.nativeapp.WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication"
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-markdown-and-html-previews --> Implement Markdown and zero-WebView HTML rich previews in focused workspace (Completed 2026-10-24; 14/14 EditorTabsStateTest passing; testZeroWebViewsAcrossEntireApplication passing; Markdown preview verified on emulator)
