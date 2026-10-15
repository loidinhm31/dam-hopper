package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileTreeNode
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
}
