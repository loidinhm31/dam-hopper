package dev.damhopper.nativeapp.features.terminal

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Required transport behaviour of the typed Agents availability: a controlled REAL HTTP response from an ephemeral
 * loopback JDK server travels through the real Ktor [ApiClient] -> [TerminalRepository] -> existing
 * [AgentStatusReducer] -> [DefaultTerminalAgentsProjector]. No method-return mock, product hook, dependency or
 * old-version artifact: this is current transport behaviour, not older-server compatibility.
 */
class TerminalAgentsHttpAvailabilityTest {

    private class Reply(
        val status: Int,
        val body: String,
        val arrived: CountDownLatch? = null,
        val gate: CountDownLatch? = null,
    )

    private lateinit var server: HttpServer
    private val requests = AtomicInteger(0)

    @Volatile
    private var script: (Int) -> Reply = { Reply(200, snapshotJson()) }

    private val connection = ConnectionRef("prof", 1L)
    private val socket = SocketInstanceRef(connection, "sock-1")
    private val projector = DefaultTerminalAgentsProjector()

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = Executors.newCachedThreadPool()
        server.createContext("/api/agent-status/v1/snapshot") { exchange ->
            val reply = script(requests.getAndIncrement())
            reply.arrived?.countDown()
            reply.gate?.await(15, TimeUnit.SECONDS)
            val bytes = reply.body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(reply.status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @AfterTest
    fun tearDown() {
        server.stop(0)
        (server.executor as? ExecutorService)?.shutdownNow()
    }

    private fun snapshotJson(revision: Int = 10): String =
        """{"version":1,"serverEpoch":5,"revision":$revision,"availability":"ready","terminals":[""" +
            """{"id":"term-1","incarnation":1,"agentKind":"omp","agentSessionId":"sess-1","reporterEpoch":1,""" +
            """"state":"working","source":"lifecycle","attentionRevision":1}]}"""

    private val notFound = Reply(404, """{"error":"Not Found"}""")

    private val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    private fun newReducer(): AgentStatusReducer {
        val client = ApiClient(connection, baseUrl, { "test-token" })
        return AgentStatusReducer(TerminalRepository(client, null))
    }

    private val session = TerminalSessionDetailed(id = "term-1", incarnation = 1uL, project = "proj", command = "omp", cwd = "/work")

    /** The roster input a retained runtime would publish for the reducer's current state (current socket + inventory). */
    private fun input(state: AgentStatusState, cached: List<TerminalAgentStatusRow>): TerminalAgentsProjectionInput {
        val owner = WorkspaceFileOwner(profileId = "prof", baseUrl = baseUrl, accountUser = "alice", project = "proj")
        val runtime = TerminalAgentsRuntimeKey(connection, socket, 1L, owner.normalizedBaseUrl, "alice")
        val receipt = TerminalAgentsInventoryReceipt(runtime, requestTicket = 1L, invalidationRevision = 1L, sessions = listOf(session))
        return TerminalAgentsProjectionInput(
            workspaces = listOf(
                TerminalAgentsWorkspaceSnapshot(
                    registration = TerminalAgentsRegistration(owner, 1L, 1L),
                    runtime = runtime,
                    inventoryTicket = 1L,
                    visibleTabs = listOf(session),
                    excludedTerminalIds = emptySet(),
                ),
            ),
            runtimes = listOf(
                TerminalAgentsRuntimeSnapshot(
                    runtime = runtime,
                    isCurrentIdentity = true,
                    isCurrentConnectedSocket = true,
                    inventoryHealth = TerminalAgentsInventoryHealth.CURRENT,
                    inventory = receipt,
                    statusBaselineInstalled = state.baselineInstalled,
                    statusAuthorityRevision = state.routeAuthorityRevision,
                    status = state,
                    snapshotFailure = state.snapshotFailure,
                    cachedObservations = cached,
                ),
            ),
            profileLabels = mapOf("prof" to "Server"),
        )
    }

    private fun statuses(state: AgentStatusState, cached: List<TerminalAgentStatusRow>): List<TerminalAgentsStatus> =
        projector.rows(input(state, cached)).map { it.presentation.status }

    @Test
    fun currentHttp404BecomesTypedUnsupportedWithoutAnInventedRowOrAnAutomaticRetry() = runBlocking {
        script = { index -> if (index == 0) Reply(200, snapshotJson()) else notFound }
        val reducer = newReducer()
        assertTrue(reducer.bindRuntime(connection, socket))

        assertTrue(reducer.reloadSnapshot(connection, socket))
        assertEquals(listOf(TerminalAgentsStatus.WORKING), statuses(reducer.state.value, emptyList()))
        val cached = reducer.state.value.agents.values.toList()

        // A real HTTP 404 reaches the reducer as the typed ApiRequestError.status; the text is never parsed.
        assertFalse(reducer.reloadSnapshot(connection, socket))
        val state = reducer.state.value
        assertEquals(TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND, state.snapshotFailure)
        assertFalse(state.baselineInstalled)
        assertFalse(state.admissionOpen)
        assertTrue(state.unreadAttentions.isEmpty(), "no notification/attention is produced")
        assertEquals(listOf(TerminalAgentsStatus.UNSUPPORTED), statuses(state, cached))

        // No automatic retry loop: the repository/reducer issued exactly the two requests the test asked for.
        delay(300)
        assertEquals(2, requests.get())

        // A later successful current snapshot clears the typed failure.
        script = { Reply(200, snapshotJson(revision = 12)) }
        assertTrue(reducer.reloadSnapshot(connection, socket))
        assertNull(reducer.state.value.snapshotFailure)
        assertEquals(listOf(TerminalAgentsStatus.WORKING), statuses(reducer.state.value, emptyList()))
        assertEquals(3, requests.get())
    }

    @Test
    fun aFirstEverHttp404ProducesTypedUnsupportedAndNeverInventsRowsOrNotifications() = runBlocking {
        script = { notFound }
        val reducer = newReducer()
        assertTrue(reducer.bindRuntime(connection, socket))
        assertFalse(reducer.reloadSnapshot(connection, socket))

        val state = reducer.state.value
        assertEquals(TerminalAgentsSnapshotFailure.HTTP_NOT_FOUND, state.snapshotFailure)
        assertTrue(state.agents.isEmpty())
        assertTrue(state.unreadAttentions.isEmpty())
        val projection = projector.project(input(state, emptyList()), TerminalAgentsFilterSelection.All)
        assertEquals(0, projection.counts.all, "no matching observation means no agent row")
        assertEquals(1, requests.get())
    }

    @Test
    fun aNon404FailureWhoseTextMentions404StaysOtherNotUnsupported() = runBlocking {
        script = { index ->
            when (index) {
                0 -> Reply(200, snapshotJson())
                1 -> Reply(500, """{"error":"upstream returned 404 not found"}""")
                else -> Reply(503, """{"error":"HTTP 404 page cache"}""")
            }
        }
        val reducer = newReducer()
        reducer.bindRuntime(connection, socket)
        assertTrue(reducer.reloadSnapshot(connection, socket))
        val cached = reducer.state.value.agents.values.toList()

        assertFalse(reducer.reloadSnapshot(connection, socket))
        assertEquals(TerminalAgentsSnapshotFailure.OTHER, reducer.state.value.snapshotFailure)
        assertTrue(reducer.state.value.lastError.orEmpty().contains("404"), "human text keeps the 404 wording")
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statuses(reducer.state.value, cached))

        assertFalse(reducer.reloadSnapshot(connection, socket))
        assertEquals(TerminalAgentsSnapshotFailure.OTHER, reducer.state.value.snapshotFailure)
        assertEquals(listOf(TerminalAgentsStatus.UNAVAILABLE), statuses(reducer.state.value, cached))
        assertEquals(3, requests.get())
    }

    @Test
    fun aDelayed404OfASupersededCaptureCannotAlterItsSuccessor() = runBlocking {
        val firstArrived = CountDownLatch(1)
        val releaseFirst = CountDownLatch(1)
        script = { index ->
            if (index == 0) Reply(404, """{"error":"Not Found"}""", arrived = firstArrived, gate = releaseFirst)
            else Reply(200, snapshotJson())
        }
        val reducer = newReducer()
        reducer.bindRuntime(connection, socket)

        // Capture #1 is in flight at the server, held before its 404 is sent.
        val older = async(Dispatchers.Default) { reducer.reloadSnapshot(connection, socket) }
        assertTrue(withContext(Dispatchers.IO) { firstArrived.await(15, TimeUnit.SECONDS) })

        // Capture #2 supersedes it and installs the current baseline from a real 200.
        assertTrue(reducer.reloadSnapshot(connection, socket))
        assertEquals(listOf(TerminalAgentsStatus.WORKING), statuses(reducer.state.value, emptyList()))

        // The old capture's 404 now arrives: it is rejected and never touches the successor.
        releaseFirst.countDown()
        assertFalse(older.await())
        val state = reducer.state.value
        assertNull(state.snapshotFailure, "a stale 404 never becomes the successor's typed failure")
        assertTrue(state.baselineInstalled)
        assertEquals(listOf(TerminalAgentsStatus.WORKING), statuses(state, emptyList()))
        assertEquals(2, requests.get())
    }
}
