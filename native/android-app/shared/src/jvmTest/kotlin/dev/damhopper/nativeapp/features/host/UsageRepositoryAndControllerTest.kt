package dev.damhopper.nativeapp.features.host

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.*
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.settings.SettingsOutcome
import dev.damhopper.nativeapp.features.settings.TestGuard

@OptIn(ExperimentalCoroutinesApi::class)
class UsageRepositoryAndControllerTest {

    private var server: HttpServer? = null
    private var serverPort: Int = 0
    private val testDispatcher = StandardTestDispatcher()

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

    private fun guardedClient(profile: String = "dev-profile"): Pair<ConnectionRef, ApiClient> {
        val registry = ConnectionRegistry()
        val ref = kotlinx.coroutines.runBlocking { registry.getOrCreateConnection(profile) }
        return ref to ApiClient(ref, "http://127.0.0.1:$serverPort", registry = registry)
    }

    private fun usageSettingsJson(paused: Boolean = false, retention: Int = 30) =
        """{"enabled":true,"paused":$paused,"detailRetentionDays":$retention,"collectorEnabled":true,"collectorSetup":{"restartRequired":false,"codexExporter":"notConfigured","serverRestartRequired":false}}"""

    @Test
    fun testMutationOutcomesAreHonestAndPayloadsAreExact() {
        val bodies = java.util.concurrent.CopyOnWriteArrayList<String>()
        var mode = "ok"
        server!!.createContext("/api/usage/settings") { exchange ->
            if (exchange.requestMethod == "PATCH") {
                bodies += exchange.requestBody.bufferedReader().readText()
                when (mode) {
                    "forbidden" -> { exchange.sendResponseHeaders(403, -1); exchange.close() }
                    "broken" -> { exchange.sendResponseHeaders(502, -1); exchange.close() }
                    "malformed" -> {
                        val json = "<html>"
                        exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                        exchange.responseBody.use { it.write(json.toByteArray()) }
                    }
                    else -> {
                        val json = usageSettingsJson(paused = false, retention = 90)
                        exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                        exchange.responseBody.use { it.write(json.toByteArray()) }
                    }
                }
            } else {
                val json = usageSettingsJson()
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        for (path in listOf("/api/usage/summary", "/api/usage/sessions", "/api/usage/setup", "/api/usage/health")) {
            server!!.createContext(path) { exchange -> exchange.sendResponseHeaders(503, -1); exchange.close() }
        }
        val (ref, client) = guardedClient()
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
        val controller = controllerFor(client, ref, scope)
        try {
            fun run(expectedMode: String): SettingsOutcome<UsageSettingsResponse> {
                mode = expectedMode
                var outcome: SettingsOutcome<UsageSettingsResponse>? = null
                controller.updateSettings(SettingsPatchRequest(detailRetentionDays = 90), TestGuard()) { outcome = it }
                val deadline = System.currentTimeMillis() + 3000
                while (outcome == null && System.currentTimeMillis() < deadline) Thread.sleep(20)
                return outcome!!
            }
            assertTrue(run("ok") is SettingsOutcome.Confirmed)
            assertEquals(90, controller.uiState.value.settings?.detailRetentionDays)
            assertTrue(run("forbidden") is SettingsOutcome.Rejected)
            assertTrue(run("broken") is SettingsOutcome.Unknown)
            assertTrue(run("malformed") is SettingsOutcome.Unknown, "malformed 2xx after admission is ambiguous")
            assertEquals(4, bodies.size, "one request per explicit call, never replayed")
            assertTrue(bodies.all { it == """{"detailRetentionDays":90}""" })
        } finally {
            controller.dispose()
            scope.cancel()
        }
    }

    @Test
    fun testSuspendedCredentialsThenRetirementSendsNoUsageMutation() {
        val hits = java.util.concurrent.atomic.AtomicInteger()
        for (path in listOf("/api/usage/settings", "/api/usage/setup")) {
            server!!.createContext(path) { exchange ->
                if (exchange.requestMethod != "GET") hits.incrementAndGet()
                exchange.sendResponseHeaders(503, -1)
                exchange.close()
            }
        }
        for (path in listOf("/api/usage/summary", "/api/usage/sessions", "/api/usage/health")) {
            server!!.createContext(path) { exchange -> exchange.sendResponseHeaders(503, -1); exchange.close() }
        }
        val registry = ConnectionRegistry()
        val ref = kotlinx.coroutines.runBlocking { registry.getOrCreateConnection("dev-profile") }
        val gate = java.util.concurrent.atomic.AtomicBoolean(false)
        val entered = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val client = ApiClient(ref, "http://127.0.0.1:$serverPort", {
            if (gate.get()) {
                entered.countDown()
                release.await(10, java.util.concurrent.TimeUnit.SECONDS)
            }
            "token"
        }, registry)
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
        val controller = controllerFor(client, ref, scope)
        try {
            Thread.sleep(300) // let the initial (unguarded) loads settle
            gate.set(true)
            val guard = TestGuard()
            var outcome: SettingsOutcome<UsageSetupStatusResponse>? = null
            controller.updateSetup(SetupPatchRequest(enabled = true), guard) { outcome = it }
            assertTrue(entered.await(10, java.util.concurrent.TimeUnit.SECONDS))
            kotlinx.coroutines.runBlocking { registry.retireConnection(ref) }
            release.countDown()
            val deadline = System.currentTimeMillis() + 3000
            while (outcome == null && System.currentTimeMillis() < deadline) Thread.sleep(20)
            assertTrue(outcome is SettingsOutcome.NotSubmitted, outcome.toString())
            assertEquals(0, hits.get())
            assertEquals(dev.damhopper.nativeapp.core.transport.RequestAdmissionState.REJECTED, guard.admission.value)
        } finally {
            controller.dispose()
            scope.cancel()
        }
    }

    @Test
    fun testSummaryParsingWithNullTokensPreserved() = runTest {
        server!!.createContext("/api/usage/summary") { exchange ->
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                writer.write("""
                    {
                        "range": { "from": 1000, "to": 2000, "bucket": "day" },
                        "codex": { "inputTokens": 500, "cachedInputTokens": null, "outputTokens": 200, "reasoningTokens": null, "responseCount": 5 },
                        "timeSeries": [
                            { "startUtcMs": 1000, "codex": { "inputTokens": 500, "outputTokens": 200, "responseCount": 5 } }
                        ],
                        "health": { "available": true, "paused": false, "writerErrors": 0, "rejectedEvents": 0, "sampledAt": 1500, "collector": { "dropped": 0 } }
                    }
                """.trimIndent())
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = UsageRepository(apiClient)

        val result = repo.getSummary(window = "24h").getOrThrow()
        assertIs<UsageResult.Available<UsageSummaryResponse>>(result)
        val data = result.data
        assertEquals(500uL, data.codex?.inputTokens)
        // Null preserved: not fabricated zero
        assertNull(data.codex?.cachedInputTokens)
        assertNull(data.codex?.reasoningTokens)
        assertEquals(200uL, data.codex?.outputTokens)
        assertEquals(1, data.timeSeries.size)
        assertTrue(data.health.available)
    }

    @Test
    fun testSessionsListAndCursorPagination() = runTest {
        server!!.createContext("/api/usage/sessions") { exchange ->
            val query = exchange.requestURI.query ?: ""
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                if (query.contains("cursor=c1")) {
                    writer.write("""
                        {
                            "range": { "from": 1000, "to": 2000 },
                            "sessions": [ { "id": "hmac-2", "startedAtUtcMs": 1500, "tokens": { "responseCount": 1 } } ],
                            "nextCursor": null,
                            "paused": false
                        }
                    """.trimIndent())
                } else {
                    writer.write("""
                        {
                            "range": { "from": 1000, "to": 2000 },
                            "sessions": [ { "id": "hmac-1", "startedAtUtcMs": 1200, "tokens": { "responseCount": 2 } } ],
                            "nextCursor": "c1",
                            "paused": false
                        }
                    """.trimIndent())
                }
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val apiClient = ApiClient(ref, "http://127.0.0.1:$serverPort")
        val repo = UsageRepository(apiClient)

        val firstPage = repo.listSessions(limit = 1).getOrThrow()
        assertIs<UsageResult.Available<SessionListResponse>>(firstPage)
        assertEquals(1, firstPage.data.sessions.size)
        assertEquals("hmac-1", firstPage.data.sessions[0].id)
        assertEquals("c1", firstPage.data.nextCursor)

        val secondPage = repo.listSessions(cursor = "c1").getOrThrow()
        assertIs<UsageResult.Available<SessionListResponse>>(secondPage)
        assertEquals("hmac-2", secondPage.data.sessions[0].id)
        assertNull(secondPage.data.nextCursor)
    }

    @Test
    fun testDeleteUsageRequiresConfirmationString() {
        var receivedDeleteBody: String? = null
        server!!.createContext("/api/usage") { exchange ->
            if (exchange.requestMethod == "DELETE") {
                receivedDeleteBody = exchange.requestBody.bufferedReader().readText()
                exchange.sendResponseHeaders(204, -1)
                exchange.close()
            } else {
                exchange.sendResponseHeaders(405, -1)
                exchange.close()
            }
        }
        server!!.createContext("/api/usage/summary") { exchange ->
            val json = """{"range":{"from":0,"to":0,"bucket":"day"},"timeSeries":[],"health":{"available":true,"paused":false,"writerErrors":0,"rejectedEvents":0,"sampledAt":0,"collector":{"dropped":0}}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/sessions") { exchange ->
            val json = """{"range":{"from":0,"to":0},"sessions":[],"nextCursor":null,"paused":false}"""
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

        val (ref, apiClient) = guardedClient()
        val repo = UsageRepository(apiClient)
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
        val controller = UsageController(ref, repo, scope)

        // 1. Invalid confirmation fails closed immediately without network request
        var failedCalled = false
        controller.deleteUsage("invalid-confirmation", guard = TestGuard()) { outcome ->
            assertTrue(outcome is SettingsOutcome.NotSubmitted)
            failedCalled = true
        }
        assertTrue(failedCalled)
        assertNotNull(controller.uiState.value.deleteError)
        assertNull(receivedDeleteBody)

        // 2. Valid confirmation "delete-usage-data" wipes local state and sends request
        var successCalled = false
        controller.deleteUsage("delete-usage-data", guard = TestGuard()) { outcome ->
            successCalled = outcome is SettingsOutcome.Confirmed
        }
        val deadline = System.currentTimeMillis() + 3000
        while (!successCalled && System.currentTimeMillis() < deadline) {
            Thread.sleep(20)
        }
        assertTrue(successCalled)
        assertNotNull(receivedDeleteBody)
        assertTrue(receivedDeleteBody!!.contains("delete-usage-data"))
    }

    @Test
    fun testRangeDeletionSendsUtcAlignedBounds() = runTest {
        var receivedDeleteBody: String? = null
        server!!.createContext("/api/usage") { exchange ->
            receivedDeleteBody = exchange.requestBody.bufferedReader().readText()
            exchange.sendResponseHeaders(204, -1); exchange.close()
        }
        val repo = UsageRepository(guardedClient().second)
        val dayMs = UsageBoundsHelper.DAY_MS

        // Mid-day unaligned timestamp (2024-10-16 20:59:05.678 UTC)
        val unalignedNow = 1729112345678L
        assertNotEquals(0L, unalignedNow % dayMs, "Input must not be midnight-aligned")

        val (fromUtc, todayUtc) = UsageBoundsHelper.calculateUtcDayRange(unalignedNow, 7L)
        // Explicit exact expected boundaries:
        // todayUtc = 1729036800000L (2024-10-16 00:00:00 UTC)
        // fromUtc  = 1728432000000L (2024-10-09 00:00:00 UTC)
        assertEquals(1729036800000L, todayUtc, "todayUtc must equal exact 2024-10-16 00:00:00 UTC")
        assertEquals(1728432000000L, fromUtc, "fromUtc must equal exact 2024-10-09 00:00:00 UTC")
        assertEquals(0L, fromUtc % dayMs, "From timestamp must be UTC day aligned")
        assertEquals(0L, todayUtc % dayMs, "To timestamp must be UTC day aligned")
        assertEquals(7L * dayMs, todayUtc - fromUtc, "Span must equal exact requested days in milliseconds")
        assertTrue(todayUtc <= unalignedNow, "To timestamp must be floored to start of UTC day")

        repo.deleteUsage(DeleteUsageRequest(from = fromUtc, to = todayUtc), TestGuard()).getOrThrow()
        assertNotNull(receivedDeleteBody)
        val parsed = ProtocolJson.decodeFromString(DeleteUsageRequest.serializer(), receivedDeleteBody!!)
        assertEquals("delete-usage-data", parsed.confirmation)
        assertEquals(fromUtc, parsed.from)
        assertEquals(todayUtc, parsed.to)
        assertEquals(1728432000000L, parsed.from)
        assertEquals(1729036800000L, parsed.to)
        assertEquals(0L, parsed.from!! % dayMs)
        assertEquals(0L, parsed.to!! % dayMs)
    }

    @Test
    fun testDeleteUsageFailurePreservesStateAndResetsDeleting() {
        var attemptCount = 0
        server!!.createContext("/api/usage") { exchange ->
            if (exchange.requestMethod == "DELETE") {
                attemptCount++
                if (attemptCount == 1) {
                    exchange.sendResponseHeaders(500, -1)
                    exchange.close()
                } else {
                    exchange.sendResponseHeaders(204, -1)
                    exchange.close()
                }
            } else {
                val json = """{"available":true,"paused":false,"writerErrors":0,"rejectedEvents":0,"sampledAt":0,"collector":{"dropped":0}}"""
                exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(json.toByteArray()) }
            }
        }
        server!!.createContext("/api/usage/summary") { exchange ->
            val json = """{"range":{"from":1000,"to":2000,"bucket":"day"},"codex":{"inputTokens":12345},"timeSeries":[],"health":{"available":true,"paused":false,"writerErrors":0,"rejectedEvents":0,"sampledAt":0,"collector":{"dropped":0}}}"""
            exchange.sendResponseHeaders(200, json.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(json.toByteArray()) }
        }
        server!!.createContext("/api/usage/sessions") { exchange ->
            val json = """{"range":{"from":1000,"to":2000},"sessions":[{"id":"sess-pre-delete","startedAtUtcMs":1500,"tokens":{}}],"nextCursor":null,"paused":false}"""
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

        val (ref, apiClient) = guardedClient()
        val repo = UsageRepository(apiClient)
        val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
        val controller = UsageController(ref, repo, scope)

        try {
            // Wait for initial non-empty state
            val deadlineInit = System.currentTimeMillis() + 3000
            while ((controller.uiState.value.summary == null || controller.uiState.value.sessions.isEmpty()) && System.currentTimeMillis() < deadlineInit) {
                Thread.sleep(20)
            }
            assertNotNull(controller.uiState.value.summary)
            assertEquals(12345uL, controller.uiState.value.summary?.codex?.inputTokens)
            assertEquals(1, controller.uiState.value.sessions.size)
            assertEquals("sess-pre-delete", controller.uiState.value.sessions[0].id)

            // Attempt 1: Server fails with 500
            var failureNotified: Boolean? = null
            var failureOutcome: SettingsOutcome<Unit>? = null
            controller.deleteUsage("delete-usage-data", guard = TestGuard()) { outcome ->
                failureOutcome = outcome
                failureNotified = outcome is SettingsOutcome.Confirmed
            }

            // Re-entrant call while isDeleting is active must fail closed immediately (nothing submitted)
            var reentrantRejected: Boolean? = null
            controller.deleteUsage("delete-usage-data", guard = TestGuard()) { reentrant ->
                reentrantRejected = reentrant is SettingsOutcome.NotSubmitted
            }
            assertTrue(reentrantRejected == true, "Concurrent deleteUsage must be rejected while isDeleting is true")

            val deadlineFail = System.currentTimeMillis() + 3000
            while (failureNotified == null && System.currentTimeMillis() < deadlineFail) {
                Thread.sleep(20)
            }

            assertEquals(false, failureNotified, "Delete callback must report failure")
            assertTrue(failureOutcome is SettingsOutcome.Unknown, "an admitted 500 is ambiguous, never a retryable failure: $failureOutcome")
            assertFalse(controller.uiState.value.isDeleting, "isDeleting flag must reset to false on failure")
            assertNotNull(controller.uiState.value.deleteError, "deleteError must record failure reason")
            // Non-empty state must be PRESERVED across failure and reloaded
            assertNotNull(controller.uiState.value.summary, "Existing summary must NOT be cleared on deletion failure")
            assertEquals(12345uL, controller.uiState.value.summary?.codex?.inputTokens)
            assertEquals(1, controller.uiState.value.sessions.size)
            assertEquals("sess-pre-delete", controller.uiState.value.sessions[0].id)

            // Attempt 2: Server succeeds with 204
            var successNotified: Boolean? = null
            controller.deleteUsage("delete-usage-data", guard = TestGuard()) { outcome ->
                successNotified = outcome is SettingsOutcome.Confirmed
            }
            val deadlineSuccess = System.currentTimeMillis() + 3000
            while (successNotified == null && System.currentTimeMillis() < deadlineSuccess) {
                Thread.sleep(20)
            }

            assertEquals(true, successNotified, "Retry after failure must succeed")
            assertFalse(controller.uiState.value.isDeleting)
            assertNull(controller.uiState.value.deleteError)
        } finally {
            controller.dispose()
            scope.cancel()
        }
    }
}

private fun controllerFor(client: ApiClient, ref: ConnectionRef, scope: kotlinx.coroutines.CoroutineScope) =
    UsageController(ref, UsageRepository(client), scope)
