package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.TestGuard
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import java.net.InetSocketAddress
import kotlin.test.*

class UsageControllerLoadingTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            executor = null
            start()
        }
        serverPort = server!!.address.port
    }

    @AfterTest
    fun tearDown() {
        server?.stop(0)
    }

    @Test
    fun testUsageControllerLoadsSummaryAndSessionsConcurrently() {
        server!!.createContext("/api/usage/summary") { exchange ->
            val json = """{"range":{"from":100,"to":200,"bucket":"day"},"codex":{"inputTokens":123},"timeSeries":[],"health":{"available":true,"paused":false,"writerErrors":0,"rejectedEvents":0,"sampledAt":0,"collector":{"dropped":0}}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/sessions") { exchange ->
            val json = """{"range":{"from":100,"to":200},"sessions":[{"id":"s1","startedAtUtcMs":150,"tokens":{"responseCount":1}}],"nextCursor":null,"paused":false}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/settings") { exchange ->
            val json = """{"enabled":true,"paused":false,"detailRetentionDays":30,"collectorEnabled":true,"collectorSetup":{"restartRequired":false,"codexExporter":"notConfigured","serverRestartRequired":false}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/setup") { exchange ->
            val json = """{"enabled":true,"paused":false,"collectorEnabled":true,"collectorSetup":{"codexExporter":"notConfigured","restartRequired":false,"serverRestartRequired":false}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = UsageRepository(apiClient)
        val scope = CoroutineScope(Dispatchers.Default)
        val controller = UsageController(ref, repo, scope)

        val deadline = System.currentTimeMillis() + 3000
        while ((controller.uiState.value.summary == null || controller.uiState.value.sessions.isEmpty()) && System.currentTimeMillis() < deadline) {
            Thread.sleep(20)
        }

        // Both summary and sessions must be loaded (no race condition between tokens)!
        assertNotNull(controller.uiState.value.summary, "Summary must be loaded")
        assertEquals(123uL, controller.uiState.value.summary?.codex?.inputTokens)
        assertFalse(controller.uiState.value.isLoadingSummary)
        assertEquals(1, controller.uiState.value.sessions.size)
        assertEquals("s1", controller.uiState.value.sessions[0].id)
        assertFalse(controller.uiState.value.isLoadingSessions)
    }

    @Test
    fun testUpdateSettingsAndSetupMutations() {
        var receivedPatch: String? = null
        server!!.createContext("/api/usage/settings") { exchange ->
            if (exchange.requestMethod == "PATCH") {
                receivedPatch = exchange.requestBody.bufferedReader().readText()
                val json = """{"enabled":true,"paused":true,"detailRetentionDays":14,"collectorEnabled":true,"collectorSetup":{"restartRequired":false,"codexExporter":"notConfigured","serverRestartRequired":false}}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"enabled":true,"paused":false,"detailRetentionDays":30,"collectorEnabled":true,"collectorSetup":{"restartRequired":false,"codexExporter":"notConfigured","serverRestartRequired":false}}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        var receivedSetupPatch: String? = null
        server!!.createContext("/api/usage/setup") { exchange ->
            if (exchange.requestMethod == "PATCH") receivedSetupPatch = exchange.requestBody.bufferedReader().readText()
            val json = """{"enabled":true,"paused":false,"collectorEnabled":true,"collectorSetup":{"codexExporter":"managed","restartRequired":false,"serverRestartRequired":false}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val registry = ConnectionRegistry()
        val ref = kotlinx.coroutines.runBlocking { registry.getOrCreateConnection("dev-profile") }
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort", registry = registry)
        val repo = UsageRepository(apiClient)
        val scope = CoroutineScope(Dispatchers.Default)
        val controller = UsageController(ref, repo, scope)
        // Wait for initial load to finish first
        val initDeadline = System.currentTimeMillis() + 3000
        while (controller.uiState.value.settings == null && System.currentTimeMillis() < initDeadline) {
            Thread.sleep(20)
        }
        assertEquals(false, controller.uiState.value.settings?.paused)

        var patchDone = false
        controller.updateSettings(SettingsPatchRequest(paused = true, detailRetentionDays = 14), TestGuard()) { outcome ->
            patchDone = outcome is SettingsOutcome.Confirmed
        }

        val deadline = System.currentTimeMillis() + 3000
        while (!patchDone && System.currentTimeMillis() < deadline) {
            Thread.sleep(20)
        }

        assertTrue(patchDone, "Settings patch must complete successfully")
        assertNotNull(receivedPatch)
        assertTrue(receivedPatch!!.contains("\"paused\":true"))
        assertEquals(true, controller.uiState.value.settings?.paused)
        assertEquals(14, controller.uiState.value.settings?.detailRetentionDays)

        var setupDone = false
        controller.updateSetup(SetupPatchRequest(enabled = true, codexExporter = true), TestGuard()) { outcome ->
            setupDone = outcome is SettingsOutcome.Confirmed
        }
        val setupDeadline = System.currentTimeMillis() + 3000
        while (!setupDone && System.currentTimeMillis() < setupDeadline) {
            Thread.sleep(20)
        }
        assertTrue(setupDone, "Setup patch must complete successfully")
        assertEquals("""{"enabled":true,"codexExporter":true}""", receivedSetupPatch)
    }

    @Test
    fun testSessionPaginationPageTwoOmitsRange() {
        var pageTwoQuery: String? = null
        server!!.createContext("/api/usage/summary") { exchange ->
            val json = """{"range":{"from":100,"to":200,"bucket":"day"},"timeSeries":[],"health":{"available":true,"paused":false,"writerErrors":0,"rejectedEvents":0,"sampledAt":0,"collector":{"dropped":0}}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/sessions") { exchange ->
            val query = exchange.requestURI.query ?: ""
            if (query.contains("cursor=c1")) {
                pageTwoQuery = query
                val json = """{"range":{"from":100,"to":200},"sessions":[{"id":"s2","startedAtUtcMs":160,"tokens":{}}],"nextCursor":null,"paused":false}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            } else {
                val json = """{"range":{"from":100,"to":200},"sessions":[{"id":"s1","startedAtUtcMs":150,"tokens":{}}],"nextCursor":"c1","paused":false}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        server!!.createContext("/api/usage/settings") { exchange ->
            val json = """{"enabled":true,"paused":false,"detailRetentionDays":30,"collectorEnabled":true,"collectorSetup":{"restartRequired":false,"codexExporter":"notConfigured","serverRestartRequired":false}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/setup") { exchange ->
            val json = """{"enabled":true,"paused":false,"collectorEnabled":true,"collectorSetup":{"codexExporter":"notConfigured","restartRequired":false,"serverRestartRequired":false}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = UsageRepository(apiClient)
        val scope = CoroutineScope(Dispatchers.Default)
        val controller = UsageController(ref, repo, scope)

        val deadline = System.currentTimeMillis() + 3000
        while (controller.uiState.value.nextCursor != "c1" && System.currentTimeMillis() < deadline) {
            Thread.sleep(20)
        }
        assertEquals("c1", controller.uiState.value.nextCursor)

        controller.loadSessions(initial = false)
        val deadline2 = System.currentTimeMillis() + 3000
        while (pageTwoQuery == null && System.currentTimeMillis() < deadline2) {
            Thread.sleep(20)
        }

        assertNotNull(pageTwoQuery)
        assertTrue(pageTwoQuery!!.contains("cursor=c1"))
        assertFalse(pageTwoQuery!!.contains("from="))
        assertFalse(pageTwoQuery!!.contains("to="))

        // Wait for page-two state application: sessions appended [s1, s2] and nextCursor cleared
        val deadline3 = System.currentTimeMillis() + 3000
        while (controller.uiState.value.sessions.size < 2 && System.currentTimeMillis() < deadline3) {
            Thread.sleep(20)
        }
        assertEquals(2, controller.uiState.value.sessions.size, "Sessions list must append second page")
        assertEquals("s1", controller.uiState.value.sessions[0].id)
        assertEquals("s2", controller.uiState.value.sessions[1].id)
        assertNull(controller.uiState.value.nextCursor, "nextCursor must be null after final page")
        assertFalse(controller.uiState.value.isLoadingSessions, "isLoadingSessions must be false after completion")
    }
}
