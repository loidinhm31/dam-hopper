package dev.damhopper.nativeapp.features.agents

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*

class AgentStoreAndMemoryRepositoryTest {

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

    private fun createApiClient(): ApiClient {
        val conn = ConnectionRef("test-profile", 1L)
        return ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "test-token" }
        )
    }

    @Test
    fun testListItemsAvailable() = runTest {
        server!!.createContext("/api/agent-store") { exchange ->
            val json = """
                [
                    {
                        "name": "reviewer",
                        "category": "skill",
                        "relativePath": "skills/reviewer/SKILL.md",
                        "description": "Reviews code",
                        "compatibleAgents": ["claude"],
                        "sizeBytes": 1024
                    }
                ]
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val result = repo.listItems()
        assertTrue(result.isSuccess)
        val catalog = result.getOrNull()
        assertIs<AgentStoreCatalogResult.Available>(catalog)
        assertEquals(1, catalog.items.size)
        assertEquals("reviewer", catalog.items[0].name)
    }

    @Test
    fun testListItems404SignalsUnavailableFeature() = runTest {
        server!!.createContext("/api/agent-store") { exchange ->
            val json = """{"error":"Not found"}"""
            exchange.sendResponseHeaders(404, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val result = repo.listItems()
        assertTrue(result.isSuccess)
        val catalog = result.getOrNull()
        assertIs<AgentStoreCatalogResult.Unavailable>(catalog)
        assertEquals("Agent Store is unavailable for this profile.", catalog.message)
    }

    @Test
    fun testGetItemFoundAndNotFound() = runTest {
        server!!.createContext("/api/agent-store/skill/found-item") { exchange ->
            val json = """
                {
                    "name": "found-item",
                    "category": "skill",
                    "relativePath": "skills/found/SKILL.md",
                    "compatibleAgents": []
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-store/skill/missing-item") { exchange ->
            val json = """{"error":"Item not found: missing-item"}"""
            exchange.sendResponseHeaders(404, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val found = repo.getItem(AgentItemCategory.SKILL, "found-item")
        assertTrue(found.isSuccess)
        assertNotNull(found.getOrNull())
        assertEquals("found-item", found.getOrNull()?.name)

        val missing = repo.getItem(AgentItemCategory.SKILL, "missing-item")
        assertTrue(missing.isSuccess)
        assertNull(missing.getOrNull())
    }

    @Test
    fun testGetItemContent() = runTest {
        server!!.createContext("/api/agent-store/command/lint/content") { exchange ->
            val json = """{"content":"# Run linter\npnpm lint"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val result = repo.getItemContent(AgentItemCategory.COMMAND, "lint")
        assertTrue(result.isSuccess)
        assertEquals("# Run linter\npnpm lint", result.getOrNull())
    }

    @Test
    fun testShipAndBulkShip() = runTest {
        server!!.createContext("/api/agent-store/ship") { exchange ->
            val json = """
                {
                    "item": "lint",
                    "category": "command",
                    "project": "proj1",
                    "agent": "claude",
                    "method": "symlink",
                    "success": true,
                    "targetPath": "/path/to/lint"
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-store/bulk-ship") { exchange ->
            val json = """
                [
                    {
                        "item": "lint",
                        "category": "command",
                        "project": "proj1",
                        "agent": "claude",
                        "method": "symlink",
                        "success": true
                    },
                    {
                        "item": "lint",
                        "category": "command",
                        "project": "proj2",
                        "agent": "claude",
                        "method": "symlink",
                        "success": false,
                        "error": "Target directory locked"
                    }
                ]
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val shipRes = repo.shipItem(ShipRequest("lint", AgentItemCategory.COMMAND, "proj1", AgentType.CLAUDE))
        assertTrue(shipRes.isSuccess)
        assertTrue(shipRes.getOrNull()?.success == true)

        val bulkRes = repo.bulkShip(BulkShipRequest(
            items = listOf(BulkShipItem("lint", AgentItemCategory.COMMAND)),
            projects = listOf(BulkShipProject("proj1", AgentType.CLAUDE), BulkShipProject("proj2", AgentType.CLAUDE))
        ))
        assertTrue(bulkRes.isSuccess)
        val list = bulkRes.getOrNull()!!
        assertEquals(2, list.size)
        assertTrue(list[0].success)
        assertFalse(list[1].success)
        assertEquals("Target directory locked", list[1].error)
    }

    @Test
    fun testMatrixAndHealth() = runTest {
        server!!.createContext("/api/agent-store/matrix") { exchange ->
            val json = """
                {
                    "command:lint": {
                        "proj1:claude": {"shipped": true, "method": "symlink"}
                    }
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-store/health") { exchange ->
            val json = """
                {
                    "brokenSymlinks": [],
                    "orphanedItems": []
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val matrix = repo.getMatrix().getOrNull()!!
        assertTrue(matrix.containsKey("command:lint"))
        assertTrue(matrix["command:lint"]?.get("proj1:claude")?.shipped == true)

        val health = repo.healthCheck().getOrNull()!!
        assertEquals(0, health.brokenSymlinks.size)
        assertEquals(0, health.orphanedItems.size)
    }

    @Test
    fun testMemoryRepository() = runTest {
        server!!.createContext("/api/agent-memory/templates") { exchange ->
            val json = """[{"name":"react-ts","content":"React TypeScript rules"}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/proj1/claude") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"projectName":"proj1","agent":"claude","content":"Existing memory"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"ok":true}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        server!!.createContext("/api/agent-memory/apply") { exchange ->
            val json = """{"content":"Rendered template for proj1"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentMemoryRepository(createApiClient())
        val tmpls = repo.listTemplates().getOrNull()!!
        assertEquals(1, tmpls.size)
        assertEquals("react-ts", tmpls[0].name)

        val mem = repo.getProjectMemory("proj1", AgentType.CLAUDE).getOrNull()
        assertEquals("Existing memory", mem)

        val updated = repo.updateProjectMemory("proj1", AgentType.CLAUDE, "Updated memory").getOrNull()
        assertEquals(true, updated)

        val applied = repo.applyTemplate("proj1", AgentType.CLAUDE, "react-ts").getOrNull()
        assertEquals("Rendered template for proj1", applied)
    }

    @Test
    fun testImportRepository() = runTest {
        server!!.createContext("/api/agent-import/scan") { exchange ->
            val json = """
                {
                    "repoUrl": "https://github.com/org/repo.git",
                    "tmpDir": "/tmp/123",
                    "items": [
                        {
                            "name": "helper",
                            "category": "skill",
                            "relativePath": "skills/helper/SKILL.md"
                        }
                    ]
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-import/confirm") { exchange ->
            val json = """[{"name":"helper","success":true}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentImportRepository(createApiClient())
        val scanRes = repo.scanRepo("https://github.com/org/repo.git").getOrNull()!!
        assertEquals("/tmp/123", scanRes.tmpDir)
        assertEquals(1, scanRes.items.size)

        val confirmRes = repo.confirmImport(scanRes.tmpDir, scanRes.items, cleanup = true).getOrNull()!!
        assertEquals(1, confirmRes.size)
        assertTrue(confirmRes[0].success)
    }
}
