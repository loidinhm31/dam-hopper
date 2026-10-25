package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.ui.screens.RequiredTerminalSelection
import dev.damhopper.nativeapp.ui.screens.isSessionAttachableForRequired
import dev.damhopper.nativeapp.ui.screens.resolveRequiredTerminalSelection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Exact-selection policy of a verified manual Agents activation: only the exact terminal ID + incarnation of the
 * screen's own server may be selected; a missing or restarted instance is an explicit refusal and the ordinary
 * `selectable.firstOrNull()` fallback never runs. Without an intent the ordinary policy is untouched.
 */
class TerminalAgentsExactSelectionTest {

    private fun session(id: String, incarnation: ULong) =
        TerminalSessionDetailed(id = id, incarnation = incarnation, project = "proj", command = "sh", cwd = "/work")

    private val first = session("term-first", 1uL)
    private val target = session("term-target", 3uL)

    @Test
    fun noRequiredInstanceLeavesTheOrdinaryPolicyUntouched() {
        assertEquals(
            RequiredTerminalSelection.NotRequired,
            resolveRequiredTerminalSelection(null, "server-A", listOf(first, target)),
        )
        // An attach filter without an intent never rejects a session.
        assertTrue(isSessionAttachableForRequired(null, first))
        assertTrue(isSessionAttachableForRequired(null, target))
    }

    @Test
    fun theExactIdAndIncarnationIsSelectedEvenWhenAnotherTerminalComesFirst() {
        val required = TerminalAgentsInstanceKey("server-A", "term-target", 3uL)
        val result = resolveRequiredTerminalSelection(required, "server-A", listOf(first, target))
        assertEquals(RequiredTerminalSelection.Select("term-target"), result)
    }

    @Test
    fun aMissingRequiredInstanceIsRefusedNeverReplacedByTheFirstSelectableTerminal() {
        val required = TerminalAgentsInstanceKey("server-A", "term-gone", 1uL)
        val result = resolveRequiredTerminalSelection(required, "server-A", listOf(first, target))
        val refused = assertIs<RequiredTerminalSelection.Refused>(result)
        assertTrue(refused.reason.contains("no longer available"), refused.reason)

        val empty = resolveRequiredTerminalSelection(required, "server-A", emptyList())
        assertIs<RequiredTerminalSelection.Refused>(empty)
    }

    @Test
    fun aRestartedRequiredInstanceIsRefusedAndNeverAttachedAsTheNewIncarnation() {
        val required = TerminalAgentsInstanceKey("server-A", "term-target", 3uL)
        val restarted = session("term-target", 4uL)
        val result = resolveRequiredTerminalSelection(required, "server-A", listOf(first, restarted))
        val refused = assertIs<RequiredTerminalSelection.Refused>(result)
        assertTrue(refused.reason.contains("restarted"), refused.reason)

        // The restarted incarnation must not be attached for this intent; unrelated terminals are not affected.
        assertFalse(isSessionAttachableForRequired(required, restarted))
        assertTrue(isSessionAttachableForRequired(required, target))
        assertTrue(isSessionAttachableForRequired(required, first))
    }

    @Test
    fun aRequirementOfAnotherServerOrAnUnknownProfileIsRefused() {
        val required = TerminalAgentsInstanceKey("server-B", "term-target", 3uL)
        assertIs<RequiredTerminalSelection.Refused>(
            resolveRequiredTerminalSelection(required, "server-A", listOf(first, target)),
        )
        assertIs<RequiredTerminalSelection.Refused>(
            resolveRequiredTerminalSelection(required, null, listOf(first, target)),
        )
    }
}
