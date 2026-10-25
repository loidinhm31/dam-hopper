package dev.damhopper.nativeapp

import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.files.FileOperationArbiter
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocument
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocumentFactory
import dev.damhopper.nativeapp.platform.editor.resolveEditorInputGate
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.flow.AppFlowState
import dev.damhopper.nativeapp.ui.screens.isEditorInputAllowed
import dev.damhopper.nativeapp.ui.screens.isEditorSidebarDismissKey
import dev.damhopper.nativeapp.ui.screens.isEditorSidebarPinned
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileTreeNode
import dev.damhopper.nativeapp.features.files.FileTreeHelpers
import dev.damhopper.nativeapp.features.files.LanguageFileDto
import dev.damhopper.nativeapp.features.files.buildLanguageTree
import dev.damhopper.nativeapp.features.settings.ExplorerLanguageFilter
import dev.damhopper.nativeapp.features.files.ReplaceCoordinator
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FileScreensPhase08Test {

    @Test
    fun testFilesPanelRegistryBinding() {
        val descriptor = PanelRegistry.get(WorkbenchPanel.FILES)
        assertEquals("Files", descriptor.label)
        assertEquals("FS", descriptor.shortCode)
        assertEquals("[F]", descriptor.iconGlyph)
    }

    @Test
    fun testZeroFloatingActionButtonsInFilesFeature() {
        val filesFeatureDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files")
        assertTrue(filesFeatureDir.exists(), "Files feature directory must exist")

        val ktFiles = filesFeatureDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV-01 invariant: zero FABs permitted in files UI"
            )
        }
    }

    @Test
    fun testFileTreeNodeAttributes() {
        val target = ProjectTargetRef(project = "test-project")
        val hiddenFile = FileTreeNode(target, ".gitignore", ".gitignore", isDirectory = false)
        assertTrue(hiddenFile.isHidden)
        assertEquals("gitignore", hiddenFile.extension)

        val regularFile = FileTreeNode(target, "src/main.kt", "main.kt", isDirectory = false)
        assertFalse(regularFile.isHidden)
        assertEquals("kt", regularFile.extension)

        val dirNode = FileTreeNode(target, "src", "src", isDirectory = true)
        assertEquals("", dirNode.extension)
    }

    @Test
    fun testReplaceCoordinatorLiteralGuarantees() {
        val coordinator = ReplaceCoordinator({ null })
        val input = "Total cost: \$100 for key \\path\\var"
        val output = coordinator.replaceLiteral(input, "\$100", "\$250", false)
        assertEquals("Total cost: \$250 for key \\path\\var", output)
    }

    // ---- Phase 04: editor sidebar -------------------------------------------------------------

    private fun withWorkspaceState(block: (ProjectWorkspaceState) -> Unit) {
        val scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        val conn = ConnectionRef("prof-test", 1L)
        val baseUrl = "http://127.0.0.1:1"
        val owner = WorkspaceFileOwner(
            profileId = "prof-test",
            baseUrl = baseUrl,
            accountUser = "alice",
            project = "demo-proj",
        )
        val fileRepo = FileRepository(
            owner,
            ApiClient(conn, baseUrl, { "test-token" }),
            WsConnection(conn, baseUrl, { "test-token" }),
            scope,
            FileOperationArbiter(),
        )
        val state = ProjectWorkspaceState.create(
            owner = owner,
            target = owner.toProjectTargetRef(),
            fileRepository = fileRepo,
            editorRepository = EditorRepository(fileRepo, profileId = "prof-test"),
            documentFactory = AndroidEditorDocumentFactory(),
            coroutineScope = scope,
        )
        try {
            block(state)
        } finally {
            state.close()
            scope.cancel()
        }
    }

    @Test
    fun testSidebarOpenCloseStateTransitions() = withWorkspaceState { state ->
        assertFalse(state.isEditorSidebarOpen.value, "Sidebar starts closed")
        state.toggleEditorSidebar()
        assertTrue(state.isEditorSidebarOpen.value)
        state.toggleEditorSidebar()
        assertFalse(state.isEditorSidebarOpen.value)
        state.setEditorSidebarOpen(true)
        assertTrue(state.isEditorSidebarOpen.value)
        state.setEditorSidebarOpen(true)
        assertTrue(state.isEditorSidebarOpen.value, "Setting open twice is idempotent")
        state.setEditorSidebarOpen(false)
        assertFalse(state.isEditorSidebarOpen.value)
    }

    @Test
    fun testSidebarBreakpointIs600Dp() {
        assertFalse(isEditorSidebarPinned(599.dp))
        assertTrue(isEditorSidebarPinned(600.dp))
        assertTrue(isEditorSidebarPinned(900.dp))
    }

    @Test
    fun testCompactSidebarSuppressesBackgroundEditorInput() = withWorkspaceState { state ->
        val compact = isEditorSidebarPinned(400.dp)
        val wide = isEditorSidebarPinned(900.dp)

        // Closed sidebar never suppresses input.
        assertTrue(isEditorInputAllowed(state.isEditorSidebarOpen.value, compact))

        state.setEditorSidebarOpen(true)
        assertFalse(isEditorInputAllowed(state.isEditorSidebarOpen.value, compact), "Compact slide-over blocks input")
        assertTrue(isEditorInputAllowed(state.isEditorSidebarOpen.value, wide), "Pinned split keeps input")

        // Editable document: panel gate closed -> read-only + focus/IME dropped.
        val editableBlocked = resolveEditorInputGate(
            panelInputAllowed = false, documentInputAllowed = true,
            surfaceReadOnly = false, documentReadOnly = false,
        )
        assertFalse(editableBlocked.inputAllowed)
        assertTrue(editableBlocked.effectiveReadOnly)

        // Already read-only document: input is still reported blocked so focus/IME are cleared unconditionally.
        val readOnlyBlocked = resolveEditorInputGate(
            panelInputAllowed = false, documentInputAllowed = true,
            surfaceReadOnly = true, documentReadOnly = true,
        )
        assertFalse(readOnlyBlocked.inputAllowed)
        assertTrue(readOnlyBlocked.effectiveReadOnly)

        // Document's own input gate also blocks independently of the panel gate.
        val docBlocked = resolveEditorInputGate(
            panelInputAllowed = true, documentInputAllowed = false,
            surfaceReadOnly = false, documentReadOnly = false,
        )
        assertFalse(docBlocked.inputAllowed)

        // Closing restores each document's natural editability.
        state.setEditorSidebarOpen(false)
        val reopenAllowed = isEditorInputAllowed(state.isEditorSidebarOpen.value, compact)
        assertTrue(reopenAllowed)
        val editableRestored = resolveEditorInputGate(reopenAllowed, true, false, false)
        assertTrue(editableRestored.inputAllowed)
        assertFalse(editableRestored.effectiveReadOnly)
        val readOnlyRestored = resolveEditorInputGate(reopenAllowed, true, true, true)
        assertTrue(readOnlyRestored.inputAllowed)
        assertTrue(readOnlyRestored.effectiveReadOnly)
    }

    @Test
    fun testBackPressClosesCompactSidebarThenUnregistrationRestoresStageNavigation() = withWorkspaceState { state ->
        val nav = AppFlowNavigation(
            AppFlowState(stage = AppFlowStage.TERMINAL, activeProfileId = "prof-test", activeProject = "demo-proj")
        )
        state.setEditorSidebarOpen(true)
        val unregister = nav.registerBackInterceptor {
            state.setEditorSidebarOpen(false)
            true
        }

        assertTrue(nav.handleBackPress())
        assertFalse(state.isEditorSidebarOpen.value, "Back closes the sidebar")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage, "Back must not leave the workspace")

        unregister()
        assertTrue(nav.handleBackPress())
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage, "After unregister back unwinds the stage")
    }

    @Test
    fun testBackInterceptorsRunNewestFirstAndFallThroughWhenUnhandled() {
        val nav = AppFlowNavigation(AppFlowState(stage = AppFlowStage.TERMINAL, activeProfileId = "p", activeProject = "x"))
        val calls = mutableListOf<String>()
        val unregisterOuter = nav.registerBackInterceptor { calls += "outer"; true }
        val unregisterInner = nav.registerBackInterceptor { calls += "inner"; false }

        assertTrue(nav.handleBackPress())
        assertEquals(listOf("inner", "outer"), calls, "Newest first; unhandled falls through to older")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)

        unregisterInner()
        unregisterOuter()
        calls.clear()
        assertTrue(nav.handleBackPress())
        assertTrue(calls.isEmpty(), "Unregistered interceptors are never called")
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
    }

    @Test
    fun testEscapeKeyDismissesSidebarOnKeyDownOnly() = withWorkspaceState { state ->
        state.setEditorSidebarOpen(true)
        assertFalse(isEditorSidebarDismissKey(Key.A, KeyEventType.KeyDown))
        assertFalse(isEditorSidebarDismissKey(Key.Escape, KeyEventType.KeyUp))
        assertTrue(state.isEditorSidebarOpen.value)

        if (isEditorSidebarDismissKey(Key.Escape, KeyEventType.KeyDown)) state.setEditorSidebarOpen(false)
        assertFalse(state.isEditorSidebarOpen.value)
    }

    @Test
    fun testCapturePreviewSnapshotIsBoundedSurrogateSafeAndRevisionTagged() {
        val docId = DocumentId(
            owner = WorkspaceFileOwner("prof-test", "http://127.0.0.1:1", "alice", "demo-proj"),
            relativePath = "README.md",
            tabIncarnation = 1L,
        )
        val doc = AndroidEditorDocument(id = docId, initialText = "ab\uD83D\uDE00cd", initialMtime = 1L)

        val full = capturePreviewSnapshot(doc, 100)
        assertEquals("ab\uD83D\uDE00cd", full.text)
        assertFalse(full.isTruncated)
        assertEquals(docId, full.documentId)
        assertTrue(full.isCurrentFor(docId, doc.revision.value))

        val cut = capturePreviewSnapshot(doc, 3)
        assertEquals("ab", cut.text, "Cut must not leave half a surrogate pair")
        assertTrue(cut.isTruncated)
        doc.close()
    }

    @Test
    fun testLanguageTreeUsesOnlyAuthoritativeFamilyMetadataWithAncestors() {
        val target = ProjectTargetRef(project = "demo-proj")
        val files = listOf(
            LanguageFileDto("src/main.rs", size = 10uL, mtime = 1L, language = "rust"),
            LanguageFileDto("src/app/Main.java", size = 20uL, mtime = 2L, language = "java"),
            LanguageFileDto("web/index.ts", size = 30uL, mtime = 3L, language = "javascript-typescript"),
            LanguageFileDto("../escape.rs", language = "rust"),
            LanguageFileDto(".hidden/secret.rs", language = "rust"),
        )
        val rust = buildLanguageTree(target, files, ExplorerLanguageFilter.RUST)
        val visible = FileTreeHelpers.flattenVisibleNodes(rust, showHidden = false).map { it.first.path }
        // Real family only, ancestors retained and expanded, traversal rejected, hidden respects the toggle.
        assertEquals(listOf("src", "src/main.rs"), visible)
        val withHidden = FileTreeHelpers.flattenVisibleNodes(rust, showHidden = true).map { it.first.path }
        assertEquals(listOf(".hidden", ".hidden/secret.rs", "src", "src/main.rs"), withHidden)
        val java = buildLanguageTree(target, files, ExplorerLanguageFilter.JAVA)
        assertEquals(
            listOf("src", "src/app", "src/app/Main.java"),
            FileTreeHelpers.flattenVisibleNodes(java).map { it.first.path },
        )
        val js = buildLanguageTree(target, files, ExplorerLanguageFilter.JAVASCRIPT_TYPESCRIPT)
        assertEquals(listOf("web", "web/index.ts"), FileTreeHelpers.flattenVisibleNodes(js).map { it.first.path })
        // ALL never builds a family tree.
        assertTrue(buildLanguageTree(target, files, ExplorerLanguageFilter.ALL).children.isEmpty())
    }

    @Test
    fun testSettingsCoverSuspendsInputButKeepsSidebarAndTerminalState() = withWorkspaceState { state ->
        state.setEditorSidebarOpen(true)
        state.selectPanel(dev.damhopper.nativeapp.features.workspace.WorkspacePanel.EDITOR)
        assertTrue(state.isInteractiveEditAllowed())

        state.setInputSuspended(true)
        assertTrue(state.isInputSuspended.value)
        assertFalse(state.isInteractiveEditAllowed(), "A covered workspace never accepts widget input")
        assertTrue(state.terminalState?.isInputSuspended == true)
        assertTrue(state.isEditorSidebarOpen.value, "Sidebar is not reset by the cover")

        state.setInputSuspended(false)
        assertTrue(state.isInteractiveEditAllowed(), "Lifting the cover restores exactly the previous eligibility")
        assertTrue(state.isEditorSidebarOpen.value)
    }
}
