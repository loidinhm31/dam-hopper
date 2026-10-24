package dev.damhopper.nativeapp.ui.navigation

import dev.damhopper.nativeapp.model.WorkbenchPanel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkbenchNavigationTest {

    @Test
    fun testInitialState() {
        val nav = WorkbenchNavigation()
        val state = nav.state.value
        assertEquals(WorkbenchPanel.TERMINAL, state.activePanel)
        assertEquals("Default Workspace", state.activeProject)
        assertFalse(state.hasActiveOverlay)
        assertFalse(state.showTargetPicker)
        assertFalse(state.showWorkspaceSwitcher)
        assertNull(state.pendingWorkspaceSwitchPath)
    }

    @Test
    fun testPanelRegistryCompleteness() {
        // Invariant: Exactly 12 authoritative panels
        assertEquals(12, PanelRegistry.allPanels.size)
        WorkbenchPanel.entries.forEach { panel ->
            assertTrue(PanelRegistry.isAuthoritative(panel))
            val descriptor = PanelRegistry.get(panel)
            assertEquals(panel, descriptor.panel)
            assertTrue(descriptor.label.isNotBlank())
            assertTrue(descriptor.shortCode.isNotBlank())
            assertTrue(descriptor.iconGlyph.isNotBlank())
        }
    }

    @Test
    fun testPanelNavigation() {
        val nav = WorkbenchNavigation()
        nav.navigateTo(WorkbenchPanel.FILES)
        assertEquals(WorkbenchPanel.FILES, nav.state.value.activePanel)

        nav.navigateTo(WorkbenchPanel.GIT)
        assertEquals(WorkbenchPanel.GIT, nav.state.value.activePanel)

        nav.navigateTo(WorkbenchPanel.SETTINGS)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)
    }

    @Test
    fun testBackDismissalPrecedence() {
        val nav = WorkbenchNavigation()

        // 1. Initial terminal, no overlays -> back returns false (exit/system)
        assertFalse(nav.handleBackPress(), "Terminal with no overlays must yield to platform")

        // 2. Navigate to non-terminal panel -> back returns to TERMINAL
        nav.navigateTo(WorkbenchPanel.FILES)
        assertEquals(WorkbenchPanel.FILES, nav.state.value.activePanel)
        assertTrue(nav.handleBackPress(), "Back on non-terminal must be consumed")
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)

        // 3. Open profile list while at terminal -> back closes profile list
        nav.openProfileList()
        assertTrue(nav.state.value.showProfileList)
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.showProfileList)

        // 4. Open workspace switcher -> back closes workspace switcher
        nav.openWorkspaceSwitcher()
        assertTrue(nav.state.value.showWorkspaceSwitcher)
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.showWorkspaceSwitcher)

        // 5. Open target picker -> back closes target picker
        nav.openTargetPicker()
        assertTrue(nav.state.value.showTargetPicker)
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.showTargetPicker)

        // 6. Request destructive workspace switch -> back cancels confirmation
        nav.requestWorkspaceSwitch("/ws/new")
        assertEquals("/ws/new", nav.state.value.pendingWorkspaceSwitchPath)
        assertTrue(nav.handleBackPress())
        assertNull(nav.state.value.pendingWorkspaceSwitchPath)

        // 7. Open auth dialog -> back closes auth dialog
        nav.openAuth("prof-1")
        assertEquals("prof-1", nav.state.value.authProfileId)
        assertTrue(nav.handleBackPress())
        assertNull(nav.state.value.authProfileId)

        // 8. Chained overlay dismissal precedence:
        // When on SETTINGS panel, and target picker is open:
        nav.navigateTo(WorkbenchPanel.SETTINGS)
        nav.openTargetPicker()
        // First back: closes target picker
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.showTargetPicker)
        assertEquals(WorkbenchPanel.SETTINGS, nav.state.value.activePanel)
        // Second back: returns from SETTINGS to TERMINAL
        assertTrue(nav.handleBackPress())
        assertEquals(WorkbenchPanel.TERMINAL, nav.state.value.activePanel)
        // Third back: yields to platform
        assertFalse(nav.handleBackPress())
    }

    @Test
    fun testProjectSelection() {
        val nav = WorkbenchNavigation()
        nav.openTargetPicker()
        assertTrue(nav.state.value.showTargetPicker)

        nav.selectProject("my-project")
        assertEquals("my-project", nav.state.value.activeProject)
        assertFalse(nav.state.value.showTargetPicker, "Selecting project must dismiss target picker")
    }
}
