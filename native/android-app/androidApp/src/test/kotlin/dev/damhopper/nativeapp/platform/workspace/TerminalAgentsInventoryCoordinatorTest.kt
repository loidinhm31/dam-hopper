package dev.damhopper.nativeapp.platform.workspace

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentObservationSource
import dev.damhopper.nativeapp.features.terminal.AgentState
import dev.damhopper.nativeapp.features.terminal.AgentStatusAvailability
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentStatusSnapshotV1
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsProjector
import dev.damhopper.nativeapp.features.terminal.TerminalAgentStatusRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInventoryHealth
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRuntimeKey
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Controlled-completion tests of the retained owner-qualified inventory authority: shared coalesced fetch, trailing
 * reconciliation, fresh refresh, failure, same-generation equal-socket object replacement, registrations, display
 * cache vs identity loss, exact exit pruning and stale publication.
 */
class TerminalAgentsInventoryCoordinatorTest {

    private val connection = ConnectionRef("prof", 1L)
    private val socket = SocketInstanceRef(connection, "sock-1")
    private val endpoint = "http://127.0.0.1:1"
    private val labels = mapOf("prof" to "Server")
    private val projector = DefaultTerminalAgentsProjector()
    private lateinit var scope: CoroutineScope

    @BeforeTest
    fun setUp() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
    }

    private class FakeList {
        val calls = AtomicInteger(0)
        var script: suspend (Int) -> List<TerminalSessionDetailed> = { emptyList() }
        suspend fun list(): List<TerminalSessionDetailed> = script(calls.getAndIncrement())
    }

    private fun session(id: String, incarnation: ULong = 1uL, project: String = "proj") =
        TerminalSessionDetailed(id = id, incarnation = incarnation, project = project, command = "sh", cwd = "/work")

    private fun owner(project: String = "proj") =
        WorkspaceFileOwner(profileId = "prof", baseUrl = endpoint, accountUser = "alice", project = project)

    private fun binding(
        list: FakeList,
        ws: WsConnection = WsConnection(connection, endpoint),
        reducer: AgentStatusReducer = AgentStatusReducer(),
    ) = TerminalAgentsRuntimeBinding(connection, endpoint, "alice", ws, reducer, scope) { list.list() }

    private fun agentRow(id: String, incarnation: ULong = 1uL) = TerminalAgentStatusRow(
        id = id,
        incarnation = incarnation,
        agentKind = AgentKind.OMP,
        agentSessionId = "sess-$id",
        reporterEpoch = 1uL,
        state = AgentState.WORKING,
        source = AgentObservationSource.LIFECYCLE,
        attentionRevision = 1uL,
    )

    private suspend fun baselineReducer(vararg rows: TerminalAgentStatusRow, on: SocketInstanceRef = socket): AgentStatusReducer {
        val reducer = AgentStatusReducer()
        reducer.bindRuntime(connection, on)
        val capture = reducer.captureSnapshot(connection, on)!!
        reducer.applySnapshot(capture, AgentStatusSnapshotV1(1u, 5uL, 10uL, AgentStatusAvailability.READY, rows.toList()))
        return reducer
    }

    private suspend fun <T : Any> eventually(block: () -> T?): T = withTimeout(10_000) {
        var value = block()
        while (value == null) {
            delay(10)
            value = block()
        }
        checkNotNull(value)
    }

    private fun statuses(coordinator: TerminalAgentsInventoryCoordinator): List<TerminalAgentsStatus> =
        projector.rows(coordinator.snapshotInput(labels).input).map { it.presentation.status }

    @Test
    fun connectedSocketTriggersOneSharedFetchAndPublishesTheAcceptedReceipt() = runBlocking {
        val list = FakeList().apply { script = { listOf(session("t1")) } }
        val coordinator = TerminalAgentsInventoryCoordinator()
        val att = coordinator.attach(binding(list))
        assertEquals(1L, att.incarnation)

        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        assertEquals(TerminalAgentsRuntimeKey(connection, socket, 1L, endpoint, "alice"), receipt.runtime)
        assertEquals(listOf("t1"), receipt.sessions.map { it.id })
        delay(150)
        assertEquals(1, list.calls.get(), "exactly one shared list per runtime, no polling")
    }

    @Test
    fun invalidationDuringAFetchProducesATrailingFetchNotLostWork() = runBlocking {
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val list = FakeList().apply {
            script = { index ->
                if (index == 0) {
                    firstStarted.complete(Unit)
                    releaseFirst.await()
                    listOf(session("old"))
                } else {
                    listOf(session("old"), session("new"))
                }
            }
        }
        val coordinator = TerminalAgentsInventoryCoordinator()
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        withTimeout(10_000) { firstStarted.await() }

        coordinator.invalidate(att, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE) // during the fetch
        assertTrue(coordinator.inventories.value.isEmpty())
        releaseFirst.complete(Unit)

        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        assertEquals(listOf("old", "new"), receipt.sessions.map { it.id }, "the discarded first result never became current")
        assertEquals(2, list.calls.get())
        assertEquals(2L, receipt.invalidationRevision)
    }

    @Test
    fun refreshStartsAFreshFetchAfterTheCallInsteadOfJoiningAnOlderInFlightOne() = runBlocking {
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val list = FakeList().apply {
            script = { index ->
                if (index == 0) {
                    firstStarted.complete(Unit)
                    releaseFirst.await()
                    listOf(session("old"))
                } else {
                    listOf(session("new"))
                }
            }
        }
        val coordinator = TerminalAgentsInventoryCoordinator()
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        withTimeout(10_000) { firstStarted.await() }
        val runtime = coordinator.currentRuntimeKeys().single()

        val refresh = async(Dispatchers.Default) {
            coordinator.refresh(runtime, TerminalAgentsRefreshReason.ACTIVATION_VALIDATION)
        }
        delay(100)
        assertFalse(refresh.isCompleted, "the pre-existing in-flight fetch cannot satisfy a request made after it started")
        releaseFirst.complete(Unit)

        val receipt = withTimeout(10_000) { refresh.await() }
        assertEquals(listOf("new"), receipt?.sessions?.map { it.id })
        assertEquals(2, list.calls.get())
    }

    @Test
    fun aFailedFetchMakesTheInventoryUnavailableFailsWaitersAndNeverRetries() = runBlocking {
        val list = FakeList().apply { script = { error("boom") } }
        val coordinator = TerminalAgentsInventoryCoordinator()
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val runtime = coordinator.currentRuntimeKeys().single()

        assertNull(withTimeout(10_000) { coordinator.refresh(runtime, TerminalAgentsRefreshReason.USER_RETRY) })
        assertTrue(coordinator.inventories.value.isEmpty())
        eventually {
            coordinator.snapshotInput(labels).input.runtimes.singleOrNull()
                ?.takeIf { it.inventoryHealth == TerminalAgentsInventoryHealth.UNAVAILABLE }
        }
        val settled = list.calls.get()
        assertTrue(settled in 1..2, "bounded by the two triggers, never a retry loop: $settled")
        delay(300)
        assertEquals(settled, list.calls.get())
    }

    @Test
    fun sameGenerationEqualSocketReplacementObjectAllocatesADistinctAttachmentAndOldCallbacksCannotAct() = runBlocking {
        val list = FakeList().apply { script = { listOf(session("t1")) } }
        val coordinator = TerminalAgentsInventoryCoordinator()
        val ws1 = WsConnection(connection, endpoint)
        val ws2 = WsConnection(connection, endpoint)
        val att1 = coordinator.attach(binding(list, ws = ws1))
        coordinator.onSocketState(att1, socket, TerminalAgentsRefreshReason.CONNECTED)
        val key1 = eventually { coordinator.inventories.value.keys.singleOrNull() }

        // A replaced connection OBJECT (same ConnectionRef, equal sock-1) is a new attachment with a new token.
        val att2 = coordinator.attach(binding(list, ws = ws2))
        assertEquals(2L, att2.incarnation)
        assertTrue(att1.revoked)
        assertTrue(coordinator.inventories.value.isEmpty(), "the replaced attachment's authority is revoked first")
        assertSame(att2, coordinator.attach(binding(list, ws = ws2)), "the same object is idempotent")

        coordinator.onSocketState(att2, socket, TerminalAgentsRefreshReason.CONNECTED)
        val key2 = eventually { coordinator.inventories.value.keys.singleOrNull() }
        assertEquals(key1.connection, key2.connection)
        assertEquals(key1.socket, key2.socket)
        assertNotEquals(key1, key2)
        assertEquals(1L, key1.attachmentIncarnation)
        assertEquals(2L, key2.attachmentIncarnation)

        // Old callbacks can neither publish, purge, invalidate nor route the successor's state.
        coordinator.onSocketState(att1, null, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        coordinator.invalidate(att1, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        coordinator.onTerminalExit(att1, "t1", 1uL, willRestart = false)
        assertEquals(setOf(key2), coordinator.inventories.value.keys)
        assertNull(coordinator.refresh(key1, TerminalAgentsRefreshReason.USER_RETRY))
        assertFalse(coordinator.isCurrentSocket(att1, socket))
        assertTrue(coordinator.isCurrentSocket(att2, socket))
    }

    @Test
    fun registrationsKeepFirstOrderAndCloseRetiresExactlyThatRegistration() = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val a = coordinator.registerWorkspace(owner("A"))
        val b = coordinator.registerWorkspace(owner("B"))
        assertEquals(listOf(1L, 2L), listOf(a.order, b.order))
        assertSame(a, coordinator.registerWorkspace(owner("A")), "re-registering a live owner keeps id and order")

        val list = FakeList().apply { script = { listOf(session("a1", project = "A"), session("b1", project = "B")) } }
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        coordinator.publishWorkspaceTabs(b, receipt, listOf(session("b1", project = "B")), emptySet())
        assertEquals(listOf(b), coordinator.snapshotInput(labels).input.workspaces.map { it.registration })

        coordinator.closeWorkspace(b)
        assertTrue(coordinator.snapshotInput(labels).input.workspaces.isEmpty())
        val reRegistered = coordinator.registerWorkspace(owner("B"))
        assertNotEquals(b.registrationId, reRegistered.registrationId)
        // A closed registration's old receipt/target can neither be republished nor revived.
        coordinator.publishWorkspaceTabs(b, receipt, listOf(session("b1", project = "B")), emptySet())
        assertTrue(coordinator.snapshotInput(labels).input.workspaces.isEmpty())
    }

    @Test
    fun oneSharedServerListRefreshesEveryInactiveRegisteredWorkspaceWithItsLastExclusions() = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val regA = coordinator.registerWorkspace(owner("A"))
        val regB = coordinator.registerWorkspace(owner("B"))
        val list = FakeList().apply {
            script = { index ->
                val base = listOf(session("a1", project = "A"), session("b1", project = "B"))
                if (index == 0) base else base + session("b2", project = "B") + session("b3", project = "B")
            }
        }
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val first = eventually { coordinator.inventories.value.values.singleOrNull() }
        coordinator.publishWorkspaceTabs(regA, first, listOf(session("a1", project = "A")), emptySet())
        coordinator.publishWorkspaceTabs(regB, first, listOf(session("b1", project = "B")), setOf("b3"))

        val second = coordinator.refresh(first.runtime, TerminalAgentsRefreshReason.SIDEBAR_OPENED)
        assertEquals(4, second?.sessions?.size)
        val workspaces = coordinator.snapshotInput(labels).input.workspaces.associateBy { it.registration }
        assertEquals(listOf("a1"), workspaces.getValue(regA).visibleTabs.map { it.id })
        assertEquals(listOf("b1", "b2"), workspaces.getValue(regB).visibleTabs.map { it.id }, "b3 stays explicitly excluded")
        assertEquals(2, list.calls.get(), "one list per refresh serves every registered workspace")
        assertEquals(second?.requestTicket, workspaces.getValue(regB).inventoryTicket)
    }

    @Test
    fun anInvalidatedReceiptCannotPublishTabsAndUnpublishedRegistrationsAreNeverManufactured(): Unit = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val reg = coordinator.registerWorkspace(owner())
        val release = CompletableDeferred<Unit>()
        val list = FakeList().apply {
            script = { index -> if (index == 0) listOf(session("t1")) else { release.await(); listOf(session("t1")) } }
        }
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        // Inventory acceptance alone never manufactures published tabs.
        assertTrue(coordinator.snapshotInput(labels).input.workspaces.isEmpty())

        coordinator.invalidate(att, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        coordinator.publishWorkspaceTabs(reg, receipt, listOf(session("t1")), emptySet())
        assertTrue(coordinator.snapshotInput(labels).input.workspaces.isEmpty(), "a stale receipt publishes nothing")
        release.complete(Unit)
        Unit
    }

    @Test
    fun anExactNonNullExitPrunesItsOwnInstanceOnlyAndEveryExitReconciles(): Unit = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val reg = coordinator.registerWorkspace(owner())
        val release = CompletableDeferred<Unit>()
        val list = FakeList().apply {
            script = { index -> if (index == 0) listOf(session("t1"), session("t2")) else { release.await(); listOf(session("t2")) } }
        }
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        coordinator.publishWorkspaceTabs(reg, receipt, listOf(session("t1"), session("t2")), emptySet())
        fun tabs() = coordinator.snapshotInput(labels).input.workspaces.single().visibleTabs.map { it.id }
        assertEquals(listOf("t1", "t2"), tabs())

        // A null incarnation, another incarnation or an announced restart only reconcile (never prune).
        coordinator.onTerminalExit(att, "t1", null, willRestart = false)
        coordinator.onTerminalExit(att, "t1", 9uL, willRestart = false)
        coordinator.onTerminalExit(att, "t1", 1uL, willRestart = true)
        assertEquals(listOf("t1", "t2"), tabs())

        // The exact owned instance is pruned at once; the reconciliation still follows.
        coordinator.onTerminalExit(att, "t1", 1uL, willRestart = false)
        assertEquals(listOf("t2"), tabs())
        assertTrue(coordinator.inventories.value.isEmpty(), "the exit also invalidated the accepted receipt")
        release.complete(Unit)
        eventually { coordinator.inventories.value.values.singleOrNull() }
        Unit
    }

    @Test
    fun anUnknownNewObservedTerminalInvalidatesButKnownOnesDoNot() = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val list = FakeList().apply { script = { listOf(session("t1")) } }
        val att = coordinator.attach(binding(list))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        eventually { coordinator.inventories.value.values.singleOrNull() }
        val callsBefore = list.calls.get()

        coordinator.onAgentObservations(att, listOf(agentRow("t1")))
        delay(150)
        assertEquals(callsBefore, list.calls.get(), "a terminal already in the accepted inventory needs no refetch")

        coordinator.onAgentObservations(att, listOf(agentRow("t1"), agentRow("t-new")))
        eventually { if (list.calls.get() > callsBefore) true else null }
        eventually { coordinator.inventories.value.values.singleOrNull() }
        coordinator.onAgentObservations(att, listOf(agentRow("t1"), agentRow("t-new")))
        val settled = list.calls.get()
        delay(150)
        assertEquals(settled, list.calls.get(), "the same unknown pair triggers once, not repeatedly")
    }

    @Test
    fun transportLossKeepsDisplayOnlyUnavailableRowsWhileIdentityLossPurgesExactlyThatOwner() = runBlocking {
        val coordinator = TerminalAgentsInventoryCoordinator()
        val reg = coordinator.registerWorkspace(owner())
        val list = FakeList().apply { script = { listOf(session("term-1")) } }
        val att = coordinator.attach(binding(list, reducer = baselineReducer(agentRow("term-1"))))
        coordinator.onSocketState(att, socket, TerminalAgentsRefreshReason.CONNECTED)
        val receipt = eventually { coordinator.inventories.value.values.singleOrNull() }
        coordinator.publishWorkspaceTabs(reg, receipt, listOf(session("term-1")), emptySet())
        assertEquals(listOf(TerminalAgentsStatus.WORKING), statuses(coordinator))

        // Temporary loss: the last qualified membership stays visible but display-only Unavailable.
        coordinator.onSocketState(att, null, TerminalAgentsRefreshReason.TERMINAL_LIFECYCLE)
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statuses(coordinator))

        // Rebind to a replacement object without a requalified status baseline: still Unavailable, never READY.
        val socket2 = SocketInstanceRef(connection, "sock-2")
        val att2 = coordinator.attach(binding(list, ws = WsConnection(connection, endpoint)))
        coordinator.onSocketState(att2, socket2, TerminalAgentsRefreshReason.CONNECTED)
        eventually { coordinator.inventories.value.values.singleOrNull() }
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statuses(coordinator))

        // Identity loss (generation retirement) purges exactly that owner's membership and observations.
        coordinator.retireIdentity(connection)
        assertTrue(statuses(coordinator).isEmpty())
        assertTrue(coordinator.inventories.value.isEmpty())
    }
}
