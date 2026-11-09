package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsCounts
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsPresentation
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsProjection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget
import dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot
import dev.damhopper.nativeapp.features.workspace.ProjectSummary
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AgentHubLandingProjectionTest {

    @Test
    fun testProjectWithNullContextsProducesSafeDefaults() {
        val state = AgentHubLandingProjection.project(null, AgentHubSnapshot(), null, null)
        assertEquals("Server", state.profileName)
        assertEquals(0, state.urgencyCounters.attentionCount)
        assertEquals(0, state.agentRoster.agents.size)
        assertEquals(0, state.projectList.projects.size)
    }

    @Test
    fun testProjectWithProfileData() {
        val profile = ServerProfile("test-prof", "Local Dev", "http://127.0.0.1:4803")
        val state = AgentHubLandingProjection.project(profile, AgentHubSnapshot("test-prof"), null, null)
        assertEquals("Local Dev", state.profileName)
        assertEquals("http://127.0.0.1:4803", state.serverUrl)
        assertTrue(state.isOnline)
    }

    @Test
    fun testServerProjectsPopulateProjectList() {
        val summaries = listOf(
            ProjectSummary("dam-hopper", "/ws/dam-hopper", "pnpm"),
            ProjectSummary("android-app", "/ws/dam-hopper/native/android-app", "custom"),
        )
        val state = AgentHubLandingProjection.project(
            currentProfile = ServerProfile("test-prof", "Local Dev", "http://127.0.0.1:4803"),
            hubSnapshot = AgentHubSnapshot("test-prof"),
            agentsState = null,
            activeWorkspaceState = null,
            serverProjects = summaries,
        )
        assertEquals(2, state.projectList.projects.size)
        assertEquals("dam-hopper", state.projectList.projects[0].name)
        assertEquals("android-app", state.projectList.projects[1].name)
        assertEquals("dam-hopper", state.workspaceFileTree?.projectName)
    }

    @Test
    fun testZeroSessionTargetMarkedDismissible() {
        val target = ProjectTargetRef("test-prof", "docs-portal", "/path/to/docs")
        val state = AgentHubLandingProjection.project(
            currentProfile = null,
            hubSnapshot = AgentHubSnapshot("test-prof", zeroSessionOpenTargets = listOf(target)),
            agentsState = null,
            activeWorkspaceState = null,
        )
        assertEquals(1, state.projectList.projects.size)
        val card = state.projectList.projects.first()
        assertEquals("docs-portal", card.name)
        assertTrue(card.isZeroSessionTarget)
        assertTrue(card.isDismissible)
    }

    @Test
    fun testAgentsFilteringAppliesToRoster() {
        val owner = WorkspaceFileOwner("test-prof", "http://127.0.0.1", "dev", "dam-hopper")
        val runtime = TerminalAgentsRuntimeKey(ConnectionRef("test-prof", 1L), SocketInstanceRef(ConnectionRef("test-prof", 1L), "sock-1"), 1L, "http://127.0.0.1", "dev")
        val target1 = TerminalAgentsTarget(TerminalAgentsRegistration(owner, 1L, 1L), runtime, TerminalAgentsInstanceKey("test-prof", "term-1", 100uL), 1uL, 1L)
        val target2 = TerminalAgentsTarget(TerminalAgentsRegistration(owner, 2L, 2L), runtime, TerminalAgentsInstanceKey("test-prof", "term-2", 200uL), 1uL, 1L)

        val row1 = TerminalAgentsRow(target1, "dam-hopper", "Local Dev", "OMP Term", AgentKind.OMP, TerminalAgentsPresentation(TerminalAgentsStatus.NEEDS_ATTENTION, null, false, AgentObservationSource.LIFECYCLE, "Wait"))
        val row2 = TerminalAgentsRow(target2, "dam-hopper", "Local Dev", "Codex Term", AgentKind.CODEX, TerminalAgentsPresentation(TerminalAgentsStatus.WORKING, null, false, AgentObservationSource.HOOK, "Build"))

        val agentsState = TerminalAgentsState(
            projection = TerminalAgentsProjection(listOf(row1, row2), emptyList(), TerminalAgentsCounts(2, mapOf(TerminalAgentsStatus.NEEDS_ATTENTION to 1, TerminalAgentsStatus.WORKING to 1)), 1),
            filter = TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.NEEDS_ATTENTION)),
            loading = false,
            refreshNotice = null,
            lastActivation = null,
        )

        val state = AgentHubLandingProjection.project(null, AgentHubSnapshot(), agentsState, null)
        assertEquals(1, state.urgencyCounters.attentionCount)
        assertEquals(1, state.agentRoster.agents.size)
        assertEquals("term-1", state.agentRoster.agents.first().targetTerminalId)
        assertEquals(100uL, state.agentRoster.agents.first().incarnationExact)
    }
}
