package dev.damhopper.nativeapp.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkbenchStateTest {

    @Test
    fun testWorkbenchInvariants() {
        val state = WorkbenchState()

        // Invariant 1: Workbench must operate strictly in TERMINAL mode
        assertEquals(WorkbenchMode.TERMINAL, state.workspaceMode)

        // Invariant 2: Terminal usage mode must be strictly TRADITIONAL
        assertEquals(TerminalUsageMode.TRADITIONAL, state.terminalUsageMode)

        // Invariant 3: Zero floating action buttons (FABs)
        assertFalse(state.allowFloatingButtons)

        // Invariant 4: Single content area
        assertTrue(state.singleContentArea)

        // Default panel is TERMINAL
        assertEquals(WorkbenchPanel.TERMINAL, state.activePanel)
    }

    @Test
    fun testPanelSwitchingPreservesInvariants() {
        var state = WorkbenchState()
        assertEquals(WorkbenchPanel.TERMINAL, state.activePanel)

        state = state.copy(activePanel = WorkbenchPanel.GIT)
        assertEquals(WorkbenchPanel.GIT, state.activePanel)
        assertEquals(WorkbenchMode.TERMINAL, state.workspaceMode)
        assertFalse(state.allowFloatingButtons)

        state = state.copy(activePanel = WorkbenchPanel.FILES)
        assertEquals(WorkbenchPanel.FILES, state.activePanel)
        assertTrue(state.singleContentArea)
    }

    @Test
    fun testAllPanelsHaveValidCodesAndLabels() {
        for (panel in WorkbenchPanel.values()) {
            assertTrue(panel.label.isNotBlank(), "Panel ${panel.name} must have a non-blank label")
            assertTrue(panel.shortCode.isNotBlank(), "Panel ${panel.name} must have a non-blank shortCode")
            assertTrue(panel.shortCode.length in 2..5, "Panel short code should be 2 to 5 characters")
        }
    }
}
