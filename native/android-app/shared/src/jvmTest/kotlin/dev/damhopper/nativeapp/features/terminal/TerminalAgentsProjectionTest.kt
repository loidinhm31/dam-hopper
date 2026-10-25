package dev.damhopper.nativeapp.features.terminal

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TerminalAgentsProjectionTest {
    private val f = TerminalAgentsTestFixtures
    private val projector = DefaultTerminalAgentsProjector()

    private fun runtimeSnapshot(
        identity: Boolean = true,
        connected: Boolean = true,
        health: TerminalAgentsInventoryHealth = TerminalAgentsInventoryHealth.CURRENT,
        baseline: Boolean = true,
        wire: AgentStatusAvailability = AgentStatusAvailability.READY,
        failure: TerminalAgentsSnapshotFailure? = null,
    ) = f.snapshot(
        f.runtime(), emptyList(), emptyList(),
        identity = identity, connected = connected, health = health, baseline = baseline, wire = wire, failure = failure,
    )

    @Test
    fun availabilityPrecedenceTable() {
        data class Case(val snapshot: TerminalAgentsRuntimeSnapshot, val expected: TerminalAgentsAvailability?)
        val cases = listOf(
            // identity lost purges, whatever else is true (including a typed 404 and a ready baseline)
            Case(runtimeSnapshot(identity = false), null),
            Case(runtimeSnapshot(identity = false, failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND), null),
            // disconnected / not-current socket beats cached READY and typed failures
            Case(runtimeSnapshot(connected = false), TerminalAgentsAvailability.UNAVAILABLE),
            Case(
                runtimeSnapshot(connected = false, failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND),
                TerminalAgentsAvailability.UNAVAILABLE,
            ),
            // inventory not CURRENT
            Case(runtimeSnapshot(health = TerminalAgentsInventoryHealth.REFRESHING), TerminalAgentsAvailability.UNAVAILABLE),
            Case(runtimeSnapshot(health = TerminalAgentsInventoryHealth.UNAVAILABLE), TerminalAgentsAvailability.UNAVAILABLE),
            Case(
                runtimeSnapshot(health = TerminalAgentsInventoryHealth.CONFLICT, failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND),
                TerminalAgentsAvailability.UNAVAILABLE,
            ),
            // typed 404 only when the socket and inventory are current; baseline state is irrelevant to it
            Case(runtimeSnapshot(failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND), TerminalAgentsAvailability.UNSUPPORTED),
            Case(
                runtimeSnapshot(failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND, baseline = false),
                TerminalAgentsAvailability.UNSUPPORTED,
            ),
            // other failure or missing baseline => unavailable
            Case(runtimeSnapshot(failure = TerminalAgentsSnapshotFailure.OTHER), TerminalAgentsAvailability.UNAVAILABLE),
            Case(runtimeSnapshot(baseline = false), TerminalAgentsAvailability.UNAVAILABLE),
            Case(
                runtimeSnapshot(baseline = false, wire = AgentStatusAvailability.PLATFORM_UNQUALIFIED),
                TerminalAgentsAvailability.UNAVAILABLE,
            ),
            // installed wire availability
            Case(runtimeSnapshot(wire = AgentStatusAvailability.PLATFORM_UNQUALIFIED), TerminalAgentsAvailability.PLATFORM_UNQUALIFIED),
            Case(runtimeSnapshot(wire = AgentStatusAvailability.UNAVAILABLE), TerminalAgentsAvailability.UNAVAILABLE),
            // loading closes qualification even with an installed READY baseline
            Case(runtimeSnapshot().let { it.copy(status = it.status.copy(isSnapshotLoading = true)) }, TerminalAgentsAvailability.UNAVAILABLE),
            Case(runtimeSnapshot(), TerminalAgentsAvailability.READY),
        )
        for ((index, case) in cases.withIndex()) {
            assertEquals(case.expected, TerminalAgentsPresenter.availability(case.snapshot), "case $index")
        }
    }

    @Test
    fun readyStateMapsToStatusReasonAndDone() {
        val ready = TerminalAgentsAvailability.READY
        fun present(
            state: AgentState,
            reason: BlockedReason? = null,
            turnId: String? = null,
            outcome: TurnOutcome? = null,
        ) = TerminalAgentsPresenter.present(ready, f.observation("t", state = state, reason = reason, turnId = turnId, lastOutcome = outcome))

        for (reason in BlockedReason.entries) {
            val blocked = present(AgentState.BLOCKED, reason)
            assertEquals(TerminalAgentsStatus.NEEDS_ATTENTION, blocked.status)
            assertEquals(reason, blocked.reason)
            assertFalse(blocked.doneTurnEnded)
        }
        assertNull(present(AgentState.BLOCKED).reason)
        assertEquals(TerminalAgentsStatus.WORKING, present(AgentState.WORKING).status)
        assertEquals(TerminalAgentsStatus.UNKNOWN, present(AgentState.UNKNOWN).status)
        assertEquals(TerminalAgentsStatus.IDLE, present(AgentState.IDLE).status)
        // Reason never leaks onto non-blocked states.
        assertNull(present(AgentState.WORKING, reason = BlockedReason.ERROR).reason)
        assertNull(present(AgentState.IDLE, reason = BlockedReason.QUESTION).reason)
    }

    @Test
    fun doneTurnEndedOnlyForReadyIdleEndedWithoutTurn() {
        fun done(
            availability: TerminalAgentsAvailability = TerminalAgentsAvailability.READY,
            state: AgentState = AgentState.IDLE,
            outcome: TurnOutcome? = TurnOutcome.ENDED,
            turnId: String? = null,
        ) = TerminalAgentsPresenter.present(
            availability,
            f.observation("t", state = state, turnId = turnId, lastOutcome = outcome),
        ).doneTurnEnded

        assertTrue(done())
        assertFalse(done(turnId = "turn-1"))
        for (outcome in listOf(null, TurnOutcome.INTERRUPTED, TurnOutcome.ERROR, TurnOutcome.UNKNOWN)) {
            assertFalse(done(outcome = outcome), "outcome=$outcome")
        }
        for (state in listOf(AgentState.WORKING, AgentState.BLOCKED, AgentState.UNKNOWN)) {
            assertFalse(done(state = state), "state=$state")
        }
        for (availability in TerminalAgentsAvailability.entries.filter { it != TerminalAgentsAvailability.READY }) {
            assertFalse(done(availability = availability), "availability=$availability")
        }
    }

    @Test
    fun nonReadyAvailabilityOverridesObservedStateWithoutReason() {
        val blocked = f.observation("t", state = AgentState.BLOCKED, reason = BlockedReason.APPROVAL)
        val expected = mapOf(
            TerminalAgentsAvailability.UNAVAILABLE to TerminalAgentsStatus.UNAVAILABLE,
            TerminalAgentsAvailability.PLATFORM_UNQUALIFIED to TerminalAgentsStatus.PLATFORM_UNQUALIFIED,
            TerminalAgentsAvailability.UNSUPPORTED to TerminalAgentsStatus.UNSUPPORTED,
        )
        for ((availability, status) in expected) {
            val presentation = TerminalAgentsPresenter.present(availability, blocked)
            assertEquals(status, presentation.status, "$availability")
            assertNull(presentation.reason)
            assertFalse(presentation.doneTurnEnded)
        }
    }

    @Test
    fun sourceAndCoverageHintDescribeObservationNotAvailability() {
        for (availability in TerminalAgentsAvailability.entries) {
            val lifecycle = TerminalAgentsPresenter.present(availability, f.observation("t", source = AgentObservationSource.LIFECYCLE))
            assertEquals(AgentObservationSource.LIFECYCLE, lifecycle.source)
            assertNull(lifecycle.coverageHint)
            val hook = TerminalAgentsPresenter.present(availability, f.observation("t", source = AgentObservationSource.HOOK))
            assertEquals(AgentObservationSource.HOOK, hook.source)
            assertEquals(
                "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)",
                hook.coverageHint,
            )
        }
        assertEquals("Lifecycle observation", TerminalAgentsPresenter.sourceLabel(AgentObservationSource.LIFECYCLE))
        assertEquals("Hook observation", TerminalAgentsPresenter.sourceLabel(AgentObservationSource.HOOK))
        assertEquals("Done (turn ended)", TerminalAgentsPresenter.DONE_TURN_ENDED_LABEL)
    }

    @Test
    fun labelsMatchWebCanonicalEnglish() {
        assertEquals(
            listOf("Needs attention", "Working", "Idle", "Unknown", "Unavailable", "Platform unqualified", "Unsupported"),
            TerminalAgentsStatus.entries.map { TerminalAgentsPresenter.statusLabel(it) },
        )
        assertEquals(
            listOf("Approval", "Question", "Error"),
            BlockedReason.entries.map { TerminalAgentsPresenter.reasonLabel(it) },
        )
    }

    @Test
    fun rowsDeriveEffectiveStatusFromRuntimeTruthNotCachedReady() {
        val s = f.session("t", name = "Build")
        val observation = f.observation("t", kind = AgentKind.CLAUDE, state = AgentState.WORKING, source = AgentObservationSource.HOOK)
        fun statusFor(snapshot: TerminalAgentsRuntimeSnapshot): List<TerminalAgentsStatus> {
            val rt = f.runtime()
            val input = f.input(listOf(f.workspace(f.registration(f.owner()), rt, listOf(s))), listOf(snapshot))
            return projector.rows(input).map { it.presentation.status }
        }
        fun snap(
            identity: Boolean = true,
            connected: Boolean = true,
            baseline: Boolean = true,
            wire: AgentStatusAvailability = AgentStatusAvailability.READY,
            failure: TerminalAgentsSnapshotFailure? = null,
        ) = f.snapshot(
            f.runtime(), listOf(s), listOf(observation),
            identity = identity, connected = connected, baseline = baseline, wire = wire, failure = failure,
        )

        assertEquals(listOf(TerminalAgentsStatus.WORKING), statusFor(snap()))
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statusFor(snap(connected = false)))
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statusFor(snap(baseline = false)))
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statusFor(snap(failure = TerminalAgentsSnapshotFailure.OTHER)))
        assertEquals(listOf(TerminalAgentsStatus.UNSUPPORTED), statusFor(snap(failure = TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND)))
        assertEquals(
            listOf(TerminalAgentsStatus.PLATFORM_UNQUALIFIED),
            statusFor(snap(wire = AgentStatusAvailability.PLATFORM_UNQUALIFIED)),
        )
        assertEquals(
            listOf(TerminalAgentsStatus.UNAVAILABLE),
            statusFor(snap(wire = AgentStatusAvailability.UNAVAILABLE)),
        )
        assertTrue(statusFor(snap(identity = false)).isEmpty())
    }

    @Test
    fun rowCarriesLabelsTitleHarnessAndExactTarget() {
        val s = f.session("t", name = "Build")
        val observation = f.observation("t", kind = AgentKind.CLAUDE, state = AgentState.BLOCKED, reason = BlockedReason.QUESTION)
        val rt = f.runtime()
        val registration = f.registration(f.owner(worktree = "wt/x"))
        val wtSession = f.session("t", name = "Build", worktree = "wt/x")
        val input = f.input(
            listOf(f.workspace(registration, rt, listOf(wtSession))),
            listOf(f.snapshot(rt, listOf(wtSession), listOf(observation))),
        )
        val row = projector.rows(input).single()
        assertEquals("proj (wt/x)", row.projectLabel)
        assertEquals("Profile One", row.profileLabel)
        assertEquals("Build", row.terminalTitle)
        assertEquals(AgentKind.CLAUDE, row.agentKind)
        assertEquals(TerminalAgentsStatus.NEEDS_ATTENTION, row.presentation.status)
        assertEquals(BlockedReason.QUESTION, row.presentation.reason)
        assertEquals(registration, row.target.registration)
        assertEquals(rt, row.target.runtime)
        assertEquals(TerminalAgentsInstanceKey("p1", "t", 1uL), row.target.instance)
        // Unnamed terminals fall back to their ID.
        val unnamed = f.session("u")
        val unnamedRow = projector.rows(f.simple(listOf(unnamed), listOf(f.observation("u")))).single()
        assertEquals("u", unnamedRow.terminalTitle)
        assertEquals(s.displayName, row.terminalTitle)
    }

    @Test
    fun projectionIsDeterministic() {
        val s = f.session("t")
        val input = f.simple(listOf(s), listOf(f.observation("t")))
        val first = projector.project(input, TerminalAgentsFilterSelection.All)
        val second = projector.project(input, TerminalAgentsFilterSelection.All)
        assertEquals(first, second)
    }
}
