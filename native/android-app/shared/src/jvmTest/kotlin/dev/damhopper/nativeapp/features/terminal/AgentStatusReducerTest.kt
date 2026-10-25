package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.notifications.MAX_SERVER_SAFE_INTEGER
import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentStatusReducerTest {

    private val json = Json { ignoreUnknownKeys = true }
    private val owner = ConnectionRef("prof", 1L)
    private val socket = SocketInstanceRef(owner, "sock-1")

    private fun makeAgentRow(
        id: String,
        incarnation: ULong,
        state: AgentState = AgentState.WORKING,
        attentionRev: ULong = 1uL,
        kind: AgentKind = AgentKind.OMP,
        session: String = "sess-$id",
    ): TerminalAgentStatusRow = TerminalAgentStatusRow(
        id = id,
        incarnation = incarnation,
        agentKind = kind,
        agentSessionId = session,
        reporterEpoch = 1uL,
        state = state,
        source = AgentObservationSource.LIFECYCLE,
        attentionRevision = attentionRev,
    )

    private fun attentionFor(
        row: TerminalAgentStatusRow,
        kind: AttentionKind = AttentionKind.NEEDS_ATTENTION,
        id: String = "1:${row.id}:${row.incarnation}:${row.attentionRevision}",
    ) = AgentAttentionEvent(
        id = id,
        kind = kind,
        terminalId = row.id,
        incarnation = row.incarnation,
        agentKind = row.agentKind,
        agentSessionId = row.agentSessionId,
        reason = BlockedReason.APPROVAL,
        attentionRevision = row.attentionRevision,
        timestampMs = 1000uL,
    )

    private fun changed(
        revision: ULong,
        row: TerminalAgentStatusRow,
        attention: AgentAttentionEvent? = null,
        epoch: ULong = 1uL,
    ) = ServerMsg.AgentStatusChanged(
        serverEpoch = epoch,
        revision = revision,
        row = json.encodeToJsonElement(row),
        attention = attention?.let { json.encodeToJsonElement(it) },
    )

    private fun removed(revision: ULong, terminalId: String, incarnation: ULong, epoch: ULong = 1uL) =
        ServerMsg.AgentStatusRemoved(serverEpoch = epoch, revision = revision, terminalId = terminalId, incarnation = incarnation)

    private fun snapshot(
        revision: ULong = 10uL,
        epoch: ULong = 1uL,
        availability: AgentStatusAvailability = AgentStatusAvailability.READY,
        vararg rows: TerminalAgentStatusRow,
    ) = AgentStatusSnapshotV1(serverEpoch = epoch, revision = revision, availability = availability, terminals = rows.toList())

    /** Binds the runtime and installs [snapshot] silently, the only way a baseline appears. */
    private suspend fun AgentStatusReducer.install(snapshot: AgentStatusSnapshotV1): Boolean {
        assertTrue(bindRuntime(owner, socket))
        val capture = assertNotNull(captureSnapshot(owner, socket))
        return applySnapshot(capture, snapshot)
    }

    private suspend fun AgentStatusReducer.status(msg: ServerMsg.AgentStatusChanged) = applyStatusChanged(owner, socket, msg)

    /** Unit-returning wrapper: JUnit requires void tests, and `assertNotNull` etc. return values. */
    private fun runSuspending(block: suspend () -> Unit) = runBlocking { block() }

    @Test
    fun testApplySnapshotEstablishesEpochAndRevision() = runSuspending {
        val reducer = AgentStatusReducer()
        val installed = reducer.install(
            snapshot(
                50uL, 10uL, AgentStatusAvailability.READY,
                makeAgentRow("term-1", 1uL, AgentState.WORKING),
                makeAgentRow("term-2", 2uL, AgentState.IDLE),
            ),
        )
        val state = reducer.state.value

        assertTrue(installed)
        assertEquals(10uL, state.serverEpoch)
        assertEquals(50uL, state.revision)
        assertEquals(AgentStatusAvailability.READY, state.availability)
        assertEquals(2, state.agents.size)
        assertTrue(state.baselineInstalled)
        assertTrue(state.admissionOpen)
        assertNotNull(state.findAgentForSession("term-1", 1uL))
        assertNull(state.findAgentForSession("term-1", 99uL)) // incarnation mismatch fails closed
    }

    @Test
    fun eventsBeforeBaselineNeverAlertAndRequestReconcile() = runSuspending {
        val reducer = AgentStatusReducer()
        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        // unbound runtime: stale/foreign, silent
        assertEquals(AgentAdmission.Silent, reducer.status(changed(1uL, row, attentionFor(row))))
        // bound but no baseline: reconcile, still no alert and no state mutation
        reducer.bindRuntime(owner, socket)
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(1uL, row, attentionFor(row))))
        assertTrue(reducer.state.value.agents.isEmpty())
        assertTrue(reducer.state.value.unreadAttentions.isEmpty())
        // while a capture is in flight, deltas are discarded silently (no reconcile storm)
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertTrue(reducer.state.value.isSnapshotLoading)
        assertFalse(reducer.state.value.admissionOpen)
        assertEquals(AgentAdmission.Silent, reducer.status(changed(2uL, row, attentionFor(row))))
        // snapshot installs silently; the buffered pre-baseline delta is not replayed
        assertTrue(reducer.applySnapshot(capture, snapshot(10uL, 1uL, AgentStatusAvailability.READY, row)))
        assertTrue(reducer.state.value.unreadAttentions.isEmpty())
        assertEquals(AgentAdmission.Silent, reducer.status(changed(2uL, row, attentionFor(row)))) // stale (<= cursor)
    }

    @Test
    fun testMonotonicRevisionFencingWithinEpoch() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(50uL, 10uL, AgentStatusAvailability.READY))

        // older revision: ignored, state untouched
        val staleRow = makeAgentRow("term-stale", 1uL)
        assertEquals(AgentAdmission.Silent, reducer.applyStatusChanged(owner, socket, changed(45uL, staleRow, epoch = 10uL)))
        assertEquals(50uL, reducer.state.value.revision)
        assertNull(reducer.state.value.agents["term-stale"])

        // contiguous revision: applied, no attention => silent
        val freshRow = makeAgentRow("term-fresh", 1uL)
        assertEquals(AgentAdmission.Silent, reducer.applyStatusChanged(owner, socket, changed(51uL, freshRow, epoch = 10uL)))
        assertEquals(51uL, reducer.state.value.revision)
        assertNotNull(reducer.state.value.agents["term-fresh"])
    }

    @Test
    fun noncontiguousRevisionClosesAdmissionAndNewBaselineIsSilent() = runSuspending {
        val reducer = AgentStatusReducer()
        val base = makeAgentRow("term-1", 1uL, AgentState.WORKING, attentionRev = 0uL)
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, base))

        val blocked = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        // revision 12 skips 11 => gap
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(12uL, blocked, attentionFor(blocked))))
        assertFalse(reducer.state.value.baselineInstalled)
        assertFalse(reducer.state.value.admissionOpen)
        // even the "missing" contiguous revision 11 cannot alert after the gap closed admission
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, blocked, attentionFor(blocked))))
        assertTrue(reducer.state.value.unreadAttentions.isEmpty())

        // silent reconcile to the server's state; the already-happened attention is not alerted afterwards
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertTrue(reducer.applySnapshot(capture, snapshot(12uL, 1uL, AgentStatusAvailability.READY, blocked)))
        assertEquals(AgentAdmission.Silent, reducer.status(changed(13uL, blocked, attentionFor(blocked)))) // replay of rev 1
        val second = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 2uL)
        assertIs<AgentAdmission.Accepted>(reducer.status(changed(14uL, second, attentionFor(second))))
    }

    @Test
    fun testAttentionEventDeduplicationAndDismissal() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 5uL)))
        // historical attention in the snapshot is not an unread notification
        assertEquals(0, reducer.state.value.unreadAttentions.size)

        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 6uL)
        val attention = attentionFor(row)
        val first = reducer.status(changed(11uL, row, attention))
        val accepted = assertIs<AgentAdmission.Accepted>(first).event
        assertEquals(owner, accepted.owner)
        assertEquals(socket, accepted.socket)
        assertEquals(1uL, accepted.serverEpoch)
        assertEquals(11uL, accepted.revision)
        assertEquals(row, accepted.row)
        assertEquals(attention, accepted.attention)
        assertEquals(1, reducer.state.value.unreadAttentions.size)
        assertEquals("1:term-1:1:6", reducer.state.value.unreadAttentions[0].id)

        // replay of the same attention under a fresh contiguous revision does not alert again
        assertEquals(AgentAdmission.Silent, reducer.status(changed(12uL, row, attention)))
        assertEquals(1, reducer.state.value.unreadAttentions.size)

        reducer.dismissAttention("1:term-1:1:6")
        assertEquals(0, reducer.state.value.unreadAttentions.size)
        // dismissal does not lower the high-water: the same attention still cannot alert
        assertEquals(AgentAdmission.Silent, reducer.status(changed(13uL, row, attention)))
    }

    @Test
    fun snapshotRowAttentionIsHighWaterNotSyntheticEvent() = runSuspending {
        val reducer = AgentStatusReducer()
        val row5 = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 5uL)
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, row5))
        // equal or lower attention revision than the baseline row never alerts, even with a blank-ish id replay
        assertEquals(AgentAdmission.Silent, reducer.status(changed(11uL, row5, attentionFor(row5))))
        val row4 = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 4uL)
        assertEquals(AgentAdmission.Silent, reducer.status(changed(12uL, row4, attentionFor(row4, id = "different-event-id"))))
        val row6 = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 6uL)
        assertIs<AgentAdmission.Accepted>(reducer.status(changed(13uL, row6, attentionFor(row6))))
    }

    @Test
    fun removedTerminalCannotBeResurrectedByOldIncarnation() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 2uL, attentionRev = 3uL)))
        assertEquals(AgentAdmission.Silent, reducer.applyStatusRemoved(owner, socket, removed(11uL, "term-1", 2uL)))
        assertNull(reducer.state.value.agents["term-1"])

        // replay of an old attention for a removed incarnation, under a fresh contiguous revision: no resurrection
        val old = makeAgentRow("term-1", 2uL, AgentState.BLOCKED, attentionRev = 4uL)
        assertEquals(AgentAdmission.Silent, reducer.status(changed(12uL, old, attentionFor(old))))
        assertNull(reducer.state.value.agents["term-1"])
        val older = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 9uL)
        assertEquals(AgentAdmission.Silent, reducer.status(changed(13uL, older, attentionFor(older))))
        assertNull(reducer.state.value.agents["term-1"])

        // a genuinely new incarnation is a new terminal
        val fresh = makeAgentRow("term-1", 3uL, AgentState.BLOCKED, attentionRev = 1uL)
        assertIs<AgentAdmission.Accepted>(reducer.status(changed(14uL, fresh, attentionFor(fresh))))
    }

    @Test
    fun testStatusRemovedFencing() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 2uL)))
        assertNotNull(reducer.state.value.agents["term-1"])

        // removed event for an older incarnation must not remove the newer incarnation
        reducer.applyStatusRemoved(owner, socket, removed(11uL, "term-1", 1uL))
        assertNotNull(reducer.state.value.agents["term-1"])
        // exact incarnation removes it
        reducer.applyStatusRemoved(owner, socket, removed(12uL, "term-1", 2uL))
        assertNull(reducer.state.value.agents["term-1"])
        // removal shares the contiguous cursor: skipping 13 closes admission
        assertEquals(AgentAdmission.Reconcile, reducer.applyStatusRemoved(owner, socket, removed(14uL, "term-2", 1uL)))
        assertFalse(reducer.state.value.baselineInstalled)
    }

    @Test
    fun epochChangeAndInvalidationCloseAdmissionSilently() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 1uL, attentionRev = 0uL)))
        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, row, attentionFor(row), epoch = 2uL)))
        assertFalse(reducer.state.value.baselineInstalled)
        assertTrue(reducer.state.value.unreadAttentions.isEmpty())

        reducer.install(snapshot(20uL, 2uL, AgentStatusAvailability.READY, row))
        // invalidation (even a duplicate-looking one under a closed in-flight capture) always reconciles
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertEquals(AgentAdmission.Reconcile, reducer.applyStatusInvalidated(owner, socket, ServerMsg.AgentStatusInvalidated(2uL, 21uL)))
        assertFalse(reducer.applySnapshot(capture, snapshot(20uL, 2uL, AgentStatusAvailability.READY, row))) // predates invalidation
        assertTrue(reducer.state.value.agents.isEmpty())
        assertFalse(reducer.state.value.baselineInstalled)
    }

    @Test
    fun unavailableDomainKeepsAdmissionClosed() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.PLATFORM_UNQUALIFIED))
        assertTrue(reducer.state.value.baselineInstalled)
        assertFalse(reducer.state.value.admissionOpen)
        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, row, attentionFor(row))))
    }

    @Test
    fun staleSameEpochSnapshotNeverRegressesCursor() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(20uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 1uL)))
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertFalse(reducer.applySnapshot(capture, snapshot(15uL, 1uL, AgentStatusAvailability.READY)))
        assertEquals(20uL, reducer.state.value.revision)
        assertNotNull(reducer.state.value.agents["term-1"])
        assertFalse(reducer.state.value.admissionOpen) // closed; next event reconciles silently
        assertNotNull(reducer.state.value.lastError)
    }

    @Test
    fun staleInFlightSnapshotCannotInstallAfterReplacement() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.bindRuntime(owner, socket)
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))

        // same generation, replaced socket
        val socket2 = SocketInstanceRef(owner, "sock-2")
        assertTrue(reducer.bindRuntime(owner, socket2))
        assertFalse(reducer.applySnapshot(capture, snapshot()))
        assertFalse(reducer.state.value.baselineInstalled)
        // the replaced socket can neither capture nor rebind nor close the new baseline
        assertNull(reducer.captureSnapshot(owner, socket))
        val capture2 = assertNotNull(reducer.captureSnapshot(owner, socket2))
        assertTrue(reducer.applySnapshot(capture2, snapshot()))
        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        assertEquals(AgentAdmission.Silent, reducer.applyStatusChanged(owner, socket, changed(11uL, row, attentionFor(row))))
        assertTrue(reducer.state.value.baselineInstalled)
        assertIs<AgentAdmission.Accepted>(reducer.applyStatusChanged(owner, socket2, changed(11uL, row, attentionFor(row))))
    }

    @Test
    fun newerCaptureSupersedesOlderAndFailureThenRetryWorks() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.bindRuntime(owner, socket)
        val first = assertNotNull(reducer.captureSnapshot(owner, socket))
        val second = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertFalse(reducer.applySnapshot(first, snapshot()))
        assertTrue(reducer.applySnapshot(second, snapshot()))

        // fetch failed/cancelled: capture spent, admission stays closed, retry installs
        val failing = assertNotNull(reducer.captureSnapshot(owner, socket))
        reducer.abandonSnapshot(failing, "boom")
        assertFalse(reducer.state.value.baselineInstalled)
        assertEquals("boom", reducer.state.value.lastError)
        assertFalse(reducer.applySnapshot(failing, snapshot()))
        val retry = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertTrue(reducer.applySnapshot(retry, snapshot()))
        assertTrue(reducer.state.value.admissionOpen)
    }

    @Test
    fun retiredOwnerCannotRebindOrTouchNextGeneration() = runSuspending {
        val reducer = AgentStatusReducer()
        val next = ConnectionRef("prof", 2L)
        val nextSocket = SocketInstanceRef(next, "s-next")
        reducer.install(snapshot())
        assertTrue(reducer.bindRuntime(next, nextSocket))
        assertFalse(reducer.bindRuntime(owner, socket)) // N cannot rebind over N+1
        reducer.retireOwner(owner) // late N cleanup: no effect on N+1
        val capture = assertNotNull(reducer.captureSnapshot(next, nextSocket))
        assertTrue(reducer.applySnapshot(capture, snapshot()))
        reducer.retireOwner(owner)
        assertTrue(reducer.state.value.baselineInstalled)
        reducer.retireOwner(next)
        assertFalse(reducer.state.value.baselineInstalled)
        assertNull(reducer.captureSnapshot(next, nextSocket))
    }

    @Test
    fun semanticRulesPerAgentKind() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY))
        var revision = 10uL
        suspend fun attempt(kind: AgentKind, attention: AttentionKind, rev: ULong, id: String): AgentAdmission {
            val row = makeAgentRow(id, 1uL, AgentState.BLOCKED, attentionRev = rev, kind = kind)
            return reducer.status(changed(++revision, row, attentionFor(row, attention)))
        }
        // Codex is status-only
        assertEquals(AgentAdmission.Silent, attempt(AgentKind.CODEX, AttentionKind.NEEDS_ATTENTION, 1uL, "codex-a"))
        assertEquals(AgentAdmission.Silent, attempt(AgentKind.CODEX, AttentionKind.TURN_ENDED, 1uL, "codex-b"))
        // Claude: needs-attention only
        assertEquals(AgentAdmission.Silent, attempt(AgentKind.CLAUDE, AttentionKind.TURN_ENDED, 1uL, "claude-a"))
        assertIs<AgentAdmission.Accepted>(attempt(AgentKind.CLAUDE, AttentionKind.NEEDS_ATTENTION, 1uL, "claude-b"))
        // OMP: both
        assertIs<AgentAdmission.Accepted>(attempt(AgentKind.OMP, AttentionKind.TURN_ENDED, 1uL, "omp-a"))
        assertIs<AgentAdmission.Accepted>(attempt(AgentKind.OMP, AttentionKind.NEEDS_ATTENTION, 1uL, "omp-b"))
    }

    @Test
    fun mismatchedMalformedOrUnsafeEventsCloseAdmission() = runSuspending {
        suspend fun fresh(): AgentStatusReducer = AgentStatusReducer().also { it.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY)) }
        val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL)

        // attention that does not match the row (terminal, incarnation, session, kind, revision)
        val mismatches = listOf(
            attentionFor(row).copy(terminalId = "other"),
            attentionFor(row).copy(incarnation = 2uL),
            attentionFor(row).copy(agentSessionId = "other-session"),
            attentionFor(row).copy(agentKind = AgentKind.CLAUDE),
            attentionFor(row).copy(attentionRevision = 2uL),
            attentionFor(row).copy(id = " "),
        )
        for (bad in mismatches) {
            val reducer = fresh()
            assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, row, bad)))
            assertFalse(reducer.state.value.baselineInstalled, "mismatch must close admission: $bad")
            assertTrue(reducer.state.value.unreadAttentions.isEmpty())
        }
        // revision beyond 2^53-1 is rejected, never truncated
        val unsafe = fresh()
        val tooBig = (MAX_SERVER_SAFE_INTEGER.toULong() + 1uL)
        assertEquals(AgentAdmission.Reconcile, unsafe.status(changed(tooBig, row, attentionFor(row))))
        assertFalse(unsafe.state.value.baselineInstalled)
        // attention revision of unsafe size in the row
        val unsafeRow = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = ULong.MAX_VALUE)
        val reducer = fresh()
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, unsafeRow, attentionFor(unsafeRow))))
        // malformed row JSON
        val badRow = fresh()
        assertEquals(
            AgentAdmission.Reconcile,
            badRow.applyStatusChanged(owner, socket, ServerMsg.AgentStatusChanged(1uL, 11uL, json.encodeToJsonElement("not a row"))),
        )
    }

    @Test
    fun agentSessionReplacementUsesFullIdentityForRevisionOrdering() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 1uL, AgentState.IDLE, attentionRev = 5uL, session = "sess-A")))
        // new agent session in the same terminal restarts its counter: genuinely new attention
        val replacement = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 1uL, session = "sess-B")
        assertIs<AgentAdmission.Accepted>(reducer.status(changed(11uL, replacement, attentionFor(replacement))))
        // but replaying the old session's attention is still blocked by that session's own high-water
        val oldReplay = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 5uL, session = "sess-A")
        assertEquals(AgentAdmission.Silent, reducer.status(changed(12uL, oldReplay, attentionFor(oldReplay))))
    }

    @Test
    fun olderIncarnationRowNeverReplacesNewerRow() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 2uL)))
        val older = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 4uL)
        assertEquals(AgentAdmission.Silent, reducer.status(changed(11uL, older, attentionFor(older))))
        assertEquals(2uL, reducer.state.value.agents["term-1"]?.incarnation)
        assertEquals(11uL, reducer.state.value.revision) // cursor still advanced contiguously
    }

    @Test
    fun capacityClosesAdmissionInsteadOfEvictingAuthority() = runSuspending {
        val reducer = AgentStatusReducer()
        val rows = (0 until AgentStatusReducer.MAX_TRACKED).map { makeAgentRow("t$it", 1uL, AgentState.IDLE, attentionRev = 1uL) }
        assertTrue(reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, *rows.toTypedArray())))
        // a new identity would need an eviction: close + reconcile, the new attention is not accepted
        val extra = makeAgentRow("extra", 1uL, AgentState.BLOCKED, attentionRev = 1uL)
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(11uL, extra, attentionFor(extra))))
        assertFalse(reducer.state.value.baselineInstalled)
        assertNull(reducer.state.value.agents["extra"])
        // old high-water authority was not evicted by the attempt: baseline rows are intact for the reconcile
        assertEquals(AgentStatusReducer.MAX_TRACKED, reducer.state.value.agents.size)

        // an over-capacity snapshot never installs authority
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        val tooMany = rows + makeAgentRow("overflow", 1uL, AgentState.IDLE)
        assertFalse(reducer.applySnapshot(capture, snapshot(12uL, 1uL, AgentStatusAvailability.READY, *tooMany.toTypedArray())))
        assertFalse(reducer.state.value.baselineInstalled)
    }

    @Test
    fun malformedSnapshotsNeverInstall() = runSuspending {
        suspend fun attempt(snapshot: AgentStatusSnapshotV1): Boolean {
            val reducer = AgentStatusReducer()
            reducer.bindRuntime(owner, socket)
            val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
            return reducer.applySnapshot(capture, snapshot).also { assertFalse(reducer.state.value.baselineInstalled) }
        }
        val dup = makeAgentRow("dup", 1uL)
        assertFalse(attempt(snapshot(10uL, 1uL, AgentStatusAvailability.READY, dup, dup)))
        assertFalse(attempt(AgentStatusSnapshotV1(version = 2u, serverEpoch = 1uL, revision = 1uL, availability = AgentStatusAvailability.READY)))
        assertFalse(attempt(snapshot(ULong.MAX_VALUE, 1uL, AgentStatusAvailability.READY)))
        assertFalse(attempt(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow("x", ULong.MAX_VALUE))))
        assertFalse(attempt(snapshot(10uL, 1uL, AgentStatusAvailability.READY, makeAgentRow(" ", 1uL))))
    }

    @Test
    fun staleSnapshotAfterGapCannotRegressCursorOrHighWater() = runSuspending {
        val reducer = AgentStatusReducer()
        val row5 = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 5uL)
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, row5))
        val row6 = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 6uL)
        assertIs<AgentAdmission.Accepted>(reducer.status(changed(11uL, row6, attentionFor(row6))))
        // a gap closes admission; the last authoritative epoch/cursor must still fence snapshots
        assertEquals(AgentAdmission.Reconcile, reducer.status(changed(13uL, row6)))
        assertFalse(reducer.state.value.baselineInstalled)
        val stale = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertFalse(reducer.applySnapshot(stale, snapshot(8uL, 1uL, AgentStatusAvailability.READY, row5)))
        assertEquals(11uL, reducer.state.value.revision)
        assertFalse(reducer.state.value.baselineInstalled)
        // a fresh enough snapshot installs, and the already-delivered attention 6 can never alert again
        val fresh = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertTrue(reducer.applySnapshot(fresh, snapshot(13uL, 1uL, AgentStatusAvailability.READY, row6)))
        assertEquals(AgentAdmission.Silent, reducer.status(changed(14uL, row6, attentionFor(row6))))
    }

    @Test
    fun snapshotOlderThanInvalidationIsRejected() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY))
        assertEquals(AgentAdmission.Reconcile, reducer.applyStatusInvalidated(owner, socket, ServerMsg.AgentStatusInvalidated(1uL, 12uL)))
        val older = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertFalse(reducer.applySnapshot(older, snapshot(11uL, 1uL, AgentStatusAvailability.READY)))
        val current = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertTrue(reducer.applySnapshot(current, snapshot(12uL, 1uL, AgentStatusAvailability.READY)))
        assertTrue(reducer.state.value.admissionOpen)
    }

    @Test
    fun testFilterAgents() = runSuspending {
        val reducer = AgentStatusReducer()
        reducer.install(
            snapshot(
                10uL, 1uL, AgentStatusAvailability.READY,
                makeAgentRow("t-work", 1uL, AgentState.WORKING),
                makeAgentRow("t-block", 1uL, AgentState.BLOCKED),
                makeAgentRow("t-idle", 1uL, AgentState.IDLE),
            ),
        )

        reducer.setFilter(AgentFilter.ALL)
        assertEquals(3, reducer.state.value.filteredAgents.size)

        reducer.setFilter(AgentFilter.WORKING)
        assertEquals(1, reducer.state.value.filteredAgents.size)
        assertEquals("t-work", reducer.state.value.filteredAgents[0].id)

        reducer.setFilter(AgentFilter.BLOCKED)
        assertEquals(1, reducer.state.value.filteredAgents.size)
        assertEquals("t-block", reducer.state.value.filteredAgents[0].id)

        reducer.setFilter(AgentFilter.IDLE)
        assertEquals(1, reducer.state.value.filteredAgents.size)
        assertEquals("t-idle", reducer.state.value.filteredAgents[0].id)
    }

    @Test
    fun routeAuthorityRevisionAdvancesForAuthorityChangesOnly() = runSuspending {
        val reducer = AgentStatusReducer()
        assertEquals(0L, reducer.state.value.routeAuthorityRevision)
        val row = makeAgentRow("term-1", 1uL, AgentState.WORKING)
        assertTrue(reducer.install(snapshot(10uL, 1uL, AgentStatusAvailability.READY, row)))
        val installed = reducer.state.value.routeAuthorityRevision
        assertTrue(installed > 0L)

        // An ordinary same-baseline row update never creates a new route fence.
        reducer.status(changed(11uL, makeAgentRow("term-1", 1uL, AgentState.IDLE)))
        assertEquals(installed, reducer.state.value.routeAuthorityRevision)

        // Invalidation closes the baseline, starting a capture loads it, installing it replaces it: each is a fence.
        reducer.applyStatusInvalidated(owner, socket, ServerMsg.AgentStatusInvalidated(1uL, 12uL))
        val closed = reducer.state.value.routeAuthorityRevision
        assertTrue(closed > installed)
        val capture = assertNotNull(reducer.captureSnapshot(owner, socket))
        val loading = reducer.state.value.routeAuthorityRevision
        assertTrue(loading > closed)
        assertTrue(reducer.applySnapshot(capture, snapshot(12uL, 1uL, AgentStatusAvailability.READY, row)))
        val reinstalled = reducer.state.value.routeAuthorityRevision
        assertTrue(reinstalled > loading)

        // Rebinding to another socket (even an equal-looking replacement) is a binding fence.
        assertTrue(reducer.bindRuntime(owner, SocketInstanceRef(owner, "sock-2")))
        assertTrue(reducer.state.value.routeAuthorityRevision > reinstalled)
    }

    @Test
    fun tryAdmitTerminalAgentsRouteDistinguishesBusyFromStaleAndAlwaysReleases() = runSuspending {
        val reducer = AgentStatusReducer()
        assertTrue(reducer.install(snapshot(10uL, 7uL, AgentStatusAvailability.READY, makeAgentRow("term-1", 1uL))))
        val revision = reducer.state.value.routeAuthorityRevision
        var ran = 0
        assertEquals(
            AgentRouteAdmission.COMMITTED,
            reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { ran++; true },
        )
        assertEquals(1, ran)

        // Wrong socket, epoch, missing epoch or a different authority revision are STALE and never run the leaf.
        val other = SocketInstanceRef(owner, "sock-2")
        assertEquals(AgentRouteAdmission.STALE, reducer.tryAdmitTerminalAgentsRoute(owner, other, 7uL, revision) { ran++; true })
        assertEquals(AgentRouteAdmission.STALE, reducer.tryAdmitTerminalAgentsRoute(owner, socket, 8uL, revision) { ran++; true })
        assertEquals(AgentRouteAdmission.STALE, reducer.tryAdmitTerminalAgentsRoute(owner, socket, null, revision) { ran++; true })
        assertEquals(AgentRouteAdmission.STALE, reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision - 1L) { ran++; true })
        assertEquals(1, ran)
        // A declined commit is STALE too.
        assertEquals(AgentRouteAdmission.STALE, reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { false })

        // Same-thread reentry sees the held mutex: the inner call is BUSY (never waits); the outer keeps it.
        var inner: AgentRouteAdmission? = null
        val outer = reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) {
            inner = reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { true }
            false
        }
        assertEquals(AgentRouteAdmission.BUSY, inner)
        assertEquals(AgentRouteAdmission.STALE, outer)

        // The mutex is released in finally even when the leaf throws.
        kotlin.test.assertFailsWith<IllegalStateException> {
            reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { error("boom") }
        }
        assertEquals(AgentRouteAdmission.COMMITTED, reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { true })
    }

    @Test
    fun manualRouteAdmissionDoesNotRequireReadyOrAdmissionOpen() = runSuspending {
        val reducer = AgentStatusReducer()
        assertTrue(reducer.install(snapshot(10uL, 7uL, AgentStatusAvailability.UNAVAILABLE)))
        assertFalse(reducer.state.value.admissionOpen)
        val revision = reducer.state.value.routeAuthorityRevision
        assertEquals(
            AgentRouteAdmission.COMMITTED,
            reducer.tryAdmitTerminalAgentsRoute(owner, socket, 7uL, revision) { true },
        )
    }

    @Test
    fun typedSnapshotFailureIsCaptureQualifiedAndClearedBySuccess() = runSuspending {
        val reducer = AgentStatusReducer()
        assertTrue(reducer.bindRuntime(owner, socket))
        val first = assertNotNull(reducer.captureSnapshot(owner, socket))
        reducer.abandonSnapshot(first, "HTTP 404", TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND)
        assertEquals(TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND, reducer.state.value.snapshotFailure)
        assertEquals("HTTP 404", reducer.state.value.lastError) // human text kept, never parsed
        // Notification baseline/admission/high-water are untouched by a typed failure.
        assertFalse(reducer.state.value.baselineInstalled)
        assertFalse(reducer.state.value.admissionOpen)
        assertTrue(reducer.state.value.unreadAttentions.isEmpty())

        // A successor capture closes the old typed failure while loading; the superseded capture's delayed failure is
        // rejected and cannot alter the successor.
        val second = assertNotNull(reducer.captureSnapshot(owner, socket))
        assertNull(reducer.state.value.snapshotFailure)
        val third = assertNotNull(reducer.captureSnapshot(owner, socket))
        reducer.abandonSnapshot(second, "late", TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND)
        assertNull(reducer.state.value.snapshotFailure)
        assertTrue(reducer.state.value.isSnapshotLoading)

        // A successful current snapshot clears typed failure; OTHER failures stay OTHER.
        assertTrue(reducer.applySnapshot(third, snapshot(10uL, 1uL, AgentStatusAvailability.READY)))
        assertNull(reducer.state.value.snapshotFailure)
        val fourth = assertNotNull(reducer.captureSnapshot(owner, socket))
        reducer.abandonSnapshot(fourth, "boom", TerminalAgentsSnapshotFailure.OTHER)
        assertEquals(TerminalAgentsSnapshotFailure.OTHER, reducer.state.value.snapshotFailure)
    }
}
