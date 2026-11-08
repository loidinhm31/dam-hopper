package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgentHubLandingUiStateTest {

    @Test
    fun testDefaultStateValues() {
        val state = AgentHubLandingUiState()
        assertEquals("Server", state.profileName)
        assertTrue(state.isOnline)
        assertFalse(state.isAgentsDrawerOpen)
        assertFalse(state.isFilesDrawerOpen)
        assertTrue(state.isRightFileTreePinned)
        assertEquals(0, state.urgencyCounters.attentionCount)
        assertEquals(0, state.urgencyCounters.workingCount)
        assertEquals(0, state.urgencyCounters.idleCount)
    }

    @Test
    fun testUrgencyCountersValues() {
        val counters = UrgencyCountersUiState(attentionCount = 2, workingCount = 3, idleCount = 1)
        assertEquals(2, counters.attentionCount)
        assertEquals(3, counters.workingCount)
        assertEquals(1, counters.idleCount)
    }

    @Test
    fun testStateCopyMutation() {
        val initial = AgentHubLandingUiState()
        val updated = initial.copy(
            isAgentsDrawerOpen = true,
            isFilesDrawerOpen = false,
            urgencyCounters = UrgencyCountersUiState(attentionCount = 1, workingCount = 0, idleCount = 0),
        )
        assertTrue(updated.isAgentsDrawerOpen)
        assertFalse(updated.isFilesDrawerOpen)
        assertEquals(1, updated.urgencyCounters.attentionCount)
    }

    @Test
    fun testProjectCardUiStateDefaults() {
        val target = ProjectTargetRef(project = "dam-hopper")
        val card = ProjectCardUiState(
            id = target.key,
            target = target,
            name = "dam-hopper",
            profileTag = "local-dev",
            path = "/projects/dam-hopper",
            worktreeBranch = "main",
            activeTerminalCount = 2,
            isZeroSessionTarget = false,
            isDismissible = false,
            isSelectedForTree = true,
        )
        assertEquals("dam-hopper", card.name)
        assertEquals(2, card.activeTerminalCount)
        assertTrue(card.isSelectedForTree)
        assertFalse(card.isDismissible)
    }
}
