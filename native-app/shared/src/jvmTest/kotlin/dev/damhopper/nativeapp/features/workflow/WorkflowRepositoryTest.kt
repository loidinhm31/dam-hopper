package dev.damhopper.nativeapp.features.workflow

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class WorkflowRepositoryTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    private fun createRepository(): WorkflowRepository {
        val conn = ConnectionRef("test-profile", 1L)
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
        return WorkflowRepository(client)
    }

    @Test
    fun testOverview404SignalsUnavailableFeature() = runTest {
        server!!.createContext("/api/workflow/overview") { exchange ->
            val json = """{"error":"Route not found","code":"not_found"}"""
            exchange.sendResponseHeaders(404, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.getOverview()
        assertTrue(result.isSuccess)
        val value = result.getOrNull()
        assertIs<WorkflowOverviewResult.Unavailable>(value)
        assertEquals("Workflow tracking is unavailable for this profile.", value.message)
    }

    @Test
    fun testOverview500ThrowsApiRequestError() = runTest {
        server!!.createContext("/api/workflow/overview") { exchange ->
            val json = """{"error":"Internal error","code":"workflow_store_unavailable"}"""
            exchange.sendResponseHeaders(503, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.getOverview()
        assertTrue(result.isFailure)
        val err = result.exceptionOrNull()
        assertIs<ApiRequestError>(err)
        assertEquals(503, err.status)
        assertEquals("workflow_store_unavailable", err.code)
    }

    @Test
    fun testPatchItemCasConflict409() = runTest {
        server!!.createContext("/api/workflow/items/item-1") { exchange ->
            val json = """{"error":"Workflow request conflicts with current state","code":"workflow_conflict"}"""
            exchange.sendResponseHeaders(409, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val req = PatchItemRequest(
            requestId = "req-1",
            updatedAt = "2026-09-02T10:00:00.000Z",
            title = "Updated"
        )
        val result = repo.patchItem("item-1", req)
        assertTrue(result.isFailure)
        val err = result.exceptionOrNull()
        assertIs<ApiRequestError>(err)
        assertEquals(409, err.status)
        assertEquals("workflow_conflict", err.code)
    }

    @Test
    fun testCreateItemReplayResponse() = runTest {
        server!!.createContext("/api/workflow/items") { exchange ->
            val json = """
                {
                  "resource": {
                    "id": "item-123",
                    "target": { "project": "api" },
                    "kind": "task",
                    "title": "Task 1",
                    "status": "backlog",
                    "sortOrder": 0,
                    "source": "manual",
                    "createdAt": "2026-09-02T10:00:00.000Z",
                    "updatedAt": "2026-09-02T10:00:00.000Z"
                  },
                  "replayed": true,
                  "eventId": "event-uuid-1"
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val req = CreateItemRequest(
            requestId = "req-replay-1",
            target = WorkflowTargetDto(project = "api"),
            kind = ItemKind.TASK,
            title = "Task 1"
        )
        val result = repo.createItem(req)
        assertTrue(result.isSuccess)
        val mutation = result.getOrThrow()
        assertTrue(mutation.replayed)
        assertEquals("item-123", mutation.resource.id)
        assertEquals("event-uuid-1", mutation.eventId)
    }

    @Test
    fun testPurgeHistory() = runTest {
        server!!.createContext("/api/workflow/history") { exchange ->
            val json = """{"eventsDeleted":42,"notesDeleted":3}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = createRepository()
        val result = repo.purgeHistory("2026-01-01T00:00:00.000Z")
        assertTrue(result.isSuccess)
        val purge = result.getOrThrow()
        assertEquals(42, purge.eventsDeleted)
        assertEquals(3, purge.notesDeleted)
    }
}
