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

    @Test
    fun testDepartureGuardInterceptsBackPressAndDefersTransition() {
        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("server-A")
        nav.selectProject("proj-1")
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)

        var guardInvoked = false
        var deferredProceed: (() -> Unit)? = null

        nav.departureGuard = { targetStage, onProceed ->
            guardInvoked = true
            deferredProceed = onProceed
            true // Intercept!
        }

        // Back press should be consumed/intercepted
        val handled = nav.handleBackPress()
        assertTrue(handled)
        assertTrue(guardInvoked)
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage, "State must remain unchanged while intercepted")

        // Invoking deferred callback must execute transition
        deferredProceed?.invoke()
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
    }

    @Test
    fun testDepartureGuardPermitsImmediateTransitionWhenAllowed() {
        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("server-A")
        nav.selectProject("proj-1")

        nav.departureGuard = { _, _ -> false } // No dirty documents -> allow immediate navigation

        val handled = nav.handleBackPress()
        assertTrue(handled)
        assertEquals(AppFlowStage.PROJECT_LIST, nav.state.value.stage)
    }

    private fun workspaceNav(): AppFlowNavigation {
        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("server-A")
        nav.selectProject("proj-1")
        nav.selectSession("term-7")
        return nav
    }

    @Test
    fun testSettingsIsARetainedOverlayThatNeverMovesSelection() {
        val nav = workspaceNav()
        val before = nav.state.value
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL, panel = "EDITOR", document = "file:a.kt", sessionId = "term-7"))
        val open = nav.state.value
        assertEquals(AppFlowStage.TERMINAL, open.stage, "Settings is an overlay, not a stage")
        assertEquals(before.activeProject, open.activeProject)
        assertEquals(before.activeSessionId, open.activeSessionId)
        assertEquals("EDITOR", open.settings?.origin?.panel)
        assertEquals("file:a.kt", open.settings?.origin?.document)

        // A second open never replaces the captured origin (the overlay never nests).
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL, panel = "FILES"))
        assertEquals("EDITOR", nav.state.value.settings?.origin?.panel)

        nav.setSettingsSubSection("NOTIFICATIONS")
        assertEquals("NOTIFICATIONS", nav.state.value.settings?.subSection)
    }

    @Test
    fun testBackClosesSettingsThenFeedThenUnwindsStagesAndReturnsTheOrigin() {
        val nav = workspaceNav()
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL, panel = "TERMINAL", sessionId = "term-7"))
        // Newer interceptors (e.g. the sidebar) must not swallow the Back meant for Settings.
        var interceptorCalls = 0
        nav.registerBackInterceptor { interceptorCalls++; true }

        assertTrue(nav.handleBackPress())
        assertNull(nav.state.value.settings)
        assertEquals(0, interceptorCalls)
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
        assertEquals("term-7", nav.state.value.activeSessionId, "exact session preserved")

        nav.toggleNotifications()
        assertTrue(nav.state.value.notificationsOpen)
        assertTrue(nav.handleBackPress())
        assertFalse(nav.state.value.notificationsOpen)
        assertEquals(0, interceptorCalls)

        assertTrue(nav.handleBackPress()) // now the interceptor owns it
        assertEquals(1, interceptorCalls)
        assertEquals(AppFlowStage.TERMINAL, nav.state.value.stage)
    }

    @Test
    fun testCloseSettingsReturnsOriginAndIsIdempotent() {
        val nav = workspaceNav()
        assertNull(nav.closeSettings())
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL, panel = "FILES"))
        assertEquals("FILES", nav.closeSettings()?.panel)
        assertNull(nav.closeSettings())
    }

    @Test
    fun testStageChangesDropTheOverlayBecauseItsOriginNoLongerExists() {
        val nav = workspaceNav()
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL))
        nav.navigateToProfiles()
        assertNull(nav.state.value.settings)

        nav.onProfileAuthenticated("server-A")
        nav.openSettings(SettingsOrigin(AppFlowStage.PROJECT_LIST))
        nav.onProfileAuthenticated("server-B")
        assertNull(nav.state.value.settings)
        assertNull(nav.state.value.activeProject)
    }

    @Test
    fun testConfirmedResetLeavesForWorkspaceSelectionWithoutKeepingStaleSelection() {
        val nav = workspaceNav()
        nav.openSettings(SettingsOrigin(AppFlowStage.TERMINAL))
        nav.completeResetToWorkspaceSelection()
        val state = nav.state.value
        assertEquals(AppFlowStage.PROJECT_LIST, state.stage)
        assertEquals("server-A", state.activeProfileId)
        assertNull(state.activeProject)
        assertNull(state.activeSessionId)
        assertNull(state.settings)
    }

    @Test
    fun testNotificationRouteRevalidatesImmediatelyBeforeCommitAndHonorsTheDepartureGuard() {
        val nav = workspaceNav()
        // Refused outright when the target is no longer live at the first check.
        assertFalse(nav.routeToTerminal("server-A", "proj-2", null, "term-9", revalidate = { false }))
        assertEquals("proj-1", nav.state.value.activeProject)

        // The departure guard defers a cross-project route; revalidation runs again at commit time.
        var deferred: (() -> Unit)? = null
        nav.departureGuard = { _, proceed -> deferred = proceed; true }
        var live = true
        var committed = false
        assertTrue(nav.routeToTerminal("server-A", "proj-2", "/wt", "term-9", revalidate = { live }, onCommitted = { committed = true }))
        assertEquals("proj-1", nav.state.value.activeProject, "deferred behind the guard")
        live = false // the owner changed while the user answered the dialog
        deferred?.invoke()
        assertEquals("proj-1", nav.state.value.activeProject, "stale click must not navigate")
        assertFalse(committed)

        live = true
        assertTrue(nav.routeToTerminal("server-A", "proj-2", "/wt", "term-9", revalidate = { live }, onCommitted = { committed = true }))
        deferred?.invoke()
        val state = nav.state.value
        assertEquals("proj-2", state.activeProject)
        assertEquals("/wt", state.activeWorktreePath)
        assertEquals("term-9", state.activeSessionId)
        assertTrue(committed)
    }

    @Test
    fun testRouteWithinTheSameWorkspaceNeedsNoDepartureGuard() {
        val nav = workspaceNav()
        nav.departureGuard = { _, _ -> error("same workspace must not run the departure guard") }
        assertTrue(nav.routeToTerminal("server-A", "proj-1", null, "term-8"))
        assertEquals("term-8", nav.state.value.activeSessionId)
    }
}
