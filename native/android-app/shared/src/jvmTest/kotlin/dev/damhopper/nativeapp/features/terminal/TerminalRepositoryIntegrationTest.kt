package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.RequestAdmissionState
import dev.damhopper.nativeapp.core.transport.RequestNotSubmittedError
import dev.damhopper.nativeapp.features.settings.SettingsTestServer
import dev.damhopper.nativeapp.features.settings.TestGuard
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
class TerminalRepositoryIntegrationTest {
    private lateinit var server: SettingsTestServer
    private lateinit var registry: ConnectionRegistry

    private val extensionJson =
        """{"status":"installed","target_path":"/home/u/.omp/agent/ext","version":"1","bundled_version":"1","bundled_hash":"h"}"""
    private fun integrationJson(agent: String) =
        """{"agentKind":"$agent","status":"installed","readiness":"ready","target_path":"/t","launcher_path":"/l","manifest_path":"/m","bundled_version":"1","bundled_hash":"h"}"""

    @BeforeTest
    fun setUp() {
        server = SettingsTestServer()
        registry = ConnectionRegistry()
        server.route("/api/agent-status/omp/extension/install") { _ -> 200 to extensionJson }
        server.route("/api/agent-status/omp/extension") { _ -> 200 to extensionJson }
        server.route("/api/agent-status/integrations/claude") { _ -> 200 to integrationJson("claude") }
        server.route("/api/agent-status/integrations/codex") { _ -> 200 to integrationJson("codex") }
        server.route("/api/agent-status/paths") { _ ->
            200 to """{"effectiveHome":"/h","ompInstallDir":"/h/.omp","ompNotificationDir":"/n","ompStatus":"ok","ompCanEnable":true,"codexConfigDir":"/h/.codex","codexNotificationDir":"/n","codexConfigExists":true,"codexCanEnable":true}"""
        }
    }

    @AfterTest
    fun tearDown() = server.stop()

    private fun repository(): TerminalRepository {
        val ref = runBlocking { registry.getOrCreateConnection("p") }
        return TerminalRepository(ApiClient(ref, server.baseUrl, { "token" }, registry))
    }

    private fun query(rawQuery: String?): Map<String, String> = rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }
        .associate { pair ->
            val (k, v) = pair.split('=', limit = 2)
            URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
        }

    @Test
    fun installBodiesAreStructuredJsonThatRoundTripsQuotesBackslashesAndUnicode() = runBlocking {
        val hostile = "C:\\Users\\\"Ünï\" é\\.omp\n\"}"
        val repo = repository()
        val guard = TestGuard()
        repo.installOmpExtension(hostile, guard)
        val body = Json.parseToJsonElement(server.posts("/api/agent-status/omp/extension/install").single().body) as JsonObject
        assertEquals(hostile, body["agentDir"]!!.jsonPrimitive.content)
        assertEquals(setOf("agentDir"), body.keys)

        repo.installNativeIntegration(AgentKind.CLAUDE, hostile, TestGuard())
        val claude = Json.parseToJsonElement(server.posts("/api/agent-status/integrations/claude").single().body) as JsonObject
        assertEquals(hostile, claude["agentDir"]!!.jsonPrimitive.content)

        repo.installNativeIntegration(AgentKind.CODEX, null, TestGuard())
        assertEquals("{}", server.posts("/api/agent-status/integrations/codex").single().body)
        repo.installOmpExtension(null, TestGuard())
        assertEquals("{}", server.posts("/api/agent-status/omp/extension/install").last().body)
    }

    @Test
    fun uninstallEncodesQueryAndConsumesTheGuardOnce() = runBlocking {
        val repo = repository()
        val dir = "/srv/a b&c=\"d\"/é"
        val guard = TestGuard()
        repo.uninstallNativeIntegration(AgentKind.CODEX, dir, guard)
        val request = server.requests.single { it.method == "DELETE" && it.path == "/api/agent-status/integrations/codex" }
        assertEquals(mapOf("agentDir" to dir), query(request.query))
        assertTrue(request.query!!.contains("%"), "query values are percent-encoded on the wire")
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)

        repo.uninstallOmpExtension(dir, TestGuard())
        assertEquals(1, server.requests.count { it.method == "DELETE" && it.path == "/api/agent-status/omp/extension" })
    }

    @Test
    fun readsEncodeAllPathQueriesAndNeedNoGuard() = runBlocking {
        val repo = repository()
        repo.getAgentPathsVerification("/o m", "/c&x", "/l=é")
        val request = server.requests.single { it.path == "/api/agent-status/paths" }
        assertEquals(mapOf("agentDir" to "/o m", "codexDir" to "/c&x", "claudeDir" to "/l=é"), query(request.query))

        repo.getOmpExtensionStatus("/q?")
        assertEquals(mapOf("agentDir" to "/q?"), query(server.requests.single { it.path == "/api/agent-status/omp/extension" }.query))
        repo.getNativeIntegrationStatus(AgentKind.CLAUDE, null)
        assertNull(server.requests.single { it.path == "/api/agent-status/integrations/claude" }.query)
    }

    @Test
    fun suspendedCredentialsThenRetirementNeverSendsAnyInstallOrUninstall() = runBlocking {
        val ref = registry.getOrCreateConnection("p")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val client = ApiClient(ref, server.baseUrl, { entered.complete(Unit); release.await(); "token" }, registry)
        val repo = TerminalRepository(client)
        val guard = TestGuard()

        val call = async(Dispatchers.IO) { runCatching { repo.installOmpExtension("/a", guard) } }
        withTimeout(10_000) { entered.await() }
        registry.retireConnection(ref)
        release.complete(Unit)

        assertTrue(withTimeout(10_000) { call.await() }.exceptionOrNull() is RequestNotSubmittedError)
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
        assertEquals(0, server.count("POST"))
    }

    @Test
    fun guardIsSingleUseAcrossInstallAndUninstall() = runBlocking {
        val repo = repository()
        val guard = TestGuard()
        repo.installNativeIntegration(AgentKind.CLAUDE, "/x", guard)
        assertFailsWith<RequestNotSubmittedError> { repo.uninstallNativeIntegration(AgentKind.CLAUDE, "/x", guard) }
        assertEquals(0, server.count("DELETE"))
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
    }

    @Test
    fun terminalLifetimeGuardedCreateAndTerminateSmoke() = runBlocking {
        server.routeWithHeaders("/api/terminal") { _ ->
            Triple(
                201,
                mapOf("X-DamHopper-PTY-Epoch" to "3f8c7b6a-9123-4567-890a-bcdef0123456"),
                """{"id":"term-smoke-1","incarnation":18446744073709551615,"command":"bash","cwd":"/repo","alive":true}"""
            )
        }
        server.routeWithHeaders("/api/terminal/term-smoke-1/terminate") { req ->
            val body = ProtocolJson.parseToJsonElement(req.body) as JsonObject
            val v = body["version"]!!.jsonPrimitive.content.toInt()
            val epoch = body["expectedServerEpoch"]!!.jsonPrimitive.content
            val inc = body["expectedIncarnation"]!!.jsonPrimitive.content
            if (v == 1 && epoch == "3f8c7b6a-9123-4567-890a-bcdef0123456" && inc == "18446744073709551615") {
                Triple(202, mapOf("Content-Type" to "application/json"), """{"terminationRequested":true}""")
            } else {
                Triple(400, mapOf("Content-Type" to "application/json"), """{"error":"bad payload"}""")
            }
        }
        server.routeWithHeaders("/api/terminal/term-smoke-2/terminate") { _ ->
            Triple(200, emptyMap(), """{"restartCancelled":true}""")
        }
        server.routeWithHeaders("/api/terminal/term-smoke-3/terminate") { _ ->
            Triple(409, emptyMap(), """{"code":"TERMINAL_EPOCH_MISMATCH","message":"Epoch mismatch"}""")
        }

        val repo = repository()

        // 1. Guarded Create captures PTY epoch and numeric u64 incarnation
        val createOutcome = repo.createSessionGuarded(
            CreateSessionRequest(id = "term-smoke-1", command = "bash", cwd = "/repo")
        )
        assertEquals("term-smoke-1", createOutcome.id)
        assertEquals(18446744073709551615uL, createOutcome.incarnation)
        assertEquals("3f8c7b6a-9123-4567-890a-bcdef0123456", createOutcome.ptyEpoch)
        assertTrue(createOutcome.alive)

        // 2. Guarded Terminate 202 terminationRequested
        val termOutcome = repo.terminateSession(
            id = "term-smoke-1",
            expectedServerEpoch = createOutcome.ptyEpoch,
            expectedIncarnation = createOutcome.incarnation.toString(),
        )
        assertTrue(termOutcome.requested, "termOutcome must be requested: $termOutcome")
        assertFalse(termOutcome.restartCancelled)
        assertEquals(202, termOutcome.statusCode)
        val termReq = server.posts("/api/terminal/term-smoke-1/terminate").single()
        assertTrue(termReq.body.encodeToByteArray().size <= 512, "Payload must be <= 512 bytes")

        // 3. Restart Cancelled 200
        val cancelOutcome = repo.terminateSession(
            id = "term-smoke-2",
            expectedServerEpoch = "3f8c7b6a-9123-4567-890a-bcdef0123456",
            expectedIncarnation = "1",
        )
        assertFalse(cancelOutcome.requested)
        assertTrue(cancelOutcome.restartCancelled)
        assertEquals(200, cancelOutcome.statusCode)

        // 4. Epoch mismatch 409
        val conflictOutcome = repo.terminateSession(
            id = "term-smoke-3",
            expectedServerEpoch = "00000000-0000-0000-0000-000000000001",
            expectedIncarnation = "1",
        )
        assertFalse(conflictOutcome.requested)
        assertFalse(conflictOutcome.restartCancelled)
        assertEquals(409, conflictOutcome.statusCode)
    }

    @Test
    fun inMemoryStorePendingCreateRoundTripOnly() = runBlocking {
        val store = dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore()
        val intent = UncertainCreateRecord(
            intentId = "intent-uuid-42",
            profileId = "p",
            terminalId = "term-unresolved",
            createdAtEpochMs = 1710000000L,
            status = UncertainCreateStatus.PENDING,
        )
        // Verifies in-memory store CRUD round-trip only; this test does NOT prove
        // process-death durability or the production replacement-barrier coordinator.
        store.saveUncertainCreateRecord(intent)

        val restoredPending = store.loadUncertainCreateRecords()
        assertEquals(1, restoredPending.size)
        assertEquals("term-unresolved", restoredPending.single().terminalId)
        assertEquals(UncertainCreateStatus.PENDING, restoredPending.single().status)

        // Verifies status update to confirmed
        store.saveUncertainCreateRecord(intent.copy(status = UncertainCreateStatus.CONFIRMED))
        val settled = store.loadUncertainCreateRecords()
        assertEquals(UncertainCreateStatus.CONFIRMED, settled.single().status)
    }

    @Test
    fun createSessionRefusesDuplicateReplacementWhenUnsettledIntentExists() = runBlocking {
        val store = dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, server.baseUrl, { "token" }, registry)
        val repo = TerminalRepository(client, null, store)

        // Record unsettled pending intent for dam-hopper project
        store.saveUncertainCreateRecord(
            UncertainCreateRecord(
                intentId = "intent-123",
                profileId = "p",
                terminalId = "term-old-timestamp",
                project = "dam-hopper",
                createdAtEpochMs = 1710000000L,
                status = UncertainCreateStatus.PENDING,
            )
        )

        // Attempting to create another session with a new timestamp ID for the same project must be BLOCKED
        assertFailsWith<IllegalStateException> {
            repo.createSession(
                CreateSessionRequest(id = "term-new-timestamp", command = "bash", project = "dam-hopper")
            )
        }
        // Zero requests should have reached the server
        assertEquals(0, server.count("POST", "/api/terminal"))

        // Once settled, create succeeds
        store.removeUncertainCreateRecord("intent-123")
        server.routeWithHeaders("/api/terminal") { _ ->
            Triple(201, mapOf("X-DamHopper-PTY-Epoch" to "3f8c7b6a-9123-4567-890a-bcdef0123456"), """{"id":"term-new-timestamp","incarnation":1,"command":"bash","cwd":"/repo","alive":true}""")
        }
        val created = repo.createSession(
            CreateSessionRequest(id = "term-new-timestamp", command = "bash", project = "dam-hopper")
        )
        assertEquals("term-new-timestamp", created.id)
        assertEquals("3f8c7b6a-9123-4567-890a-bcdef0123456", created.serverPtyEpoch)
    }

    @Test
    fun concurrentCreateAdmissionBlocksSecondDispatchAcrossRepositoryInstances() = runBlocking {
        val sharedStore = dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore()
        val ref = registry.getOrCreateConnection("p-concurrent")
        val holdGate = CompletableDeferred<Unit>()
        val firstStarted = CompletableDeferred<Unit>()

        server.routeWithHeaders("/api/terminal") { _ ->
            firstStarted.complete(Unit)
            runBlocking { holdGate.await() }
            Triple(
                201,
                mapOf("X-DamHopper-PTY-Epoch" to "3f8c7b6a-9123-4567-890a-bcdef0123456"),
                """{"id":"term-first","incarnation":1,"command":"bash","cwd":"/repo","alive":true}"""
            )
        }

        val client1 = ApiClient(ref, server.baseUrl, { "token" }, registry)
        val client2 = ApiClient(ref, server.baseUrl, { "token" }, registry)
        val repo1 = TerminalRepository(client1, null, sharedStore)
        val repo2 = TerminalRepository(client2, null, sharedStore)

        val firstJob = async(Dispatchers.IO) {
            repo1.createSession(CreateSessionRequest(id = "term-first", command = "bash", project = "concurrent-proj"))
        }

        withTimeout(5000) { firstStarted.await() }

        val err = assertFailsWith<IllegalStateException> {
            repo2.createSession(CreateSessionRequest(id = "term-second", command = "bash", project = "concurrent-proj"))
        }
        assertTrue(err.message!!.contains("Unsettled pending terminal create intent"), "Must refuse with unsettled intent error: ${err.message}")

        assertEquals(1, server.count("POST", "/api/terminal"))

        val pending = sharedStore.loadUncertainCreateRecords()
        assertEquals(1, pending.size)
        assertEquals(UncertainCreateStatus.PENDING, pending.single().status)

        holdGate.complete(Unit)
        val created = withTimeout(5000) { firstJob.await() }
        assertEquals("term-first", created.id)
        assertEquals("/repo", created.cwd)

        assertEquals(0, sharedStore.loadUncertainCreateRecords().size)
    }
}
