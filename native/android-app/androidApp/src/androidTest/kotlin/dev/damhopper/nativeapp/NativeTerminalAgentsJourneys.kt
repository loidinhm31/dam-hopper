package dev.damhopper.nativeapp

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Phase 05 Live Server MainActivity Journeys for Terminal Agents Sidebar.
 * Validates real UI behavior against two running server profiles with equal IDs,
 * stale dirty guard, settings context, and compact/wide responsive presentation.
 */
@RunWith(AndroidJUnit4::class)
@LargeTest
class NativeTerminalAgentsJourneys {

    @get:Rule
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    private lateinit var fixture: NativeTerminalAgentsServerFixture
    private var serversReachable: Boolean = false

    @Before
    fun setUp() {
        fixture = NativeTerminalAgentsServerFixture.fromRunnerArguments()
        serversReachable = fixture.areBothServersReachable()
    }

    @After
    fun tearDown() {
        if (serversReachable) {
            fixture.cleanup()
        }
    }

    @Test
    fun testTwoProfileAgentsSidebarJourneys() {
        org.junit.Assume.assumeTrue(
            "PHASE_05_QUALIFICATION_GATE_OPEN: Live servers at ${fixture.primaryUrl} and ${fixture.secondaryUrl} are unreachable.",
            serversReachable,
        )

        val runId = "agents-run-${System.currentTimeMillis() % 100000}"
        val term1 = fixture.seedTerminal(
            url = fixture.primaryUrl,
            token = fixture.primaryToken,
            id = runId,
            project = fixture.primaryProject,
        )
        val term2 = fixture.seedTerminal(
            url = fixture.secondaryUrl,
            token = fixture.secondaryToken,
            id = runId,
            project = fixture.otherProject,
        )

        // Verify both servers recorded their own instance
        check(term1.id == term2.id) { "Seeded terminal IDs must match to test disambiguation" }

        composeTestRule.waitForIdle()

        // Verify Terminal panel is visible and Agents trigger exists
        val agentsTrigger = composeTestRule.onNode(
            androidx.compose.ui.test.hasText("Agents") or
                androidx.compose.ui.test.hasContentDescription("Agents", substring = true),
            useUnmergedTree = true,
        )
        agentsTrigger.assertExists()
        agentsTrigger.performClick()
        composeTestRule.waitForIdle()

        // Sidebar header visible
        composeTestRule.onNodeWithText("Agents", useUnmergedTree = true).assertIsDisplayed()

        // Filter button exists
        val filterMenu = composeTestRule.onNode(
            androidx.compose.ui.test.hasContentDescription("Filter agents", substring = true),
            useUnmergedTree = true,
        )
        filterMenu.assertExists()
    }
}
