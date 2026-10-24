package dev.damhopper.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import dev.damhopper.nativeapp.model.TerminalUsageMode
import dev.damhopper.nativeapp.model.WorkbenchMode
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.navigation.PanelRegistry
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Legacy State-Model Regression Journeys for Phase 18 GATE-C:
 * Verifies non-visual state-model navigation and privacy invariants on Android runtime.
 * NOTE: This class certifies state-model objects only, NOT the mounted MainActivity app UI
 * or active-root Editor/Files surfaces (which are qualified by [NativeEditorExplorerJourneys]).
 */
@RunWith(AndroidJUnit4::class)
class WorkbenchJourneys {

    @Test
    fun testApplicationContextAndPackageIdentity() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(
            appContext.packageName.startsWith("dev.damhopper.nativeapp"),
            "Package name must match dev.damhopper.nativeapp namespace"
        )
        val packageInfo = appContext.packageManager.getPackageInfo(appContext.packageName, 0)
        assertEquals("0.1.0", packageInfo.versionName)
    }

    @Test
    fun testWorkbenchDeviceStateInvariants() {
        val state = WorkbenchState()
        assertEquals(WorkbenchMode.TERMINAL, state.workspaceMode)
        assertEquals(TerminalUsageMode.TRADITIONAL, state.terminalUsageMode)
        assertFalse(state.allowFloatingButtons, "Floating action buttons are strictly prohibited")
        assertTrue(state.singleContentArea, "Single content host is mandatory across all Android form factors")
    }

    @Test
    fun testCompleteTwelvePanelJourneyOnDevice() {
        val nav = WorkbenchNavigation()
        val panels = PanelRegistry.allPanels

        assertEquals(12, panels.size)
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)

        // Iterate through all 12 panels in sequence
        for (descriptor in panels) {
            val panel = descriptor.panel
            nav.navigateTo(panel)
            assertEquals(panel, nav.state.value.activePanel)

            if (panel != WorkbenchPanel.TERMINAL) {
                // Must return cleanly to TERMINAL
                assertTrue(nav.handleBackPress())
                assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)
            }
        }
    }

    @Test
    fun testCognitoPrivacyOverlayOnDeviceRuntime() {
        val privacy = PrivacyController()

        // Verify inactive initially
        assertFalse(privacy.isMaskActive.value)
        assertTrue(privacy.isInputAllowed())

        // Activate with standard shortcut
        privacy.activate("ctrl+p", CognitoModeStyle.HEAVY_BLUR)
        assertTrue(privacy.isMaskActive.value)
        assertFalse(privacy.isInputAllowed())

        // Dismiss with shortcut
        val dismissed = privacy.dismissWithChord("ctrl+p")
        assertTrue(dismissed)
        assertFalse(privacy.isMaskActive.value)
        assertTrue(privacy.isInputAllowed())
    }
}
