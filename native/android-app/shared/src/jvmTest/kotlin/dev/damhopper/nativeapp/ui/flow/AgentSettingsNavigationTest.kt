package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.settings.PreferenceSourceStatus
import dev.damhopper.nativeapp.features.settings.SettingsBinding
import dev.damhopper.nativeapp.features.settings.SettingsOwnerResolver
import dev.damhopper.nativeapp.features.settings.SettingsRepository
import dev.damhopper.nativeapp.features.settings.SettingsSourceTargetState
import dev.damhopper.nativeapp.features.settings.ShortcutAction
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationReceipt
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsActivationResult
import dev.damhopper.nativeapp.ui.components.AgentsSheetCloseGate
import dev.damhopper.nativeapp.ui.components.TerminalAgentsHostState
import dev.damhopper.nativeapp.ui.screens.agentsSheetConsumesShortcut
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Contextual Agents Settings (captured target workspace server B, independent of preference source A) and the root
 * cover/exclusivity record of the Agents sidebar. These use the real state holders, not duplicated formulas.
 */
class AgentSettingsNavigationTest {

    private val noResolver = object : SettingsOwnerResolver {
        override suspend fun current(profileId: String): SettingsBinding? = null
        override fun currentSnapshot(profileId: String): SettingsBinding? = null
    }

    private fun terminalFlow() = AppFlowNavigation(
        AppFlowState(
            stage = AppFlowStage.TERMINAL,
            activeProfileId = "B",
            activeProject = "proj",
            activeSessionId = "term-1",
        ),
    )

    // ---- Settings target B / source A ----

    @Test
    fun capturedTargetBIsIndependentOfPreferenceSourceAAndKeepsTheOrigin() {
        val scope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
        try {
            val store = InMemoryPreferencesStore(
                initialSourceTargetState = SettingsSourceTargetState(
                    preferencesProfileId = "A",
                    preferencesStatus = PreferenceSourceStatus.ACTIVE,
                    settingsProfileId = "A",
                ),
            )
            val repository = SettingsRepository(store, noResolver, scope, debounceMillis = 20L, invalidateRuntime = {})
            val nav = terminalFlow()
            val before = nav.state.value

            repository.setSettingsTarget("B")
            nav.openAgentSettings(SettingsOrigin(AppFlowStage.TERMINAL, panel = "TERMINAL", sessionId = "term-1"), "B")

            assertEquals("B", repository.sourceTargetState.value.settingsProfileId, "the selected target is B")
            assertEquals("A", repository.sourceTargetState.value.preferencesProfileId, "source A is untouched")
            val overlay = nav.state.value.settings
            assertEquals("HOST", overlay?.subSection)
            assertEquals("AGENTS", overlay?.hostSection)
            assertEquals("B", overlay?.targetProfileId)
            // The retained workspace route, project and session never moved.
            assertEquals(before.stage, nav.state.value.stage)
            assertEquals(before.activeProject, nav.state.value.activeProject)
            assertEquals(before.activeSessionId, nav.state.value.activeSessionId)

            // Back closes Settings first and lands on the captured origin with the same route.
            assertTrue(nav.handleBackPress())
            assertNull(nav.state.value.settings)
            assertEquals(before.copy(), nav.state.value)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun mismatchedTargetServicesStayBlockedUntilSelectedTargetAndExactOwnerMatch() {
        val connection = ConnectionRef("B", 2L)
        val overlay = SettingsOverlay(
            origin = SettingsOrigin(AppFlowStage.TERMINAL),
            subSection = "HOST",
            hostSection = "AGENTS",
            targetProfileId = "B",
            intent = 1L,
        )
        // Exact: B selected, the service owner is the registry-current connection of B and its account.
        assertTrue(overlay.targetServicesReady("B", connection, "alice", connection, "alice"))
        // Queued selection of B has not been applied yet: still source/target A.
        assertFalse(overlay.targetServicesReady("A", connection, "alice", connection, "alice"))
        // No services, a stale/foreign owner generation or another account never qualify.
        assertFalse(overlay.targetServicesReady("B", null, null, connection, "alice"))
        assertFalse(overlay.targetServicesReady("B", ConnectionRef("B", 1L), "alice", connection, "alice"))
        assertFalse(overlay.targetServicesReady("B", ConnectionRef("C", 2L), "alice", connection, "alice"))
        assertFalse(overlay.targetServicesReady("B", connection, "mallory", connection, "alice"))
        assertFalse(overlay.targetServicesReady("B", connection, "alice", null, "alice"))
        // Plain Settings (no captured target) keeps the existing selected-target behaviour.
        assertTrue(overlay.copy(targetProfileId = null).targetServicesReady("A", null, null, null, null))
    }

    // ---- cover / exclusivity ----

    @Test
    fun agentsOpenIsRefusedWhileAnyForeignCoverIsActiveAndNeverClosesAnotherSurface() {
        val host = TerminalAgentsHostState()
        // search / pending departure / Settings / privacy all arrive as the root's external cover
        host.setExternalCover(true)
        assertFalse(host.canOpen)
        assertFalse(host.requestOpen())
        assertFalse(host.open)
        assertTrue(host.effectiveCover, "the external cover itself stays in force")
        host.setExternalCover(false)

        // a local terminal modal blocks it too, and only its own owner clears it
        val createDialog = Any()
        val killDialog = Any()
        host.setLocalCover(createDialog, true)
        host.setLocalCover(killDialog, true)
        assertFalse(host.requestOpen())
        host.setLocalCover(createDialog, false)
        assertTrue(host.localCover, "another owner's modal is not cleared by a disposed child")
        assertFalse(host.requestOpen())
        host.setLocalCover(killDialog, false)
        assertFalse(host.localCover)
        assertTrue(host.requestOpen())
        assertTrue(host.open)
    }

    @Test
    fun compactSheetIsACoverWhilePinnedIsNotAndUnknownWidthIsConservative() {
        val host = TerminalAgentsHostState(initialOpen = true) // restored after rotation, width unmeasured
        assertTrue(host.compactSheetOpen, "an unmeasured open host covers conservatively")
        assertTrue(host.effectiveCover)

        host.setPinned(true)
        assertFalse(host.compactSheetOpen)
        assertFalse(host.effectiveCover, "a pinned sidebar is not a cover")
        assertFalse(host.closeCompactSheet(), "Back is not consumed by a pinned sidebar")
        assertTrue(host.open)

        host.setPinned(false)
        assertTrue(host.compactSheetOpen)
        assertTrue(host.effectiveCover)
        assertTrue(host.closeCompactSheet(), "Back closes the compact sheet before any route Back")
        assertFalse(host.open)
        assertFalse(host.effectiveCover)
    }

    @Test
    fun resizeOverlapNeverLeavesAnUncoveredFrameAndKeepsHigherCovers() {
        val host = TerminalAgentsHostState()
        host.setPinned(true)
        assertTrue(host.requestOpen())
        assertFalse(host.effectiveCover)

        // Settings opens over the pinned sidebar, then the window shrinks so the sidebar becomes a compact sheet.
        host.setExternalCover(true)
        assertTrue(host.effectiveCover)
        host.setPinned(false)
        assertTrue(host.effectiveCover)
        // Settings closes: the compact sheet still covers - there is never a gap with the terminal focusable.
        host.setExternalCover(false)
        assertTrue(host.effectiveCover, "the compact sheet replaces the Settings cover without a gap")

        // Growing back to pinned does not clear a higher cover.
        host.setExternalCover(true)
        host.setPinned(true)
        assertTrue(host.effectiveCover, "resize never clears Settings/search/departure/local cover")
        host.setExternalCover(false)
        assertFalse(host.effectiveCover)
    }

    @Test
    fun sidebarPopupIsAnOwnedCoverClearedWithTheSurface() {
        val host = TerminalAgentsHostState()
        host.setPinned(true)
        host.requestOpen()
        host.setPopupVisible(true)
        assertTrue(host.effectiveCover)
        host.setPopupVisible(false)
        assertFalse(host.effectiveCover)
        host.setPopupVisible(true)
        host.close()
        assertFalse(host.popupVisible, "closing the surface drops its popup source")
        assertFalse(host.effectiveCover)
    }

    @Test
    fun compactSheetConsumesSearchPanelAndProjectsShortcutsButNotFontOrPrivacy() {
        val routes = listOf(
            ShortcutAction.SEARCH_TEXT,
            ShortcutAction.SEARCH_FILENAME,
            ShortcutAction.FILE_PANEL,
            ShortcutAction.REVEAL_ACTIVE_FILE,
            ShortcutAction.PROJECT_PANEL,
        )
        routes.forEach {
            assertTrue(agentsSheetConsumesShortcut(true, it), "$it must not route under the compact sheet")
            assertFalse(agentsSheetConsumesShortcut(false, it), "$it is untouched without the sheet")
        }
        assertFalse(agentsSheetConsumesShortcut(true, ShortcutAction.COGNITO), "privacy dismissal still works")
        assertFalse(agentsSheetConsumesShortcut(true, ShortcutAction.TERMINAL_FONT_INCREASE))
    }

    // ---- sheet close gate ----

    @Test
    fun theOriginSheetClosesOnlyForItsOwnCommittedRequest() {
        val gate = AgentsSheetCloseGate()
        fun committed(id: Long) = TerminalAgentsActivationReceipt(id, TerminalAgentsActivationResult.Committed)
        fun refused(id: Long) = TerminalAgentsActivationReceipt(id, TerminalAgentsActivationResult.Refused("no"))

        // nothing tracked: no close
        assertFalse(gate.shouldClose(committed(1)))

        gate.begin(7)
        assertFalse(gate.shouldClose(null))
        assertFalse(gate.shouldClose(committed(8)), "another request's commit never closes this sheet")
        assertFalse(gate.shouldClose(TerminalAgentsActivationReceipt(7, TerminalAgentsActivationResult.Deferred(7))))
        assertTrue(gate.shouldClose(committed(7)))
        assertFalse(gate.shouldClose(committed(7)), "a receipt closes at most once")

        gate.begin(9)
        assertFalse(gate.shouldClose(refused(9)), "a refusal keeps the sheet open")
        assertFalse(gate.shouldClose(committed(9)), "a refused request cannot later commit")
    }
}
