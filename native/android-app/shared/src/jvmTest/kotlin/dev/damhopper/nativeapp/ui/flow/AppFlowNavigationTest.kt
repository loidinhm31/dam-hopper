package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
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

        nav.departureGuard = { request ->
            guardInvoked = true
            deferredProceed = request.onProceed
            assertEquals(AppFlowStage.PROJECT_LIST, request.targetStage)
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

        nav.departureGuard = { _ -> false } // No dirty documents -> allow immediate navigation

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
        nav.departureGuard = { request -> deferred = request.onProceed; true }
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
        nav.departureGuard = { _ -> error("same workspace must not run the departure guard") }
        assertTrue(nav.routeToTerminal("server-A", "proj-1", null, "term-8"))
        assertEquals("term-8", nav.state.value.activeSessionId)
    }

    private val route = VerifiedTerminalRoute(
        profileId = "server-A",
        project = "proj-2",
        worktreePath = null,
        sessionId = "term-5",
        incarnation = 3uL,
        notificationRouteActive = false,
    )

    @Test
    fun testVerifiedRouteGateProceedsInTheSameWorkspaceAndDefersBehindTheGuard() {
        val nav = workspaceNav()
        // Same exact workspace: PROCEED without running the guard, and no state is mutated by the request.
        nav.departureGuard = { _ -> error("same workspace must not run the departure guard") }
        val sameWorkspace = route.copy(project = "proj-1")
        assertEquals(TerminalRouteGate.PROCEED, nav.requestVerifiedTerminalRoute(sameWorkspace, {}, {}))
        assertEquals("proj-1", nav.state.value.activeProject)
        assertNull(nav.state.value.requiredTerminalInstance)

        // Another workspace: the guard is asked; intercepting means DEFERRED with both callbacks handed over.
        var captured: DepartureRequest? = null
        nav.departureGuard = { request -> captured = request; true }
        var proceeded = 0
        var cancelled = 0
        assertEquals(
            TerminalRouteGate.DEFERRED,
            nav.requestVerifiedTerminalRoute(route, { proceeded++ }, { cancelled++ }),
        )
        assertEquals(AppFlowStage.TERMINAL, captured?.targetStage)
        assertEquals("proj-1", nav.state.value.activeProject, "a request never mutates the route")
        captured?.onProceed?.invoke()
        assertEquals(1, proceeded)
        assertEquals(0, cancelled)

        // A guard that does not intercept lets the caller proceed now.
        nav.departureGuard = { _ -> false }
        assertEquals(TerminalRouteGate.PROCEED, nav.requestVerifiedTerminalRoute(route, {}, {}))
    }

    @Test
    fun testCommitVerifiedRouteRecordsTheExactRequiredInstanceAndNotificationRouteInventsNone() {
        val nav = workspaceNav()
        nav.commitVerifiedTerminalRoute(route)
        val state = nav.state.value
        assertEquals(AppFlowStage.TERMINAL, state.stage)
        assertEquals("proj-2", state.activeProject)
        assertEquals("term-5", state.activeSessionId)
        assertFalse(state.notificationRouteActive)
        assertEquals(
            dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey("server-A", "term-5", 3uL),
            state.requiredTerminalInstance,
        )

        // The same terminal reported back by the screen keeps the intent; a different session clears it.
        nav.selectSession("term-5")
        assertEquals("term-5", nav.state.value.requiredTerminalInstance?.terminalId)
        nav.selectSession("term-6")
        assertNull(nav.state.value.requiredTerminalInstance)

        // Notification routing keeps its Boolean semantics, flags the route and never invents an incarnation.
        nav.commitVerifiedTerminalRoute(route)
        assertTrue(nav.routeToTerminal("server-A", "proj-3", null, "term-1"))
        assertNull(nav.state.value.requiredTerminalInstance)
        assertTrue(nav.state.value.notificationRouteActive)
    }

    @Test
    fun testRequiredInstanceClearsOnProjectBackAndProfileNavigation() {
        val nav = workspaceNav()
        nav.commitVerifiedTerminalRoute(route)
        assertTrue(nav.handleBackPress())
        assertNull(nav.state.value.requiredTerminalInstance)

        nav.commitVerifiedTerminalRoute(route)
        nav.selectProject("proj-9")
        assertNull(nav.state.value.requiredTerminalInstance)

        nav.commitVerifiedTerminalRoute(route)
        nav.navigateToProfiles()
        assertNull(nav.state.value.requiredTerminalInstance)
    }

    @Test
    fun testOrdinaryNavigationInvalidatesAtRequestTimeButTheVerifiedRouteBypassesIt() {
        val nav = workspaceNav()
        var invalidations = 0
        nav.onOrdinaryNavigationRequested = { invalidations++ }
        // Requested before the guard decides, even when the guard then intercepts.
        nav.departureGuard = { _ -> true }
        nav.handleBackPress()
        assertEquals(1, invalidations)
        nav.selectProject("proj-7")
        nav.navigateToProfiles()
        assertEquals(3, invalidations)
        nav.departureGuard = null
        assertTrue(nav.routeToTerminal("server-A", "proj-4", null, "t"))
        assertEquals(4, invalidations)

        // Admitted manual commit and session reports never call the ordinary invalidator.
        nav.commitVerifiedTerminalRoute(route)
        nav.selectSession("term-5")
        assertEquals(4, invalidations)
        assertFalse(nav.requestVerifiedTerminalRoute(route, {}, {}) == TerminalRouteGate.DEFERRED)
        assertEquals(4, invalidations)
    }

    @Test
    fun testAgentSettingsOpenTheCapturedHostAgentsIntentAndReplaceItDeterministically() {
        val nav = workspaceNav()
        val origin = SettingsOrigin(AppFlowStage.TERMINAL, panel = "TERMINAL", sessionId = "term-1")
        nav.openAgentSettings(origin, "server-B")
        var overlay = nav.state.value.settings
        assertEquals("HOST", overlay?.subSection)
        assertEquals("AGENTS", overlay?.hostSection)
        assertEquals("server-B", overlay?.targetProfileId)
        assertEquals(origin.copy(stage = AppFlowStage.TERMINAL), overlay?.origin)
        val firstIntent = overlay?.intent

        // A second open keeps the origin but advances the intent; the host section is remembered by name.
        nav.setSettingsHostSection("USAGE")
        nav.openAgentSettings(origin.copy(panel = "FILES"), "server-C")
        overlay = nav.state.value.settings
        assertEquals("TERMINAL", overlay?.origin?.panel)
        assertEquals("AGENTS", overlay?.hostSection)
        assertEquals("server-C", overlay?.targetProfileId)
        assertTrue((overlay?.intent ?: 0L) > (firstIntent ?: 0L))

        // Closing Settings returns to the origin; the session and project were never touched.
        assertEquals("TERMINAL", nav.closeSettings()?.panel)
        assertEquals("proj-1", nav.state.value.activeProject)
        assertNull(nav.state.value.settings)
    }

    @Test
    fun testRequestWorkspaceTargetGuardedAndRevalidated() = runTest {
        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("server-A")
        nav.selectProject("proj-1")

        var guardProceed: (() -> Unit)? = null
        var guardCancel: (() -> Unit)? = null
        nav.departureGuard = { req ->
            guardProceed = req.onProceed
            guardCancel = req.onCancelled
            true
        }

        val target = ProjectTargetRef("server-A", "proj-2", null)
        var committed = false
        var revalidated = false

        // Launch switch to proj-2
        val job = async {
            nav.requestWorkspaceTarget(
                target = target,
                revalidate = {
                    revalidated = true
                    true
                },
                onCommitted = { committed = true }
            )
        }

        // Before guard confirmation: not committed
        testScheduler.runCurrent()
        assertFalse(committed)
        assertEquals("proj-1", nav.state.value.activeProject)

        // Confirm departure
        guardProceed!!.invoke()
        testScheduler.runCurrent()
        val result = job.await()
        assertTrue(result.isSuccess)
        assertTrue(revalidated)
        assertTrue(committed)
        assertEquals("proj-2", nav.state.value.activeProject)
    }

    @Test
    fun testRequestWorkspaceTargetCancelledDoesNotCommit() = runTest {
        val nav = AppFlowNavigation()
        nav.onProfileAuthenticated("server-A")
        nav.selectProject("proj-1")

        var guardCancel: (() -> Unit)? = null
        nav.departureGuard = { req ->
            guardCancel = req.onCancelled
            true
        }

        val target = ProjectTargetRef("server-A", "proj-2", null)
        var committed = false

        val job = async {
            nav.requestWorkspaceTarget(
                target = target,
                revalidate = { true },
                onCommitted = { committed = true }
            )
        }
        testScheduler.runCurrent()
        // Cancel departure
        guardCancel!!.invoke()
        testScheduler.runCurrent()
        val result = job.await()
        assertTrue(result.isFailure)
        assertFalse(committed)
        assertEquals("proj-1", nav.state.value.activeProject)
    }
}
