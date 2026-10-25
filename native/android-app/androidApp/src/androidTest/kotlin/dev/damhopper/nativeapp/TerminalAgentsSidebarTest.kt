package dev.damhopper.nativeapp

import android.view.KeyEvent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.BlockedReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsCounts
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsGroup
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsGroupKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsPresentation
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsProjection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRegistration
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarCallbacks
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarMode
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsSidebarUiState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.ui.components.TerminalAgentsSidebar
import dev.damhopper.nativeapp.ui.theme.NativeTheme
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Compose UI tests for the controlled Agents sidebar. The host here is a rendered fixture only: it supplies
 * immutable Phase01 UI models and records callbacks. It proves component semantics/interaction, not
 * MainActivity, server or activation lifecycle behavior.
 */
@RunWith(AndroidJUnit4::class)
class TerminalAgentsSidebarTest {

    @get:Rule
    val rule = createComposeRule()

    private val ui = mutableStateOf(emptyUiState())
    private val mode = mutableStateOf(TerminalAgentsSidebarMode.PINNED)
    private val visible = mutableStateOf(true)
    private val recorder = Recorder()

    /** Hosts the sidebar; filter changes are applied back like a real controlled host would. */
    private fun show(
        state: TerminalAgentsSidebarUiState,
        sidebarMode: TerminalAgentsSidebarMode = TerminalAgentsSidebarMode.PINNED,
    ) {
        ui.value = state
        mode.value = sidebarMode
        val callbacks = TerminalAgentsSidebarCallbacks(
            onGroupClick = { recorder.groupClicks += it },
            onFilterChange = {
                recorder.filters += it
                ui.value = ui.value.copy(selection = it)
            },
            onRefresh = { recorder.refreshes++ },
            onOpenSettings = { recorder.settings++ },
            onDismiss = { recorder.dismisses++ },
            onPopupVisibilityChanged = { recorder.popupEvents += it },
        )
        rule.setContent {
            NativeTheme {
                Box(Modifier.fillMaxSize()) {
                    if (visible.value) {
                        TerminalAgentsSidebar(
                            state = ui.value,
                            mode = mode.value,
                            callbacks = callbacks,
                            modifier = Modifier.width(280.dp).fillMaxHeight(),
                        )
                    }
                }
            }
        }
    }

    private fun row(project: String, profile: String): SemanticsNodeInteraction =
        rule.onNode(hasClickAction() and hasText(project) and hasText("Profile: $profile"))

    private fun openFilterMenu() {
        rule.onNodeWithTag(FILTER_TRIGGER_TAG).performClick()
        rule.waitForIdle()
    }

    private fun pressBack() {
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        rule.waitForIdle()
    }

    // ---- Content in both modes ----------------------------------------------------------------------

    @Test
    fun pinnedModeShowsHeadingCountControlsAndNoDismiss() {
        val fixture = multiProfileFixture()
        show(uiState(fixture))

        rule.onNodeWithText("Agents").assertExists()
        rule.onNodeWithTag(COUNT_TAG).assertTextEquals("${fixture.rows.size}")
        rule.onNodeWithTag(COUNT_TAG).assertContentDescriptionEquals("${fixture.rows.size} eligible terminals")
        rule.onNodeWithContentDescription("Refresh agents").assertIsEnabled()
        rule.onNodeWithContentDescription("Agent settings").assertIsEnabled()
        rule.onNodeWithTag(FILTER_TRIGGER_TAG).assertExists()
        rule.onNodeWithContentDescription("Close Agents").assertDoesNotExist()
        rule.onNodeWithTag("$SIDEBAR_TAG_PREFIX${TerminalAgentsSidebarMode.PINNED.name}").assertExists()

        row("alpha", "Local").assertExists()
        row("alpha", "Remote").assertExists()
    }

    @Test
    fun sheetModeShowsDismissAndSameRowsWithoutDismissingOnGroupClick() {
        val fixture = multiProfileFixture()
        show(uiState(fixture), TerminalAgentsSidebarMode.SHEET)

        rule.onNodeWithTag("$SIDEBAR_TAG_PREFIX${TerminalAgentsSidebarMode.SHEET.name}").assertExists()
        row("alpha", "Remote").performScrollTo().performClick()
        assertEquals(0, recorder.dismisses, "group click must not dismiss the sheet")
        assertEquals(1, recorder.groupClicks.size)

        rule.onNodeWithContentDescription("Close Agents").performClick()
        assertEquals(1, recorder.dismisses)
    }

    @Test
    fun switchingBetweenPinnedAndSheetKeepsContentUsable() {
        val fixture = multiProfileFixture()
        show(uiState(fixture))
        rule.onNodeWithContentDescription("Close Agents").assertDoesNotExist()

        mode.value = TerminalAgentsSidebarMode.SHEET
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Close Agents").assertExists()
        row("alpha", "Local").assertExists()

        mode.value = TerminalAgentsSidebarMode.PINNED
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Close Agents").assertDoesNotExist()
        row("alpha", "Local").assertExists()
    }

    @Test
    fun refreshAndSettingsCallbacksAreIndependent() {
        show(uiState(multiProfileFixture()), TerminalAgentsSidebarMode.SHEET)

        rule.onNodeWithContentDescription("Refresh agents").performClick()
        assertEquals(1, recorder.refreshes)
        assertEquals(0, recorder.settings)

        rule.onNodeWithContentDescription("Agent settings").performClick()
        assertEquals(1, recorder.refreshes)
        assertEquals(1, recorder.settings)
        assertEquals(0, recorder.dismisses)
        assertTrue(recorder.popupEvents.isEmpty(), "Settings/refresh must not report popup visibility")
    }

    // ---- Group semantics ----------------------------------------------------------------------------

    @Test
    fun groupRowsExposeProjectProfileStatusReasonCountHarnessAndSourceAsText() {
        show(uiState(multiProfileFixture()))

        row("alpha", "Local").performScrollTo().apply {
            assertTextContains("Needs attention")
            assertTextContains("Reason: Approval")
            assertTextContains("2 agents")
            assertTextContains("Harness: OMP, Codex")
            assertTextContains("Source: Lifecycle observation")
        }
        row("alpha", "Remote").performScrollTo().apply {
            assertTextContains("Working")
            assertTextContains("1 agent")
            assertTextContains("Harness: Claude")
            assertTextContains("Source: Hook observation")
        }
        row("delta", "Local").performScrollTo().assertTextContains("Reason: Question")
        row("beta", "Remote").performScrollTo().assertTextContains("Reason: Error")
        row("zeta", "Local").performScrollTo().assertTextContains("Unavailable")
        row("eta", "Local").performScrollTo().assertTextContains("Platform unqualified")
        row("theta", "Local").performScrollTo().assertTextContains("Unsupported")
        row("delta", "Remote").performScrollTo().assertTextContains("Unknown")
    }

    @Test
    fun equalTerminalIdsInDifferentProfilesStayDistinctGroups() {
        val fixture = multiProfileFixture()
        show(uiState(fixture))

        // r1 (Local) and r3 (Remote) both use terminal id "term-1" incarnation 1.
        row("alpha", "Local").performScrollTo().performClick()
        row("alpha", "Remote").performScrollTo().performClick()

        assertEquals(2, recorder.groupClicks.size)
        assertEquals("profile-local", recorder.groupClicks[0].workspace.profileId)
        assertEquals("profile-remote", recorder.groupClicks[1].workspace.profileId)
        assertEquals(fixture.groupFor("profile-local", "alpha").key, recorder.groupClicks[0])
        assertEquals(fixture.groupFor("profile-remote", "alpha").key, recorder.groupClicks[1])
    }

    @Test
    fun profileLabelsOnlyAppearWhenMultipleProfilesAreObserved() {
        val single = singleProfileFixture()
        show(uiState(single))

        rule.onNode(hasClickAction() and hasText("solo")).assertExists()
        rule.onAllNodesWithText("Profile: Local").assertCountEquals(0)
    }

    @Test
    fun unanimousDoneShowsSecondaryTextAndMixedDoesNot() {
        show(uiState(multiProfileFixture()))

        rule.onAllNodesWithText("Done (turn ended)").assertCountEquals(1)
        row("gamma", "Remote").performScrollTo().assertTextContains("Done (turn ended)")
        // beta/Local mixes a Done and a non-Done idle terminal: plain Idle, no Done claim.
        row("beta", "Local").performScrollTo().apply {
            assertTextContains("Idle")
            assertTextContains("2 agents")
        }
    }

    @Test
    fun hookCoverageHintAndLifecycleSourcesAreVisible() {
        show(uiState(multiProfileFixture()))

        rule.onAllNodesWithText(HOOK_HINT).assertCountEquals(2)
        row("alpha", "Remote").performScrollTo().assertTextContains(HOOK_HINT)
        row("beta", "Local").performScrollTo()
            .assertTextContains("Source: Lifecycle observation, Hook observation")
        // Lifecycle-only group carries no limited-coverage hint.
        row("gamma", "Remote").performScrollTo()
        rule.onNode(hasClickAction() and hasText("gamma") and hasText(HOOK_HINT)).assertDoesNotExist()
    }

    @Test
    fun activeTerminalIsMarkedSelectedWithTextForTheMatchingProfileOnly() {
        val fixture = multiProfileFixture()
        // Same terminal id "term-1" exists in both profiles; only profile-local is active.
        show(uiState(fixture, active = TerminalAgentsInstanceKey("profile-local", "term-1", 1uL)))

        row("alpha", "Local").performScrollTo().apply {
            assertIsSelected()
            assertTextContains("Current terminal")
        }
        row("alpha", "Remote").performScrollTo().assertIsNotSelected()
        rule.onAllNodesWithText("Current terminal").assertCountEquals(1)
    }

    // ---- Activation pending ------------------------------------------------------------------------

    @Test
    fun pendingActivationDisablesRowsSoSecondClickCannotSubmit() {
        val fixture = multiProfileFixture()
        show(uiState(fixture), TerminalAgentsSidebarMode.SHEET)

        row("alpha", "Local").performScrollTo().assertIsEnabled().performClick()
        assertEquals(1, recorder.groupClicks.size)

        // The host marks the request pending after the first click.
        ui.value = ui.value.copy(activationPending = true)
        rule.waitForIdle()

        rule.onNodeWithText("Opening terminal\u2026").assertExists()
        // Real pointer taps (not semantic invocation) on disabled rows must not reach the callback.
        row("alpha", "Local").performScrollTo().assertIsNotEnabled().performTouchInput { click() }
        row("alpha", "Remote").performScrollTo().assertIsNotEnabled().performTouchInput { click() }
        assertEquals(1, recorder.groupClicks.size, "pending activation must not accept another group click")
        assertEquals(0, recorder.dismisses)

        // Settings and refresh remain independent of the pending activation.
        rule.onNodeWithContentDescription("Agent settings").performClick()
        assertEquals(1, recorder.settings)
    }

    // ---- Empty / loading / notices -------------------------------------------------------------------

    @Test
    fun noObservedAgentsIsDistinctFromFilteredEmpty() {
        show(uiState(emptyFixture()))

        rule.onNodeWithText("No observed agents").assertExists()
        rule.onNodeWithText("No matching filter").assertDoesNotExist()
        rule.onNodeWithTag(COUNT_TAG).assertTextEquals("0")
    }

    @Test
    fun filterMatchesNoneShowsFilteredEmptyAndShowAllResetsFilter() {
        val fixture = filteredEmptyFixture()
        show(uiState(fixture, selection = TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.IDLE))))

        rule.onNodeWithText("No matching filter").assertExists()
        rule.onNodeWithText("No observed agents").assertDoesNotExist()
        rule.onNodeWithTag(COUNT_TAG).assertTextEquals("${fixture.rows.size}")
        rule.onNodeWithText("Showing 0 of ${fixture.rows.size}").assertExists()

        rule.onNodeWithContentDescription("Show all").performClick()
        assertEquals(listOf<TerminalAgentsFilterSelection>(TerminalAgentsFilterSelection.All), recorder.filters)
    }

    @Test
    fun loadingIsVisibleAndDoesNotClaimNoObservedAgents() {
        show(uiState(emptyFixture(), loading = true))

        rule.onNodeWithText("Refreshing agents\u2026").assertExists()
        rule.onNodeWithText("No observed agents").assertDoesNotExist()

        ui.value = ui.value.copy(loading = false)
        rule.waitForIdle()
        rule.onNodeWithText("Refreshing agents\u2026").assertDoesNotExist()
        rule.onNodeWithText("No observed agents").assertExists()
    }

    @Test
    fun loadingKeepsExistingRowsVisible() {
        show(uiState(multiProfileFixture(), loading = true))

        rule.onNodeWithText("Refreshing agents\u2026").assertExists()
        row("alpha", "Local").assertExists()
    }

    @Test
    fun refreshNoticeIsVisibleWithRetryAndRowsStayAvailable() {
        show(uiState(multiProfileFixture(), notice = "Agent status unavailable. Check the connection and retry."))

        rule.onNodeWithText("Agent status unavailable. Check the connection and retry.").assertExists()
        row("alpha", "Local").assertExists()

        rule.onNodeWithContentDescription("Retry refreshing agents").performClick()
        assertEquals(1, recorder.refreshes)
    }

    @Test
    fun unsupportedNoticeAndUnsupportedGroupAreVisibleTogether() {
        val rows = listOf(
            fixtureRow("profile-local", "Local", "legacy", "term-9", TerminalAgentsStatus.UNSUPPORTED),
        )
        show(
            uiState(
                fixtureOf(rows),
                notice = "Agent observation is unsupported by this server.",
            ),
        )

        rule.onNodeWithText("Agent observation is unsupported by this server.").assertExists()
        rule.onNode(hasClickAction() and hasText("legacy")).assertTextContains("Unsupported")
    }

    @Test
    fun explicitRefusalNoticeKeepsSheetOpen() {
        show(
            uiState(multiProfileFixture(), notice = "Terminal state is busy. Try again."),
            TerminalAgentsSidebarMode.SHEET,
        )

        rule.onNodeWithText("Terminal state is busy. Try again.").assertExists()
        row("alpha", "Local").performScrollTo().performClick()
        assertEquals(0, recorder.dismisses)
        rule.onNodeWithText("Terminal state is busy. Try again.").assertExists()
    }

    // ---- Filter menu -------------------------------------------------------------------------------

    @Test
    fun filterMenuListsAllStatusesWithCountsAndAllIsInitiallyOn() {
        val fixture = multiProfileFixture()
        show(uiState(fixture))

        openFilterMenu()

        rule.onNodeWithTag(FILTER_ALL_TAG).assertIsOn().apply {
            assertTextContains("All statuses")
            assertTextContains("${fixture.rows.size}")
        }
        TerminalAgentsStatus.entries.forEach { status ->
            val node = rule.onNodeWithTag("$FILTER_OPTION_TAG_PREFIX${status.name}")
            node.assertIsOff()
            node.assertTextContains(statusLabel(status))
            node.assertTextContains("${fixture.countOf(status)}")
        }
    }

    @Test
    fun filterMenuTogglesCanonicalMultiSelectAndResetsToAll() {
        show(uiState(multiProfileFixture()))
        openFilterMenu()

        // All -> isolates to one status.
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.WORKING)).performScrollTo().performClick()
        rule.waitForIdle()
        // Selecting an earlier-ordered status yields canonical enum order, not click order.
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.NEEDS_ATTENTION)).performScrollTo().performClick()
        rule.waitForIdle()
        // Toggling one off keeps the remainder.
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.WORKING)).performScrollTo().performClick()
        rule.waitForIdle()
        // Toggling the last one off resets to All.
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.NEEDS_ATTENTION)).performScrollTo().performClick()
        rule.waitForIdle()

        assertEquals(
            listOf(
                TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.WORKING)),
                TerminalAgentsFilterSelection.Selected(
                    listOf(TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.WORKING),
                ),
                TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.NEEDS_ATTENTION)),
                TerminalAgentsFilterSelection.All,
            ),
            recorder.filters,
        )
        // Menu stayed open through the toggles: exactly one visibility report.
        assertEquals(listOf(true), recorder.popupEvents)
    }

    @Test
    fun filterMenuReflectsControlledSelectionAndAllOptionClearsIt() {
        val selection = TerminalAgentsFilterSelection.Selected(
            listOf(TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.IDLE),
        )
        show(uiState(multiProfileFixture(), selection = selection))
        rule.onNodeWithContentDescription(
            "Filter agents by status: Needs attention, Idle",
        ).assertExists()
        rule.onNodeWithText("Showing", substring = true).assertExists()

        openFilterMenu()
        rule.onNodeWithTag(FILTER_ALL_TAG).assertIsOff()
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.NEEDS_ATTENTION)).assertIsOn()
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.IDLE)).assertIsOn()
        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.WORKING)).assertIsOff()

        rule.onNodeWithTag(FILTER_ALL_TAG).performClick()
        rule.waitForIdle()
        assertEquals(listOf<TerminalAgentsFilterSelection>(TerminalAgentsFilterSelection.All), recorder.filters)
        rule.onNodeWithTag(FILTER_ALL_TAG).assertIsOn()
    }

    @Test
    fun selectingTheLastMissingStatusNormalizesAllSevenToAll() {
        val allButUnsupported = TerminalAgentsStatus.entries.filter { it != TerminalAgentsStatus.UNSUPPORTED }
        show(
            uiState(
                multiProfileFixture(),
                selection = TerminalAgentsFilterSelection.Selected(allButUnsupported),
            ),
        )
        openFilterMenu()

        rule.onNodeWithTag(optionTag(TerminalAgentsStatus.UNSUPPORTED)).performScrollTo().performClick()
        rule.waitForIdle()

        assertEquals(listOf<TerminalAgentsFilterSelection>(TerminalAgentsFilterSelection.All), recorder.filters)
    }

    // ---- Popup visibility reporting -------------------------------------------------------------------

    @Test
    fun popupVisibilityIsBalancedWhenDismissedWithBack() {
        show(uiState(multiProfileFixture()))
        assertTrue(recorder.popupEvents.isEmpty(), "closed menu must not report")

        openFilterMenu()
        assertEquals(listOf(true), recorder.popupEvents)
        rule.onNodeWithTag(FILTER_ALL_TAG).assertExists()

        pressBack()
        assertEquals(listOf(true, false), recorder.popupEvents)
        rule.onNodeWithTag(FILTER_ALL_TAG).assertDoesNotExist()
        assertEquals(0, recorder.dismisses, "owned popup consumes dismissal; sidebar itself is not dismissed")
    }

    @Test
    fun popupVisibilityReopenIsBalancedAndDisposalWhileOpenReportsClose() {
        show(uiState(multiProfileFixture()), TerminalAgentsSidebarMode.SHEET)

        openFilterMenu()
        pressBack()
        openFilterMenu()
        assertEquals(listOf(true, false, true), recorder.popupEvents)

        // Sidebar leaves composition while its popup is open (e.g. sheet replaced by the host).
        visible.value = false
        rule.waitForIdle()
        assertEquals(listOf(true, false, true, false), recorder.popupEvents)
        rule.onNodeWithTag(FILTER_ALL_TAG).assertDoesNotExist()
    }

    // ---- Fixtures --------------------------------------------------------------------------------------

    private class Recorder {
        val groupClicks = mutableListOf<TerminalAgentsGroupKey>()
        val filters = mutableListOf<TerminalAgentsFilterSelection>()
        val popupEvents = mutableListOf<Boolean>()
        var refreshes = 0
        var settings = 0
        var dismisses = 0
    }

    private class Fixture(val rows: List<TerminalAgentsRow>, val groups: List<TerminalAgentsGroup>) {
        fun groupFor(profileId: String, project: String): TerminalAgentsGroup =
            groups.single { it.key.workspace.profileId == profileId && it.key.workspace.project == project }

        fun countOf(status: TerminalAgentsStatus): Int = rows.count { it.presentation.status == status }
    }

    private fun emptyUiState(): TerminalAgentsSidebarUiState = uiState(emptyFixture())

    private fun uiState(
        fixture: Fixture,
        selection: TerminalAgentsFilterSelection = TerminalAgentsFilterSelection.All,
        loading: Boolean = false,
        notice: String? = null,
        active: TerminalAgentsInstanceKey? = null,
        pending: Boolean = false,
    ): TerminalAgentsSidebarUiState {
        val byStatus = TerminalAgentsStatus.entries.associateWith { fixture.countOf(it) }
        return TerminalAgentsSidebarUiState(
            projection = TerminalAgentsProjection(
                rows = fixture.rows,
                groups = fixture.groups,
                counts = TerminalAgentsCounts(all = fixture.rows.size, byStatus = byStatus),
                filteredCount = fixture.groups.sumOf { it.members.size },
            ),
            selection = selection,
            loading = loading,
            notice = notice,
            active = active,
            activationPending = pending,
        )
    }

    private fun emptyFixture() = Fixture(emptyList(), emptyList())

    /** Rows exist but the supplied (already filtered) groups are empty: filter matches none. */
    private fun filteredEmptyFixture(): Fixture {
        val rows = listOf(
            fixtureRow("profile-local", "Local", "alpha", "term-1", TerminalAgentsStatus.WORKING),
            fixtureRow("profile-local", "Local", "beta", "term-2", TerminalAgentsStatus.WORKING),
            fixtureRow("profile-local", "Local", "gamma", "term-3", TerminalAgentsStatus.UNKNOWN),
        )
        return Fixture(rows, emptyList())
    }

    private fun singleProfileFixture() = fixtureOf(
        listOf(fixtureRow("profile-local", "Local", "solo", "term-1", TerminalAgentsStatus.WORKING)),
    )

    /** Groups rows by (owner,status,reason) in first-encounter order, mirroring the contract group shape. */
    private fun fixtureOf(rows: List<TerminalAgentsRow>): Fixture {
        val groups = rows
            .groupBy { Triple(it.target.registration.owner, it.presentation.status, it.presentation.reason) }
            .map { (_, members) -> fixtureGroup(members) }
        return Fixture(rows, groups)
    }

    private fun multiProfileFixture(): Fixture = fixtureOf(
        listOf(
            // alpha/Local: needs attention (approval), two harnesses.
            fixtureRow(
                "profile-local", "Local", "alpha", "term-1", TerminalAgentsStatus.NEEDS_ATTENTION,
                reason = BlockedReason.APPROVAL, kind = AgentKind.OMP,
            ),
            fixtureRow(
                "profile-local", "Local", "alpha", "term-2", TerminalAgentsStatus.NEEDS_ATTENTION,
                reason = BlockedReason.APPROVAL, kind = AgentKind.CODEX,
            ),
            // alpha/Remote: same terminal id "term-1" as alpha/Local, hook coverage.
            fixtureRow(
                "profile-remote", "Remote", "alpha", "term-1", TerminalAgentsStatus.WORKING,
                kind = AgentKind.CLAUDE, source = AgentObservationSource.HOOK, hint = HOOK_HINT,
            ),
            // beta/Local: mixed Done.
            fixtureRow(
                "profile-local", "Local", "beta", "term-3", TerminalAgentsStatus.IDLE,
                kind = AgentKind.OMP, done = true,
            ),
            fixtureRow(
                "profile-local", "Local", "beta", "term-4", TerminalAgentsStatus.IDLE,
                kind = AgentKind.CLAUDE, source = AgentObservationSource.HOOK, hint = HOOK_HINT,
            ),
            // gamma/Remote: unanimous Done.
            fixtureRow(
                "profile-remote", "Remote", "gamma", "term-5", TerminalAgentsStatus.IDLE,
                kind = AgentKind.CODEX, done = true,
            ),
            fixtureRow("profile-remote", "Remote", "delta", "term-6", TerminalAgentsStatus.UNKNOWN),
            fixtureRow(
                "profile-local", "Local", "delta", "term-7", TerminalAgentsStatus.NEEDS_ATTENTION,
                reason = BlockedReason.QUESTION,
            ),
            fixtureRow(
                "profile-remote", "Remote", "beta", "term-8", TerminalAgentsStatus.NEEDS_ATTENTION,
                reason = BlockedReason.ERROR,
            ),
            fixtureRow("profile-local", "Local", "zeta", "term-10", TerminalAgentsStatus.UNAVAILABLE),
            fixtureRow("profile-local", "Local", "eta", "term-11", TerminalAgentsStatus.PLATFORM_UNQUALIFIED),
            fixtureRow("profile-local", "Local", "theta", "term-12", TerminalAgentsStatus.UNSUPPORTED),
        ),
    )

    private fun fixtureRow(
        profileId: String,
        profileLabel: String,
        project: String,
        terminalId: String,
        status: TerminalAgentsStatus,
        reason: BlockedReason? = null,
        kind: AgentKind = AgentKind.OMP,
        source: AgentObservationSource = AgentObservationSource.LIFECYCLE,
        done: Boolean = false,
        hint: String? = null,
    ): TerminalAgentsRow {
        val owner = WorkspaceFileOwner(
            profileId = profileId,
            baseUrl = ENDPOINT,
            accountUser = "dev-user",
            project = project,
        )
        val connection = ConnectionRef(profileId, 1L)
        val runtime = TerminalAgentsRuntimeKey(
            connection = connection,
            socket = SocketInstanceRef(connection, "sock-1"),
            attachmentIncarnation = 1L,
            endpoint = ENDPOINT,
            accountUser = "dev-user",
        )
        return TerminalAgentsRow(
            target = TerminalAgentsTarget(
                registration = TerminalAgentsRegistration(owner, registrationId = 1L, order = 1L),
                runtime = runtime,
                instance = TerminalAgentsInstanceKey(profileId, terminalId, 1uL),
                serverEpoch = 1uL,
                statusAuthorityRevision = 1L,
            ),
            projectLabel = project,
            profileLabel = profileLabel,
            terminalTitle = terminalId,
            agentKind = kind,
            presentation = TerminalAgentsPresentation(
                status = status,
                reason = reason,
                doneTurnEnded = done,
                source = source,
                coverageHint = hint,
            ),
        )
    }

    private fun fixtureGroup(members: List<TerminalAgentsRow>): TerminalAgentsGroup {
        val first = members.first()
        return TerminalAgentsGroup(
            key = TerminalAgentsGroupKey(
                workspace = first.target.registration.owner,
                status = first.presentation.status,
                reason = first.presentation.reason,
            ),
            projectLabel = first.projectLabel,
            profileLabel = first.profileLabel,
            members = members,
            agentKinds = AgentKind.entries.filter { kind -> members.any { it.agentKind == kind } },
            sources = AgentObservationSource.entries.filter { source ->
                members.any { it.presentation.source == source }
            },
            coverageHints = members.mapNotNull { it.presentation.coverageHint }.distinct(),
            doneTurnEnded = members.all { it.presentation.doneTurnEnded },
        )
    }

    private fun optionTag(status: TerminalAgentsStatus) = "$FILTER_OPTION_TAG_PREFIX${status.name}"

    private fun statusLabel(status: TerminalAgentsStatus): String = when (status) {
        TerminalAgentsStatus.NEEDS_ATTENTION -> "Needs attention"
        TerminalAgentsStatus.WORKING -> "Working"
        TerminalAgentsStatus.IDLE -> "Idle"
        TerminalAgentsStatus.UNKNOWN -> "Unknown"
        TerminalAgentsStatus.UNAVAILABLE -> "Unavailable"
        TerminalAgentsStatus.PLATFORM_UNQUALIFIED -> "Platform unqualified"
        TerminalAgentsStatus.UNSUPPORTED -> "Unsupported"
    }

    private companion object {
        const val ENDPOINT = "http://127.0.0.1:8787"
        const val HOOK_HINT =
            "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)"
        const val COUNT_TAG = "terminal-agents-count"
        const val FILTER_TRIGGER_TAG = "terminal-agents-filter-trigger"
        const val FILTER_ALL_TAG = "terminal-agents-filter-option:all"
        const val FILTER_OPTION_TAG_PREFIX = "terminal-agents-filter-option:"
        const val SIDEBAR_TAG_PREFIX = "terminal-agents-sidebar:"
    }
}
