package dev.damhopper.nativeapp.features.agents

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import java.net.InetSocketAddress
import kotlin.test.*

class AgentControllersFencingAndDraftTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private var testScope: CoroutineScope? = null

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverPort = server!!.address.port
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Default)
    }

    @AfterTest
    fun tearDown() {
        testScope?.cancel()
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

    private fun waitUntil(timeoutMs: Long = 3000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition() && System.currentTimeMillis() < deadline) {
            Thread.sleep(15)
        }
        assertTrue(condition(), "Condition not satisfied within ${timeoutMs}ms")
    }

    // -------------------------------------------------------------------------
    // Store Controller Fencing & Partial Results Tests
    // -------------------------------------------------------------------------

    @Test
    fun testStoreControllerRetirementFencing() {
        server!!.createContext("/api/agent-store") { exchange ->
            val json = """[{"name":"lint","category":"command","relativePath":"c/lint.md","compatibleAgents":[]}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-store/matrix") { exchange ->
            val json = """{}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-store/health") { exchange ->
            val json = """{"brokenSymlinks":[],"orphanedItems":[]}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val controller = AgentStoreController(repo, testScope!!, "test-profile", 1L)
        waitUntil { controller.state.value.items.isNotEmpty() }
        assertEquals(1, controller.state.value.items.size)

        // Retire controller
        controller.retire()
        assertTrue(controller.state.value.items.isEmpty())

        // Subsequent load calls must be ignored
        controller.loadStore()
        Thread.sleep(100)
        assertTrue(controller.state.value.items.isEmpty())
    }

    @Test
    fun testStoreControllerBulkShipPartialFailuresPreserved() {
        server!!.createContext("/api/agent-store") { exchange ->
            exchange.sendResponseHeaders(200, "[]".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/agent-store/matrix") { exchange ->
            exchange.sendResponseHeaders(200, "{}".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("{}".toByteArray()) }
        }
        server!!.createContext("/api/agent-store/health") { exchange ->
            exchange.sendResponseHeaders(200, "{\"brokenSymlinks\":[],\"orphanedItems\":[]}".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("{\"brokenSymlinks\":[],\"orphanedItems\":[]}".toByteArray()) }
        }
        server!!.createContext("/api/agent-store/bulk-ship") { exchange ->
            val json = """
                [
                    {"item":"s1","category":"skill","project":"p1","agent":"claude","method":"symlink","success":true},
                    {"item":"s1","category":"skill","project":"p2","agent":"claude","method":"symlink","success":false,"error":"Permission denied"}
                ]
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentStoreRepository(createApiClient())
        val controller = AgentStoreController(repo, testScope!!, "test-profile", 1L)
        waitUntil { !controller.state.value.isLoading }

        controller.bulkShip(
            items = listOf(AgentStoreItem("s1", AgentItemCategory.SKILL)),
            projects = listOf("p1" to AgentType.CLAUDE, "p2" to AgentType.CLAUDE)
        )
        waitUntil { controller.state.value.bulkResults != null }

        val results = controller.state.value.bulkResults
        assertNotNull(results)
        assertEquals(2, results.size)
        assertTrue(results[0].success)
        assertFalse(results[1].success)
        assertEquals("Permission denied", results[1].error)
        assertEquals("Some items failed to ship", controller.state.value.mutationError)
    }

    // -------------------------------------------------------------------------
    // Memory Controller Fencing & Dirty Draft Tests
    // -------------------------------------------------------------------------

    @Test
    fun testMemoryControllerTargetSwitchProtection() {
        server!!.createContext("/api/agent-memory/templates") { exchange ->
            exchange.sendResponseHeaders(200, "[]".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p1/claude") { exchange ->
            val json = """{"projectName":"p1","agent":"claude","content":"Original p1"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p2/claude") { exchange ->
            val json = """{"projectName":"p2","agent":"claude","content":"Original p2"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentMemoryRepository(createApiClient())
        val controller = AgentMemoryController(repo, testScope!!, "test-profile", 1L)
        controller.setProjects(listOf("p1", "p2"))
        waitUntil { controller.state.value.content == "Original p1" }

        assertEquals("Original p1", controller.state.value.content)
        assertFalse(controller.state.value.isDirty)

        // Make edit
        controller.updateContent("Edited p1 content")
        assertTrue(controller.state.value.isDirty)

        // Request target switch to p2 -> must NOT switch immediately, must prompt
        controller.requestTargetSwitch("p2", AgentType.CLAUDE)
        assertNotNull(controller.state.value.pendingTargetSwitch)
        assertEquals("p2", controller.state.value.pendingTargetSwitch?.first)
        assertEquals("Edited p1 content", controller.state.value.content)

        // Cancel target switch -> retains dirty edits
        controller.cancelTargetSwitch()
        assertNull(controller.state.value.pendingTargetSwitch)
        assertEquals("Edited p1 content", controller.state.value.content)

        // Request again and confirm -> discards and switches
        controller.requestTargetSwitch("p2", AgentType.CLAUDE)
        controller.confirmTargetSwitch()
        waitUntil { controller.state.value.selectedProject == "p2" && controller.state.value.content == "Original p2" }

        assertNull(controller.state.value.pendingTargetSwitch)
        assertEquals("p2", controller.state.value.selectedProject)
        assertEquals("Original p2", controller.state.value.content)
        assertFalse(controller.state.value.isDirty)
    }

    @Test
    fun testMemoryControllerEditsDuringSaveStayDirty() {
        server!!.createContext("/api/agent-memory/templates") { exchange ->
            exchange.sendResponseHeaders(200, "[]".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p1/claude") { exchange ->
            if (exchange.requestMethod == "GET") {
                val json = """{"projectName":"p1","agent":"claude","content":"Initial"}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                // Simulate slow save
                Thread.sleep(150)
                val json = """{"ok":true}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }

        val repo = AgentMemoryRepository(createApiClient())
        val controller = AgentMemoryController(repo, testScope!!, "test-profile", 1L)
        controller.setProjects(listOf("p1"))
        waitUntil { controller.state.value.content == "Initial" }

        controller.updateContent("First edit")
        controller.saveMemory()

        // User makes another edit while save is still in flight!
        Thread.sleep(50)
        controller.updateContent("Second newer edit")

        // Wait for save to complete
        waitUntil { controller.state.value.saveStatus == MemorySaveStatus.SAVED }

        assertEquals(MemorySaveStatus.SAVED, controller.state.value.saveStatus)
        // Invariant: newer edits must NOT be marked clean!
        assertEquals("Second newer edit", controller.state.value.content)
        assertTrue(controller.state.value.isDirty)
    }

    // -------------------------------------------------------------------------
    // Import Controller Fencing & Cleanup Derivation Tests
    // -------------------------------------------------------------------------

    @Test
    fun testImportControllerSourceChangeInvalidatesPreviousScan() {
        val repo = AgentImportRepository(createApiClient())
        val controller = AgentImportController(repo, testScope!!, "test-profile", 1L)

        controller.setRepoUrl("https://github.com/test/repo.git")
        val initialRev = controller.state.value.scanRevision

        // Changing source must bump revision and clear scan state
        controller.setSource(ImportSource.LOCAL)
        assertTrue(controller.state.value.scanRevision > initialRev)
        assertNull(controller.state.value.capturedScan)
        assertTrue(controller.state.value.selectedItemKeys.isEmpty())
    }

    @Test
    fun testImportControllerCleanupFlagDerivedFromSource() {
        var recordedCleanup: Boolean? = null
        server!!.createContext("/api/agent-import/scan-local") { exchange ->
            val json = """
                {
                    "dirPath": "/server/local/dir",
                    "items": [
                        {"name":"item1","category":"skill","relativePath":"skills/item1/SKILL.md"}
                    ]
                }
            """.trimIndent()
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-import/confirm") { exchange ->
            val body = exchange.requestBody.reader().readText()
            recordedCleanup = body.contains("\"cleanup\":true")
            val json = """[{"name":"item1","success":true}]"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentImportRepository(createApiClient())
        val controller = AgentImportController(repo, testScope!!, "test-profile", 1L)

        controller.setSource(ImportSource.LOCAL)
        controller.setDirPath("/server/local/dir")
        controller.startScan()
        waitUntil { controller.state.value.capturedScan != null }

        assertNotNull(controller.state.value.capturedScan)
        assertEquals(1, controller.state.value.selectedCount)

        controller.confirmImport()
        waitUntil { controller.state.value.importResults != null }

        // For local directory import, cleanup MUST be false!
        assertEquals(false, recordedCleanup)
        assertNotNull(controller.state.value.importResults)
        assertTrue(controller.state.value.importResults!![0].success)
    }

    @Test
    fun testMemorySaveBlockedWhenTargetLoading() {
        server!!.createContext("/api/agent-memory/templates") { exchange ->
            exchange.sendResponseHeaders(200, "[]".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p1/claude") { exchange ->
            val json = """{"projectName":"p1","agent":"claude","content":"P1 Content"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p2/claude") { exchange ->
            // Delayed response
            Thread.sleep(150)
            val json = """{"projectName":"p2","agent":"claude","content":"P2 Content"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentMemoryRepository(createApiClient())
        val controller = AgentMemoryController(repo, testScope!!, "test-profile", 1L)
        controller.setProjects(listOf("p1", "p2"))
        waitUntil { controller.state.value.loadedProject == "p1" }
        assertEquals("P1 Content", controller.state.value.content)

        // Switch to p2 -> while loading, loadedProject MUST be null and content cleared
        controller.loadMemory("p2", AgentType.CLAUDE)
        assertTrue(controller.state.value.isLoading)
        assertNull(controller.state.value.loadedProject)
        assertEquals("", controller.state.value.content)

        // Wait until p2 completes loading
        waitUntil { controller.state.value.loadedProject == "p2" }
        assertEquals("P2 Content", controller.state.value.content)
        assertEquals("p2", controller.state.value.loadedProject)
    }

    @Test
    fun testSetProjectsPreservesDirtyDraft() {
        server!!.createContext("/api/agent-memory/templates") { exchange ->
            exchange.sendResponseHeaders(200, "[]".toByteArray().size.toLong())
            exchange.responseBody.use { it.write("[]".toByteArray()) }
        }
        server!!.createContext("/api/agent-memory/p1/claude") { exchange ->
            val json = """{"projectName":"p1","agent":"claude","content":"Initial P1"}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val repo = AgentMemoryRepository(createApiClient())
        val controller = AgentMemoryController(repo, testScope!!, "test-profile", 1L)
        controller.setProjects(listOf("p1", "p2"))
        waitUntil { controller.state.value.loadedProject == "p1" }

        // Type user edits
        controller.updateContent("User dirty draft")
        assertTrue(controller.state.value.isDirty)

        // Refresh project list (e.g. from workspace poll or LaunchedEffect)
        controller.setProjects(listOf("p1", "p2", "p3"))

        // Invariant: Dirty draft must NOT be wiped!
        assertEquals("User dirty draft", controller.state.value.content)
        assertTrue(controller.state.value.isDirty)
        assertEquals("p1", controller.state.value.selectedProject)
    }

    @Test
    fun testImportSourceChangeResetsIsScanning() {
        val repo = AgentImportRepository(createApiClient())
        val controller = AgentImportController(repo, testScope!!, "test-profile", 1L)

        controller.setRepoUrl("https://github.com/test/repo.git")
        // Simulate scan in flight
        controller.startScan()
        assertTrue(controller.state.value.isScanning)

        // Changing source mid-scan must immediately clear isScanning
        controller.setSource(ImportSource.LOCAL)
        assertFalse(controller.state.value.isScanning)
        assertNull(controller.state.value.capturedScan)
    }

    @Test
    fun testImportDuplicateItemNamesRelativePathDeduplication() {
        val repo = AgentImportRepository(createApiClient())
        val controller = AgentImportController(repo, testScope!!, "test-profile", 1L)

        val itemA = RepoScanItem("lint", AgentItemCategory.COMMAND, null, "dirA/lint.md")
        val itemB = RepoScanItem("lint", AgentItemCategory.COMMAND, null, "dirB/lint.md")

        val keyA = controller.itemKey(itemA)
        val keyB = controller.itemKey(itemB)
        assertNotEquals(keyA, keyB, "Items with same name in different relative paths must have distinct keys")
    }
}
