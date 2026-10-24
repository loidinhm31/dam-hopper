# Phase 04 — Editor Left Sidebar File Tree and View Integration

## Context and Goals
- **Objective:** Provide a collapsible File Tree sidebar on the left side of the Editor view, enabling users to browse and switch files like in an IDE without losing editor view state or unmounting the native `CodeEditor`, while wiring media and HTML surfaces.
- **Authority:** [Plan](plan.md) | [Sidebar Architecture Report](../reports/research-261024-1627-preview-sidebar-ux.md)
- **Target Files:**
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorPanelScreen.kt`
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
  - Modify: `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt`

---

## Detailed Implementation Tasks

### 1. State Management & Back Interception in AppFlowNavigation
In `AppFlowNavigation.kt`:
- Add an owned registration/disposal mechanism for back interceptors:
  ```kotlin
  private val backInterceptors = mutableListOf<() -> Boolean>()
  fun registerBackInterceptor(interceptor: () -> Boolean): () -> Unit {
      backInterceptors.add(interceptor)
      return { backInterceptors.remove(interceptor) }
  }
  fun handleBackPress(): Boolean {
      for (i in backInterceptors.indices.reversed()) {
          if (backInterceptors[i].invoke()) return true
      }
      return departureGuard?.invoke(currentStage) { proceedBack() } ?: proceedBack()
  }
  ```

### 2. State Management in ProjectWorkspaceState
In `ProjectWorkspaceState.kt`:
- Add `val isEditorSidebarOpen = MutableStateFlow(false)`.
- Add `fun toggleEditorSidebar()` and `fun setEditorSidebarOpen(open: Boolean)`.

### 3. Stable Split / Slide-Over Layout in ProjectWorkspaceScreen
In `ProjectWorkspaceScreen.kt`:
- **Stable Layout (Zero CodeEditor Remount during Responsive Changes):**
  Use a single `BoxWithConstraints` when rendering `WorkspacePanel.EDITOR`. The `EditorPanelScreen` remains in a fixed, stable composition slot across sidebar open/close and orientation changes (Activity recreation restores view state via `DocumentViewState`):
  ```kotlin
  val isPinned = maxWidth >= 600.dp
  val isSidebarOpen by workspaceState.isEditorSidebarOpen.collectAsState()

  Row(modifier = Modifier.fillMaxSize()) {
      if (isPinned && isSidebarOpen) {
          Box(modifier = Modifier.width(280.dp).fillMaxHeight()) {
              FocusedFilesExplorerScreen(
                  treeState = workspaceState.fileTreeState,
                  mutationCoordinator = workspaceState.fileMutationCoordinator,
                  onOpenFile = { target, path ->
                      coroutineScope.launch {
                          workspaceState.editorTabsState.openTab(target, path)
                      }
                  },
                  modifier = Modifier.fillMaxSize()
              )
          }
          Box(modifier = Modifier.width(1.dp).fillMaxHeight().background(DamHopperColors.Border))
      }

      // EditorPanelScreen retains EXACT slot identity — NEVER remounts or detaches widget!
      EditorPanelScreen(
          tabsState = workspaceState.editorTabsState,
          nativeSurfaceHost = nativeSurfaceHost,
          modifier = Modifier.weight(1f).fillMaxHeight(),
          onToggleSidebar = { workspaceState.toggleEditorSidebar() },
          isSidebarOpen = isSidebarOpen,
          isInputAllowed = !isSidebarOpen || isPinned
      )
  }

  // Slide-over overlay on compact screens (< 600 dp)
  if (!isPinned && isSidebarOpen) {
      val sidebarFocusRequester = remember { FocusRequester() }
      LaunchedEffect(isSidebarOpen) {
          sidebarFocusRequester.requestFocus()
      }
      Box(
          modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f))
              .clickable { workspaceState.setEditorSidebarOpen(false) }
      )
      Box(
          modifier = Modifier.fillMaxHeight().width(280.dp).background(DamHopperColors.Surface)
              .clickable(enabled = false) {}
              .focusRequester(sidebarFocusRequester)
              .focusable()
              .onPreviewKeyEvent {
                  if (it.key == Key.Escape) {
                      workspaceState.setEditorSidebarOpen(false)
                      true
                  } else false
              }
      ) {
          FocusedFilesExplorerScreen(
              treeState = workspaceState.fileTreeState,
              mutationCoordinator = workspaceState.fileMutationCoordinator,
              onOpenFile = { target, path ->
                  coroutineScope.launch {
                      workspaceState.editorTabsState.openTab(target, path)
                      workspaceState.setEditorSidebarOpen(false) // auto-close on compact screens
                  }
              },
              modifier = Modifier.fillMaxSize()
          )
      }
  }
  ```

### 4. Back Interception Registration & Native Input Suppression
- In `ProjectWorkspaceScreen.kt`:
  Register back interceptor cleanly via `DisposableEffect`:
  ```kotlin
  DisposableEffect(isSidebarOpen, isPinned) {
      val unregister = if (!isPinned && isSidebarOpen) {
          navigation.registerBackInterceptor {
              workspaceState.setEditorSidebarOpen(false)
              true
          }
      } else {
          {}
      }
      onDispose { unregister() }
  }
  ```
- In `AndroidEditorSurface.kt`:
  Forward `isInputAllowed` through `EditorPanelScreen` -> `EditorScreens` -> `NativeTextEditorView` -> `AndroidEditorSurfaceView`.
  Apply suppression unconditionally when `!isInputAllowed` (even if the document was already read-only):
  ```kotlin
  val inputAllowed = isInputAllowed && ((document as? AndroidEditorDocument)?.isInputAllowed?.invoke() ?: true)
  val effectiveReadOnly = isReadOnly || document.isReadOnly.value || !inputAllowed
  if (editor.isEditable != !effectiveReadOnly) {
      editor.isEditable = !effectiveReadOnly
  }
  if (!inputAllowed) {
      editor.hideSoftInput()
      editor.clearFocus()
  }
  ```
  When the slide-over sidebar closes, `inputAllowed` becomes `true` and `effectiveReadOnly` returns to the document's natural read-only state.

### 5. Snapshot Provider & Media Surface Host Wiring in MainActivity & EditorScreens
In `MainActivity.kt` (Android platform code):
- Implement snapshot capture strictly on the Main dispatcher:
  ```kotlin
  fun capturePreviewSnapshot(doc: AndroidEditorDocument, maxChars: Int): DocumentPreviewSnapshot {
      check(Looper.myLooper() == Looper.getMainLooper()) { "Snapshot capture must run on Main thread" }
      val rev = doc.revision.value
      val fullLen = doc.content.length
      val cap = minOf(maxChars, fullLen)
      val text = doc.content.substring(0, cap)
      return DocumentPreviewSnapshot(
          documentId = doc.id,
          revision = rev,
          text = text,
          isTruncated = fullLen > maxChars
      )
  }
  ```
- Mount `LocalDocumentSnapshotProvider` above the preview consumers at the workspace level:
  ```kotlin
  val activeDoc = tabsState.activeDoc.collectAsState().value
  CompositionLocalProvider(
      LocalNativeEditorSurfaceHost provides AndroidNativeEditorSurfaceHost,
      LocalNativeMediaSurfaceHost provides AndroidNativeMediaSurfaceHost,
      LocalNativeHtmlSurfaceHost provides AndroidNativeHtmlSurfaceHost,
      LocalDocumentSnapshotProvider provides { maxChars ->
          (activeDoc as? AndroidEditorDocument)?.let { capturePreviewSnapshot(it, maxChars) }
      }
  ) {
      DamHopperMobileApp(...)
  }
  ```
- In `EditorScreens.kt`:
  - Observe `val revision by activeDoc.revision.collectAsState()` and trigger snapshot capture on revision change on the Main dispatcher.
  - Call `LocalNativeMediaSurfaceHost.current` for `FileTier.IMAGE` and `FileTier.VIDEO` instead of raw `MediaPreviewCard`.
  - Render `HtmlPreviewView` when `activeTab.previewMode && FileTierPolicy.isHtmlFile(activeTab.path)`.
  - Render `MarkdownPreviewView` with live snapshot when `activeTab.previewMode && FileTierPolicy.isMarkdownFile(activeTab.path)`.

### 6. Verification & Unit Tests
In `FileScreensPhase08Test.kt`:
- Test that opening sidebar on compact screens sets `isInputAllowed = false` and unconditionally clears focus and hides soft input on both editable and already-read-only documents.
- Test that back press and Escape key close the compact sidebar and cleanly restore previous navigation handlers.
- Test that selecting a file in the sidebar calls `openTab` without unmounting the editor view.
- Test that responsive width changes (600 dp breakpoint) preserve the exact `CodeEditor` view instance.

---

## Durable Tasks
```evcrate-tasks
[
  {
    "id": "integrate-editor-sidebar-and-rich-previews",
    "title": "Integrate collapsible left file-tree sidebar, media playback, and zero-WebView HTML preview into editor workspace",
    "blocked_by": [
      "implement-universal-language-and-decorators",
      "implement-markdown-and-html-previews",
      "implement-native-media-player-and-image-viewer"
    ],
    "allowed_files": [
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorScreens.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorPanelScreen.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt",
      "native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/FileScreensPhase08Test.kt"
    ],
    "constraints": [
      "Maintain stable CodeEditor view instance during responsive recomposition without swapping drawer components.",
      "Back button interceptor must use clean register/unregister lambdas that restore prior navigation state.",
      "Hardware keyboard and IME input must be suppressed in background editor when slide-over sidebar is open independently of previous editability, restoring natural read-only state on close.",
      "Slide-over sidebar must request focus to ensure Escape key event delivery.",
      "LocalDocumentSnapshotProvider must be mounted at workspace level above preview consumers and observe revision changes on Main dispatcher."
    ],
    "acceptance": [
      "Editor top bar displays [Files] sidebar toggle; opening it reveals the file tree on the left.",
      "Selecting a file in the sidebar opens it directly into an editor tab without unmounting the editor.",
      "Back press and Escape close the compact sidebar without leaving the project workspace.",
      "Background editor input is completely suppressed while compact sidebar is open, even on read-only documents.",
      "Markdown and HTML previews receive live document snapshots on revision change without creating a second text authority.",
      "Actual CodeEditor view instance identity is preserved across 600 dp breakpoint width transitions."
    ],
    "verification": [
      "Run ./gradlew.bat :androidApp:testDebugUnitTest --tests dev.damhopper.nativeapp.FileScreensPhase08Test",
      "Run ./gradlew.bat :shared:jvmTest --tests dev.damhopper.nativeapp.features.files.FileTreeStateTest"
    ]
  }
]
```

- [ ] <!-- evcrate-task:integrate-editor-sidebar-and-rich-previews --> Integrate collapsible left file-tree sidebar, media playback, and zero-WebView HTML preview into editor workspace (Completed 2026-10-24; 11/11 FileScreensPhase08Test passing; verified on emulator with Back key and sidebar file opening)
