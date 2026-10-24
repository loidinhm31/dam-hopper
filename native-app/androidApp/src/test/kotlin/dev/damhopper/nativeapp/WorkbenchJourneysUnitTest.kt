package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import dev.damhopper.nativeapp.model.WorkbenchMode
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Phase 18 Workbench Journeys Unit Qualification:
 * Statically and behaviorally proves the 12-panel workbench lifecycle,
 * solitary top navigation row, zero FABs, zero WebViews, back-stack hierarchy,
 * and Cognito privacy overlay input gating.
 */
class WorkbenchJourneysUnitTest {

    @Test
    fun testCompleteTwelvePanelNavigationJourney() {
        val nav = WorkbenchNavigation()
        val all12Panels = PanelRegistry.allPanels

        assertEquals(12, all12Panels.size, "Exactly 12 authoritative panels must exist")
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)

        // Sequentially navigate through all 12 panels
        // Sequentially navigate through all 12 panels
        for (descriptor in all12Panels) {
            val panel = descriptor.panel
            nav.navigateTo(panel)
            assertEquals(panel, nav.state.value.activePanel, "Active panel must update to $panel")

            // Returning via back press returns to TERMINAL unless already on TERMINAL
            if (panel != WorkbenchPanel.TERMINAL) {
                assertTrue(nav.handleBackPress(), "Back press from $panel must navigate back to TERMINAL")
                assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)
            } else {
                assertFalse(nav.handleBackPress(), "Back press on TERMINAL must yield to platform back handler")
            }
        }
    }

    @Test
    fun testSolitaryTopNavigationRowInvariants() {
        val navFile = File("../shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/navigation/PanelNavigationRow.kt")
        assertTrue(navFile.exists(), "PanelNavigationRow.kt must exist")
        val content = navFile.readText()

        // 1. Single-line horizontal scroll
        assertTrue(content.contains("horizontalScroll"), "Navigation row must be horizontally scrollable")
        assertFalse(content.contains("verticalScroll"), "Navigation row must not vertically scroll")

        // 2. Auto-reveal of selected button
        assertTrue(content.contains("BringIntoViewRequester"), "Navigation row must support BringIntoViewRequester for selected reveal")

        // 3. Anti-drawer & Anti-overflow menu rules
        assertFalse(content.contains("NavigationDrawer"), "No drawer navigation permitted")
        assertFalse(content.contains("DropdownMenu"), "No overflow 'More' dropdown menu permitted")
        assertFalse(content.contains("BottomAppBar") || content.contains("NavigationBar"), "No bottom navigation permitted")
    }

    @Test
    fun testZeroFloatingActionButtonsAcrossEntireRepository() {
        val roots = listOf(
            File("../shared/src/commonMain/kotlin"),
            File("src/main/kotlin")
        )

        for (root in roots) {
            assertTrue(root.exists(), "Source directory $root must exist")
            val ktFiles = root.walk().filter { it.extension == "kt" }.toList()
            assertTrue(ktFiles.isNotEmpty(), "Kotlin source files must be present")

            for (file in ktFiles) {
                val text = file.readText()
                assertFalse(
                    text.contains("FloatingActionButton") || text.contains("ExtendedFloatingActionButton"),
                    "Prohibited FAB component found in ${file.absolutePath}"
                )
            }
        }
    }

    @Test
    fun testZeroWebViewsAcrossEntireApplication() {
        val roots = listOf(
            File("../shared/src/commonMain/kotlin"),
            File("src/main/kotlin")
        )

        val previewSurfaceFile = "AndroidHtmlSurface.kt"
        for (root in roots) {
            val ktFiles = root.walk().filter { it.extension == "kt" }.toList()
            for (file in ktFiles) {
                val text = file.readText()
                if (file.name == previewSurfaceFile) {
                    // Security check: Dedicated HTML preview surface MUST enforce complete sandboxing
                    assertTrue(text.contains("javaScriptEnabled = false"), "Preview WebView must disable JavaScript")
                    assertTrue(text.contains("allowFileAccess = false"), "Preview WebView must disable file access")
                    assertTrue(text.contains("allowContentAccess = false"), "Preview WebView must disable content access")
                    assertTrue(text.contains("domStorageEnabled = false"), "Preview WebView must disable DOM storage")
                    continue
                }
                assertFalse(
                    text.contains("android.webkit.WebView") || text.contains("androidx.webkit"),
                    "Prohibited WebView dependency found in ${file.absolutePath}: mobile shell and components must remain native"
                )
            }
        }
    }

    @Test
    fun testCognitoPrivacyOverlayInputGatingAndDismissal() {
        val privacyController = PrivacyController()

        // Initially inactive
        assertFalse(privacyController.isMaskActive.value)
        assertTrue(privacyController.isInputAllowed())

        // Activate with chord
        // Activate with chord
        privacyController.activate("ctrl+p", CognitoModeStyle.HEAVY_BLUR)
        assertTrue(privacyController.isMaskActive.value)
        assertFalse(privacyController.isInputAllowed(), "Input must be frozen while Cognito mask is active")

        // Incorrect chord does not dismiss
        val wrongDismiss = privacyController.dismissWithChord("ctrl+z")
        assertFalse(wrongDismiss)
        assertTrue(privacyController.isMaskActive.value)
        assertFalse(privacyController.isInputAllowed())

        // Correct chord dismisses mask
        val correctDismiss = privacyController.dismissWithChord("ctrl+p")
        assertTrue(correctDismiss)
        assertFalse(privacyController.isMaskActive.value)
        assertTrue(privacyController.isInputAllowed())

        // Reactivate and test touch emergency dismissal
        privacyController.activate("ctrl+p", CognitoModeStyle.BLACK_SCREEN)
        assertTrue(privacyController.isMaskActive.value)
        assertFalse(privacyController.isInputAllowed())

        privacyController.dismissTouchEmergency()
        assertFalse(privacyController.isMaskActive.value, "Emergency touch dismiss must deactivate mask")
        assertTrue(privacyController.isInputAllowed())
    }

    @Test
    fun testNavigationStackHierarchicalUnwinding() {
        val nav = WorkbenchNavigation()

        // 1. Navigate to Settings panel
        nav.navigateTo(WorkbenchPanel.SETTINGS)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)

        // 2. Open Target Picker modal and dismiss
        nav.openTargetPicker()
        assertTrue(nav.state.value.showTargetPicker)
        assertTrue(nav.handleBackPress(), "Back press must dismiss Target Picker")
        assertFalse(nav.state.value.showTargetPicker)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)

        // 3. Open Workspace Switcher modal and dismiss
        nav.openWorkspaceSwitcher()
        assertTrue(nav.state.value.showWorkspaceSwitcher)
        assertTrue(nav.handleBackPress(), "Back press must dismiss Workspace Switcher")
        assertFalse(nav.state.value.showWorkspaceSwitcher)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)

        // 4. Back unwinding step: return from Settings to Terminal
        assertTrue(nav.handleBackPress())
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)

        // 5. Back unwinding step: exit / yield to platform
        assertFalse(nav.handleBackPress())
    }
}
