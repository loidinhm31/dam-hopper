package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.features.workflow.ItemKind
import dev.damhopper.nativeapp.features.workflow.ItemStatus
import dev.damhopper.nativeapp.features.workflow.PlanStatus
import dev.damhopper.nativeapp.features.workflow.WorkflowDomainHelpers
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkflowPhase13Test {

    @Test
    fun testWorkflowPanelRegisteredInAuthoritativeRegistry() {
        val descriptor = PanelRegistry.get(WorkbenchPanel.WORKFLOW)
        assertEquals("Workflow", descriptor.label)
        assertEquals("FLOW", descriptor.shortCode)
        assertEquals("[W]", descriptor.iconGlyph)
    }

    @Test
    fun testZeroFloatingActionButtonsInWorkflowUi() {
        val workflowDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow")
        assertTrue(workflowDir.exists(), "Workflow features directory must exist")

        val ktFiles = workflowDir.walk().filter { it.extension == "kt" }.toList()
        assertTrue(ktFiles.isNotEmpty())

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                "File ${file.name} violates NAV01 invariant: zero FABs permitted in workflow panel"
            )
        }
    }

    @Test
    fun testZeroWebViewOrBrowserEngineInWorkflowUi() {
        val workflowDir = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workflow")
        val ktFiles = workflowDir.walk().filter { it.extension == "kt" }.toList()

        ktFiles.forEach { file ->
            val text = file.readText()
            assertFalse(
                text.contains("android.webkit.WebView") || text.contains("WebKit"),
                "File ${file.name} violates B01/B02 invariant: zero WebView or browser engine permitted"
            )
        }
    }

    @Test
    fun testEnumSpellings() {
        assertEquals("in_progress", ItemStatus.IN_PROGRESS.wireName)
        assertEquals("canceled", ItemStatus.CANCELED.wireName)
        assertEquals("in-progress", PlanStatus.IN_PROGRESS.wireName)
        assertEquals("cancelled", PlanStatus.CANCELLED.wireName)
    }
}
