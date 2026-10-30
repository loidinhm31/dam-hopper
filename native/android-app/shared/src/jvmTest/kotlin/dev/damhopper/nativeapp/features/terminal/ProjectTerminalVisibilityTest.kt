package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.ui.screens.ProjectTerminalState
import dev.damhopper.nativeapp.ui.screens.QueuedWrite
import dev.damhopper.nativeapp.ui.screens.TerminalBindingToken
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ProjectTerminalVisibilityTest {

    private lateinit var testScope: CoroutineScope
    private val connection = ConnectionRef("prof-term-1", 1L)

    @BeforeTest
    fun setUp() {
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        testScope.cancel()
    }

    private fun createTerminalState(projectName: String = "test-project"): ProjectTerminalState {
        return ProjectTerminalState(
            projectName = projectName,
            connectionRef = connection,
            ownerScope = testScope,
        )
    }

    @Test
    fun testHiddenTerminalInputPolicyGating() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.selectSession("sess-1")

        // Explicitly hide terminal panel
        state.setPanelVisible(false)
        assertFalse(state.isPanelVisible)
        assertFalse(state.isInputAllowedForSession("sess-1"))
        assertFalse(ctrl.isPanelActive)
        assertFalse(ctrl.isInputAllowed())
    }

    @Test
    fun testVisibleTerminalInputPolicyGating() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.selectSession("sess-1")
        state.setPanelVisible(true)

        assertTrue(state.isPanelVisible)
        assertTrue(state.isForeground)
        assertTrue(state.isInputAllowedForSession("sess-1"))
        assertTrue(ctrl.isPanelActive)
        assertTrue(ctrl.isInputAllowed())
    }

    @Test
    fun testBackgroundTerminalDropsInput() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.selectSession("sess-1")
        state.setPanelVisible(true)

        // Move app to background
        state.onBackground()
        assertFalse(state.isForeground)
        assertFalse(state.isInputAllowedForSession("sess-1"))
        assertFalse(ctrl.isPanelActive)
        assertFalse(ctrl.isInputAllowed())

        // Foreground app
        state.onForeground()
        assertTrue(state.isForeground)
        assertTrue(state.isInputAllowedForSession("sess-1"))
        assertTrue(ctrl.isPanelActive)
        assertTrue(ctrl.isInputAllowed())
    }

    @Test
    fun testDetachedWidgetsPreservesControllersAndSurfaces() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        val surface = VtTerminalSurface(80, 24)
        state.surfaces["sess-1"] = surface
        state.selectSession("sess-1")
        state.setPanelVisible(true)

        // Detach widgets on Activity rotation or tab switch
        state.detachWidgets()
        assertFalse(state.isPanelVisible)
        assertFalse(ctrl.isPanelActive)

        // Controllers, surfaces, and session maps must remain intact
        assertEquals(ctrl, state.controllers["sess-1"])
        assertEquals(surface, state.surfaces["sess-1"])
        assertFalse(surface.isDisposed)
    }

    @Test
    fun testWriteChannelDropsQueuedInputWhenTerminalHidden() = runTest {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.selectSession("sess-1")
        state.setPanelVisible(false) // Hidden!
        var writeSuccess: Boolean? = null
        var writeUncertain: Boolean? = null
        var writeError: String? = null

        val consumerJob = launch {
            for (item in state.writeChannel) {
                val isEligible = state.isInputAllowedForSession(item.sessionId) &&
                    item.controller.isPanelActive &&
                    item.controller.isInputAllowed()
                if (isEligible) {
                    item.onResult(true, false, null)
                } else {
                    item.onResult(false, false, "Input dropped: terminal panel is not visible or inactive")
                }
            }
        }

        // Submit queued write through writeChannel
        val token = TerminalBindingToken(
            owner = WorkspaceFileOwner("prof-1", "http://127.0.0.1", "dev-user", "test-project"),
            connectionRef = state.connectionRef,
            repositoryIdentity = 1,
            controllerId = "sess-1",
            controllerIncarnation = 1L,
            surfaceEpoch = 1L,
        )
        state.writeChannel.send(
            QueuedWrite(
                sessionId = "sess-1",
                controller = ctrl,
                bytes = "ls\n".encodeToByteArray(),
                epoch = state.activeSessionEpoch,
                incarnation = 1L,
                bindingToken = token,
                commandText = "ls",
                onResult = { ok, uncertain, error ->
                    writeSuccess = ok
                    writeUncertain = uncertain
                    writeError = error
                }
            )
        )
        testScheduler.runCurrent()
        consumerJob.cancel()
        assertEquals(false, writeSuccess)
        assertEquals(false, writeUncertain)
        assertNotNull(writeError)
        assertTrue(writeError!!.contains("dropped"))
    }
    @Test
    fun testAuthorityRevocationDropsInput() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.selectSession("sess-1")
        state.setPanelVisible(true)
        assertTrue(ctrl.isPanelActive)

        // Revoke authority on connection or auth loss
        state.revokeAuthority()
        assertTrue(state.isAuthorityRetired)
        assertFalse(state.isInputAllowedForSession("sess-1"))
        assertFalse(ctrl.isPanelActive)

        // Rebind same profile connection restores authority
        val rebindSuccess = state.rebindAuthority(connection)
        assertTrue(rebindSuccess)
        assertFalse(state.isAuthorityRetired)
        assertTrue(state.isInputAllowedForSession("sess-1"))
        assertTrue(ctrl.isPanelActive)
    }
    @Test
    fun testAttachmentAfterTokenIncrementMatchesAuthoritativeToken() {
        val state = createTerminalState()
        val initialToken = state.attachmentAttemptToken
        val requestToken = ++state.attachmentAttemptToken

        // Dynamic accessor matches the incremented request token
        assertEquals(initialToken + 1, requestToken)
        assertEquals(requestToken, state.attachmentAttemptToken)

        // Predicate evaluating dynamic token succeeds
        val isCurrent = { requestToken == state.attachmentAttemptToken }
        assertTrue(isCurrent())
    }

    @Test
    fun testWritesAfterSessionSelectionDeliveredToActiveSession() = runTest {
        val state = createTerminalState()
        val ctrl1 = state.getOrCreateController("sess-1", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        val ctrl2 = state.getOrCreateController("sess-2", 1L) { id, inc ->
            TerminalSessionController(id, inc, connection)
        }
        state.setPanelVisible(true)

        // 1. Select sess-1
        state.selectSession("sess-1")
        assertEquals("sess-1", state.activeSessionId)
        assertTrue(ctrl1.isPanelActive)
        assertFalse(ctrl2.isPanelActive)

        // 2. Select sess-2
        state.selectSession("sess-2")
        assertEquals("sess-2", state.activeSessionId)
        assertFalse(ctrl1.isPanelActive)
        assertTrue(ctrl2.isPanelActive)
        assertTrue(state.isInputAllowedForSession("sess-2"))
        assertFalse(state.isInputAllowedForSession("sess-1"))
    }

    @Test
    fun testVerifiedSelectionIsMutationOnlyUntilPolicyEffectsRun() {
        val state = createTerminalState()
        val ctrl1 = state.getOrCreateController("sess-1", 1L) { id, inc -> TerminalSessionController(id, inc, connection) }
        val ctrl2 = state.getOrCreateController("sess-2", 2L) { id, inc -> TerminalSessionController(id, inc, connection) }
        state.setPanelVisible(true)
        state.selectSession("sess-1")
        assertTrue(ctrl1.isPanelActive)
        val epoch = state.activeSessionEpoch

        val instance = TerminalAgentsInstanceKey("prof-term-1", "sess-2", 2uL)
        state.commitVerifiedSelection(instance)
        assertEquals("sess-2", state.activeSessionId)
        assertEquals(epoch + 1, state.activeSessionEpoch)
        // Mutation only: controller activity flags are untouched until the post-release policy effects run...
        assertTrue(ctrl1.isPanelActive)
        assertFalse(ctrl2.isPanelActive)
        // ...while the dynamic input predicate already follows the exact selection.
        assertTrue(state.isInputAllowedForSession("sess-2"))
        assertFalse(state.isInputAllowedForSession("sess-1"))
        state.updateAllControllersInputPolicy()
        assertFalse(ctrl1.isPanelActive)
        assertTrue(ctrl2.isPanelActive)

        // Re-committing the already selected terminal changes nothing (same-target callbacks are harmless).
        state.commitVerifiedSelection(instance)
        assertEquals(epoch + 1, state.activeSessionEpoch)
    }

    @Test
    fun testLiveCoverPredicateGatesInputAtTheInputBoundary() {
        val state = createTerminalState()
        val ctrl = state.getOrCreateController("sess-1", 1L) { id, inc -> TerminalSessionController(id, inc, connection) }
        state.selectSession("sess-1")
        state.setPanelVisible(true)
        assertTrue(state.isInputAllowedForSession("sess-1"))
        assertTrue(ctrl.isInputAllowed())

        var covered = false
        state.coverPredicate = { covered }
        covered = true
        assertFalse(state.isInputAllowedForSession("sess-1"))
        assertFalse(ctrl.isInputAllowed(), "an already queued send consults the live cover, not a stale flag")
        covered = false
        assertTrue(ctrl.isInputAllowed())
    }
}
