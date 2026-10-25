package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
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
}
