package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentIntegrationRepositoryTest {
    private lateinit var server: SettingsTestServer
    private lateinit var registry: ConnectionRegistry
    private lateinit var resolver: FakeOwnerResolver
    private lateinit var scope: CoroutineScope
    private lateinit var settings: SettingsRepository
    private val events = CopyOnWriteArrayList<String>()
    private var revokeFailure: Exception? = null
    private val pathRevision = AtomicLong(1)

    private val extensionJson =
        """{"status":"installed","target_path":"/p","version":"1","bundled_version":"1","bundled_hash":"h"}"""
    private fun integrationJson(agent: String) =
        """{"agentKind":"$agent","status":"installed","readiness":"ready","target_path":"/t","launcher_path":"/l","manifest_path":"/m","bundled_version":"1","bundled_hash":"h"}"""
    private val pathsJson =
        """{"effectiveHome":"/h","ompInstallDir":"/h/.omp","ompNotificationDir":"/n","ompStatus":"ok","ompCanEnable":true,"codexConfigDir":"/h/.codex","codexNotificationDir":"/n","codexConfigExists":true,"codexCanEnable":true,"claudeCanEnable":true}"""

    @BeforeTest
    fun setUp() {
        server = SettingsTestServer()
        registry = ConnectionRegistry()
        resolver = FakeOwnerResolver(registry, server.baseUrl)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        settings = SettingsRepository(
            InMemoryPreferencesStore(), resolver, scope, 20L,
            invalidateRuntime = { events += "authority-revoke" },
        )
        server.route("/api/agent-status/paths") { _ -> 200 to pathsJson }
        server.route("/api/agent-status/omp/extension/install") { _ -> events += "request:omp-install"; 200 to extensionJson }
        server.route("/api/agent-status/omp/extension") { _ -> events += "request:omp"; 200 to extensionJson }
        server.route("/api/agent-status/integrations/claude") { r -> events += "request:claude-${r.method}"; 200 to integrationJson("claude") }
        server.route("/api/agent-status/integrations/codex") { r -> events += "request:codex-${r.method}"; 200 to integrationJson("codex") }
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        server.stop()
    }

    private suspend fun integration(
        invalidate: suspend (ConnectionRef) -> Unit = { events += "revoke"; revokeFailure?.let { throw it } },
    ): AgentIntegrationRepository {
        val binding = resolver.connect("T")
        settings.setSettingsTarget("T")
        return AgentIntegrationRepository(
            terminal = TerminalRepository(binding.client),
            owner = binding.owner,
            authority = settings.targetAuthority(),
            invalidateRuntime = invalidate,
            pathRevision = { pathRevision.get() },
        )
    }

    private val inputs = AgentPathInputs("/o", "/c", "/l")

    @Test
    fun refreshPublishesAnOwnerAndRevisionQualifiedSnapshot() = runBlocking {
        val repo = integration()
        assertTrue(repo.refresh(inputs))
        val snapshot = assertNotNull(repo.state.value.snapshot)
        assertEquals(repo.owner, snapshot.owner)
        assertEquals(1L, snapshot.pathRevision)
        assertEquals(inputs, snapshot.inputs)
        assertTrue(snapshot.paths.ompCanEnable)
        assertEquals(AgentKind.CLAUDE, snapshot.claude.agentKind)
        assertEquals(AgentKind.CODEX, snapshot.codex.agentKind)
        val query = server.requests.single { it.path == "/api/agent-status/paths" }.query!!
        assertTrue(query.contains("agentDir=%2Fo") || query.contains("agentDir=/o"), query)
    }

    @Test
    fun refreshResultIsDiscardedWhenPathsOrOwnerChangeMidFlight() = runBlocking {
        val repo = integration()
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        server.route("/api/agent-status/paths") { _ ->
            held.countDown()
            release.await(10, TimeUnit.SECONDS)
            200 to pathsJson
        }
        val call = async(Dispatchers.IO) { repo.refresh(inputs) }
        assertTrue(held.await(10, TimeUnit.SECONDS))
        pathRevision.incrementAndGet() // a path edit/revocation happened while the request was in flight
        release.countDown()
        assertFalse(withTimeout(10_000) { call.await() })
        assertNull(repo.state.value.snapshot, "stale verification must not be published")

        server.route("/api/agent-status/paths") { _ -> 200 to pathsJson }
        assertTrue(repo.refresh(inputs))
        settings.setSettingsTarget("other")
        server.route("/api/agent-status/paths") { _ -> 200 to pathsJson }
        assertFalse(repo.refresh(inputs), "an owner that is no longer the selected target is never published")
    }

    @Test
    fun installAwaitsRevocationBeforeTheRequestAndSendsStructuredBody() = runBlocking {
        val repo = integration(invalidate = { events += "revoke-start"; delay(80); events += "revoke-end" })
        val hostile = "C:\\Users\\\"Ünï\"\\.claude"
        val outcome = repo.installIntegration(AgentKind.CLAUDE, hostile)
        assertTrue(outcome is SettingsOutcome.Confirmed, outcome.toString())
        assertEquals(listOf("revoke-start", "revoke-end", "request:claude-POST"), events.toList())
        val body = Json.parseToJsonElement(server.posts("/api/agent-status/integrations/claude").single().body) as JsonObject
        assertEquals(hostile, body["agentDir"]!!.jsonPrimitive.content)
        assertTrue(repo.state.value.needsRefresh)
        assertNull(repo.state.value.snapshot)
    }

    @Test
    fun failedRevocationAbortsEveryMutationWithZeroRequests() = runBlocking {
        val repo = integration()
        revokeFailure = IllegalStateException("provider down")
        listOf(
            repo.installOmp("/o"),
            repo.uninstallOmp("/o"),
            repo.installIntegration(AgentKind.CLAUDE, "/l"),
            repo.uninstallIntegration(AgentKind.CODEX, "/c"),
        ).forEach { assertTrue(it is SettingsOutcome.NotSubmitted, it.toString()) }
        assertEquals(0, server.requests.size)
        assertNull(repo.state.value.busy)
        assertFalse(repo.state.value.needsRefresh, "nothing was sent, earlier evidence is unchanged")
    }

    @Test
    fun cancelledRevocationPropagatesAndReleasesTheBusyClaim() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val repo = integration(invalidate = { gate.await() })
        val job = launch(Dispatchers.IO) { repo.installOmp("/o") }
        withTimeout(10_000) { while (repo.state.value.busy == null) delay(5) }
        job.cancel()
        job.join()
        assertNull(repo.state.value.busy)
        assertEquals(0, server.requests.size)
        // The next explicit action works; nothing was retried automatically.
        gate.complete(Unit)
        assertTrue(repo.installOmp("/o") is SettingsOutcome.Confirmed)
    }

    @Test
    fun ambiguousInstallAnswersAreUnknownAndDropVerificationEvidence() = runBlocking {
        val repo = integration()
        assertTrue(repo.refresh(inputs))
        server.route("/api/agent-status/omp/extension/install") { _ -> 200 to "<html>" }
        val outcome = repo.installOmp("/o")
        assertTrue(outcome is SettingsOutcome.Unknown, outcome.toString())
        assertNull(repo.state.value.snapshot)
        assertTrue(repo.state.value.needsRefresh)
        assertEquals(1, server.posts("/api/agent-status/omp/extension/install").size, "never replayed")

        server.route("/api/agent-status/omp/extension/install") { _ -> 400 to """{"error":"unsafe path"}""" }
        assertTrue(repo.installOmp("/o") is SettingsOutcome.Rejected)
        assertTrue(repo.state.value.message!!.contains("unsafe path"))
    }

    @Test
    fun suspendedCredentialsThenTargetAbaSendsNothing() = runBlocking {
        val repo = integration()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        resolver.credentialGate = { entered.complete(Unit); release.await() }
        val call = async(Dispatchers.IO) { repo.uninstallIntegration(AgentKind.CLAUDE, "/l") }
        withTimeout(10_000) { entered.await() }
        resolver.credentialGate = null
        settings.setSettingsTarget("other")
        settings.setSettingsTarget("T")
        release.complete(Unit)
        assertTrue(withTimeout(10_000) { call.await() } is SettingsOutcome.NotSubmitted)
        assertEquals(0, server.count("DELETE"))
    }

    @Test
    fun staleOwnerHasNoGuardAndSendsNothing() = runBlocking {
        val repo = integration()
        settings.setSettingsTarget("someone-else")
        val outcome = repo.installOmp("/o")
        assertTrue(outcome is SettingsOutcome.NotSubmitted, outcome.toString())
        assertEquals(0, server.requests.size)
        assertTrue(events.isEmpty(), "stale owner has no guard and sends nothing; invalidation is skipped")
    }

    @Test
    fun onlyOneActionRunsAtATime() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val repo = integration(invalidate = { gate.await() })
        val first = async(Dispatchers.IO) { repo.installOmp("/o") }
        withTimeout(10_000) { while (repo.state.value.busy == null) delay(5) }
        assertTrue(repo.installIntegration(AgentKind.CODEX, "/c") is SettingsOutcome.NotSubmitted)
        assertFalse(repo.refresh(inputs))
        gate.complete(Unit)
        assertTrue(withTimeout(10_000) { first.await() } is SettingsOutcome.Confirmed)
    }
}
