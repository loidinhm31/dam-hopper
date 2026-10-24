package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.transport.ServerMsg
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentStatusReducerTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun makeAgentRow(
        id: String,
        incarnation: ULong,
        state: AgentState = AgentState.WORKING,
        attentionRev: ULong = 1uL,
    ): TerminalAgentStatusRow {
        return TerminalAgentStatusRow(
            id = id,
            incarnation = incarnation,
            agentKind = AgentKind.OMP,
            agentSessionId = "sess-$id",
            reporterEpoch = 1uL,
            state = state,
            source = AgentObservationSource.LIFECYCLE,
            attentionRevision = attentionRev
        )
    }

    @Test
    fun testApplySnapshotEstablishesEpochAndRevision() {
        runBlocking {
            val reducer = AgentStatusReducer()
            val snapshot = AgentStatusSnapshotV1(
                serverEpoch = 10uL,
                revision = 50uL,
                availability = AgentStatusAvailability.READY,
                terminals = listOf(
                    makeAgentRow("term-1", 1uL, AgentState.WORKING),
                    makeAgentRow("term-2", 2uL, AgentState.IDLE)
                )
            )

            reducer.applySnapshot(snapshot)
            val state = reducer.state.value

            assertEquals(10uL, state.serverEpoch)
            assertEquals(50uL, state.revision)
            assertEquals(AgentStatusAvailability.READY, state.availability)
            assertEquals(2, state.agents.size)
            assertNotNull(state.findAgentForSession("term-1", 1uL))
            assertNull(state.findAgentForSession("term-1", 99uL)) // Incarnation mismatch fails closed
        }
    }

    @Test
    fun testMonotonicRevisionFencingWithinEpoch() {
        runBlocking {
            val reducer = AgentStatusReducer()
            val snapshot = AgentStatusSnapshotV1(
                serverEpoch = 10uL,
                revision = 50uL,
                availability = AgentStatusAvailability.READY,
                terminals = emptyList()
            )
            reducer.applySnapshot(snapshot)

            // 1. Older revision (45 <= 50) -> ignored
            val staleRow = makeAgentRow("term-stale", 1uL)
            reducer.applyStatusChanged(
                ServerMsg.AgentStatusChanged(
                    serverEpoch = 10uL,
                    revision = 45uL,
                    row = json.encodeToJsonElement(staleRow)
                )
            )
            assertEquals(50uL, reducer.state.value.revision)
            assertNull(reducer.state.value.agents["term-stale"])

            // 2. Newer revision (51 > 50) -> accepted
            val freshRow = makeAgentRow("term-fresh", 1uL)
            reducer.applyStatusChanged(
                ServerMsg.AgentStatusChanged(
                    serverEpoch = 10uL,
                    revision = 51uL,
                    row = json.encodeToJsonElement(freshRow)
                )
            )
            assertEquals(51uL, reducer.state.value.revision)
            assertNotNull(reducer.state.value.agents["term-fresh"])
        }
    }

    @Test
    fun testAttentionEventDeduplicationAndDismissal() {
        runBlocking {
            val reducer = AgentStatusReducer()
            val snapshot = AgentStatusSnapshotV1(
                serverEpoch = 1uL,
                revision = 10uL,
                availability = AgentStatusAvailability.READY,
                terminals = listOf(makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 5uL))
            )
            reducer.applySnapshot(snapshot)
            // Historical attention in snapshot should NOT generate unread notifications
            assertEquals(0, reducer.state.value.unreadAttentions.size)

            // Live attention event
            val attention = AgentAttentionEvent(
                id = "1:term-1:1:6",
                kind = AttentionKind.NEEDS_ATTENTION,
                terminalId = "term-1",
                incarnation = 1uL,
                agentKind = AgentKind.OMP,
                agentSessionId = "sess-term-1",
                reason = BlockedReason.APPROVAL,
                attentionRevision = 6uL,
                timestampMs = 1000uL
            )
            val row = makeAgentRow("term-1", 1uL, AgentState.BLOCKED, attentionRev = 6uL)
            reducer.applyStatusChanged(
                ServerMsg.AgentStatusChanged(
                    serverEpoch = 1uL,
                    revision = 11uL,
                    row = json.encodeToJsonElement(row),
                    attention = json.encodeToJsonElement(attention)
                )
            )

            assertEquals(1, reducer.state.value.unreadAttentions.size)
            assertEquals("1:term-1:1:6", reducer.state.value.unreadAttentions[0].id)

            // Duplicate attention arrival should not duplicate
            reducer.applyStatusChanged(
                ServerMsg.AgentStatusChanged(
                    serverEpoch = 1uL,
                    revision = 12uL,
                    row = json.encodeToJsonElement(row),
                    attention = json.encodeToJsonElement(attention)
                )
            )
            assertEquals(1, reducer.state.value.unreadAttentions.size)

            // Dismissal
            reducer.dismissAttention("1:term-1:1:6")
            assertEquals(0, reducer.state.value.unreadAttentions.size)
        }
    }

    @Test
    fun testStatusRemovedFencing() {
        runBlocking {
            val reducer = AgentStatusReducer()
            reducer.applySnapshot(
                AgentStatusSnapshotV1(
                    serverEpoch = 1uL,
                    revision = 10uL,
                    availability = AgentStatusAvailability.READY,
                    terminals = listOf(makeAgentRow("term-1", 2uL))
                )
            )
            assertNotNull(reducer.state.value.agents["term-1"])

            // Removed event for older incarnation (1 <= 2) should not remove newer incarnation
            reducer.applyStatusRemoved(
                ServerMsg.AgentStatusRemoved(
                    serverEpoch = 1uL,
                    revision = 11uL,
                    terminalId = "term-1",
                    incarnation = 1uL
                )
            )
            assertNotNull(reducer.state.value.agents["term-1"])

            // Removed event for exact/newer incarnation removes it
            reducer.applyStatusRemoved(
                ServerMsg.AgentStatusRemoved(
                    serverEpoch = 1uL,
                    revision = 12uL,
                    terminalId = "term-1",
                    incarnation = 2uL
                )
            )
            assertNull(reducer.state.value.agents["term-1"])
        }
    }

    @Test
    fun testFilterAgents() {
        runBlocking {
            val reducer = AgentStatusReducer()
            reducer.applySnapshot(
                AgentStatusSnapshotV1(
                    serverEpoch = 1uL,
                    revision = 10uL,
                    availability = AgentStatusAvailability.READY,
                    terminals = listOf(
                        makeAgentRow("t-work", 1uL, AgentState.WORKING),
                        makeAgentRow("t-block", 1uL, AgentState.BLOCKED),
                        makeAgentRow("t-idle", 1uL, AgentState.IDLE)
                    )
                )
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
    }
}
