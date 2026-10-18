package dev.damhopper.nativeapp.ui.flow

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppFlowNavigationTest {

    @Test
    fun testInitialState() {
        val nav = AppFlowNavigation()
        val state = nav.state.value

        assertEquals(AppFlowStage.PROFILE_LOGIN, state.stage)
        assertNull(state.activeProfileId)
        assertNull(state.activeProject)
        assertNull(state.activeSessionId)
    }

    @Test
    fun testAuthenticationAndProjectSelectionFlow() {
        val nav = AppFlowNavigation()

        // 1. Authenticate profile
        nav.onProfileAuthenticated("profile-1")
        val state1 = nav.state.value
        assertEquals(AppFlowStage.PROJECT_LIST, state1.stage)
        assertEquals("profile-1", state1.activeProfileId)
        assertNull(state1.activeProject)
        assertNull(state1.activeSessionId)

        // 2. Select project
        nav.selectProject("dam-hopper")
        val state2 = nav.state.value
        assertEquals(AppFlowStage.TERMINAL, state2.stage)
        assertEquals("profile-1", state2.activeProfileId)
        assertEquals("dam-hopper", state2.activeProject)
        assertNull(state2.activeSessionId)

        // 3. Select terminal session
        nav.selectSession("term-101")
        val state3 = nav.state.value
        assertEquals("term-101", state3.activeSessionId)
    }

    @Test
    fun testBackPressHierarchicalUnwinding() {
        val nav = AppFlowNavigation()

        // At PROFILE_LOGIN: back press yields to system/platform
        assertFalse(nav.handleBackPress(), "PROFILE_LOGIN stage must yield to platform back")
        assertEquals(AppFlowStage.PROFILE_LOGIN, nav.state.value.stage)

        // Advance to TERMINAL
        nav.onProfileAuthenticated("profile-1")
        nav.selectProject("proj-alpha")
        nav.selectSession("sess-1")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)

        // 1. Back from TERMINAL returns to PROJECT_LIST
        assertTrue(nav.handleBackPress(), "Back in TERMINAL must be consumed")
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
        assertEquals("profile-1", nav.state.value.activeProfileId)
        assertEquals("proj-alpha", nav.state.value.activeProject)

        // 2. Back from PROJECT_LIST returns to PROFILE_LOGIN
        assertTrue(nav.handleBackPress(), "Back in PROJECT_LIST must be consumed")
        assertEquals(AppFlowStage.PROFILE_LOGIN, nav.state.value.stage)

        // 3. Back from PROFILE_LOGIN yields to platform
        assertFalse(nav.handleBackPress(), "Back in PROFILE_LOGIN must yield to platform")
    }

    @Test
    fun testProfileSwitchInvalidatesProjectAndSession() {
        val nav = AppFlowNavigation()

        nav.onProfileAuthenticated("server-A")
        nav.selectProject("project-A1")
        nav.selectSession("session-A1-1")

        assertEquals("project-A1", nav.state.value.activeProject)
        assertEquals("session-A1-1", nav.state.value.activeSessionId)

        // Switch to different server profile
        nav.onProfileAuthenticated("server-B")
        val stateB = nav.state.value

        assertEquals(AppFlowStage.PROJECT_LIST, stateB.stage)
        assertEquals("server-B", stateB.activeProfileId)
        assertNull(stateB.activeProject, "Project from server-A must NOT leak to server-B")
        assertNull(stateB.activeSessionId, "Session from server-A must NOT leak to server-B")
    }

    @Test
    fun testSameProfileReauthPreservesSelections() {
        val nav = AppFlowNavigation()

        nav.onProfileAuthenticated("server-A")
        nav.selectProject("project-A1")
        nav.selectSession("session-A1-1")

        // Re-authenticating same profile keeps project and session
        nav.onProfileAuthenticated("server-A")
        val state = nav.state.value

        assertEquals("server-A", state.activeProfileId)
        assertEquals("project-A1", state.activeProject)
        assertEquals("session-A1-1", state.activeSessionId)
    }

    @Test
    fun testProjectSwitchInvalidatesSession() {
        val nav = AppFlowNavigation()

        nav.onProfileAuthenticated("server-A")
        nav.selectProject("project-1")
        nav.selectSession("session-1")

        assertEquals("session-1", nav.state.value.activeSessionId)

        // Switch to different project
        nav.selectProject("project-2")
        val state2 = nav.state.value

        assertEquals("project-2", state2.activeProject)
        assertNull(state2.activeSessionId, "Session from project-1 must NOT leak to project-2")
    }

    @Test
    fun testNavigateToProfilesClearsSession() {
        val nav = AppFlowNavigation()

        nav.onProfileAuthenticated("server-A")
        nav.selectProject("project-1")
        nav.selectSession("session-1")

        nav.navigateToProfiles()
        val state = nav.state.value

        assertEquals(AppFlowStage.PROFILE_LOGIN, state.stage)
        assertNull(state.activeSessionId, "Active session ID must be cleared when returning to profiles")
    }
}
