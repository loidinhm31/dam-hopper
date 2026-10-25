package dev.damhopper.nativeapp.features.settings

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.RequestAdmissionState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// ---------------------------------------------------------------------------------------------
// Shared harness (internal: reused by the editor and host/workspace/terminal tests). It exercises
// the REAL ApiClient/ConnectionRegistry transport against a local JDK HTTP server.
// ---------------------------------------------------------------------------------------------

internal data class RecordedRequest(
    val method: String,
    val path: String,
    val query: String?,
    val body: String,
    val contentType: String?,
)

internal class SettingsTestServer {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    init {
        server.executor = Executors.newCachedThreadPool()
        server.start()
    }

    fun route(path: String, handler: (RecordedRequest) -> Pair<Int, String>) {
        try {
            server.removeContext(path)
        } catch (_: IllegalArgumentException) {
            // first registration
        }
        server.createContext(path) { exchange ->
            val body = exchange.requestBody.readBytes().decodeToString()
            val request = RecordedRequest(
                method = exchange.requestMethod,
                path = exchange.requestURI.path,
                query = exchange.requestURI.rawQuery,
                body = body,
                contentType = exchange.requestHeaders.getFirst("Content-Type"),
            )
            requests += request
            val (status, text) = handler(request)
            val bytes = text.encodeToByteArray()
            exchange.sendResponseHeaders(status, if (bytes.isEmpty()) -1L else bytes.size.toLong())
            if (bytes.isNotEmpty()) exchange.responseBody.use { it.write(bytes) } else exchange.close()
        }
    }

    fun count(method: String? = null, path: String? = null): Int =
        requests.count { (method == null || it.method == method) && (path == null || it.path == path) }

    fun posts(path: String): List<RecordedRequest> = requests.filter { it.method == "POST" && it.path == path }

    fun stop() = server.stop(0)
}

internal class FakeOwnerResolver(
    private val registry: ConnectionRegistry,
    private val baseUrl: String,
) : SettingsOwnerResolver {
    private val published = MutableStateFlow<Map<String, SettingsBinding>>(emptyMap())

    /** Suspends credential resolution inside the real ApiClient (pre-admission window). */
    @Volatile var credentialGate: (suspend () -> Unit)? = null

    /** Runs once, on the committing thread, while the registry and operation gates are both held. */
    val snapshotHook = AtomicReference<(() -> Unit)?>(null)

    override suspend fun current(profileId: String): SettingsBinding? = published.value[profileId]

    override fun currentSnapshot(profileId: String): SettingsBinding? {
        snapshotHook.getAndSet(null)?.invoke()
        return published.value[profileId]
    }

    suspend fun connect(
        profileId: String,
        accountId: String = "account-$profileId",
        endpoint: String = "$baseUrl/$profileId",
    ): SettingsBinding {
        val ref = registry.getOrCreateConnection(profileId)
        val client = ApiClient(ref, baseUrl, { credentialGate?.invoke(); "token" }, registry)
        val binding = SettingsBinding(SettingsOwner(ref, endpoint, accountId), client)
        published.update { it + (profileId to binding) }
        return binding
    }

    fun binding(profileId: String): SettingsBinding = published.value.getValue(profileId)

    /** Retires the current owner in the real registry; a successor must be connected explicitly. */
    suspend fun retire(profileId: String) {
        registry.retireConnection(published.value.getValue(profileId).owner.connection)
        published.update { it - profileId }
    }
}

/** Polls (real time) until [condition] holds; fails the test after 10 seconds. */
internal suspend fun awaitCondition(what: String, condition: () -> Boolean) {
    try {
        withTimeout(10_000) { while (!condition()) delay(10) }
    } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
        throw AssertionError("Timed out waiting for: $what")
    }
}

class SettingsRepositoryTest {
    private lateinit var server: SettingsTestServer
    private lateinit var registry: ConnectionRegistry
    private lateinit var resolver: FakeOwnerResolver
    private lateinit var scope: CoroutineScope
    private var remoteUi = "{}"

    @BeforeTest
    fun setUp() {
        server = SettingsTestServer()
        registry = ConnectionRegistry()
        resolver = FakeOwnerResolver(registry, server.baseUrl)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        remoteUi = "{}"
        server.route("/api/global-config") { _ -> 200 to """{"ui":$remoteUi}""" }
        server.route("/api/global-config/ui") { _ -> 200 to """{"updated":true}""" }
        server.route("/api/settings/cache-clear") { _ -> 200 to """{"ok":true}""" }
        server.route("/api/settings/reset") { _ -> 200 to """{"ok":true}""" }
        server.route("/api/settings/export/workspace.toml") { _ -> 200 to "name = \"x\"\n" }
        server.route("/api/settings/import/workspace.toml") { _ ->
            200 to """{"imported":true,"fileName":"dam-hopper.toml","backupFileName":"dam-hopper.toml.bak.1","workspaceName":"W"}"""
        }
    }

    @AfterTest
    fun tearDown() {
        scope.cancel()
        server.stop()
    }

    private fun repo(
        store: PreferencesStore = InMemoryPreferencesStore(),
        invalidate: suspend (ConnectionRef) -> Unit = {},
    ) = SettingsRepository(store, resolver, scope, debounceMillis = 20L, invalidateRuntime = invalidate)

    private suspend fun awaitUiPosts(count: Int) =
        awaitCondition("$count ui POST(s)") { server.posts("/api/global-config/ui").size >= count }

    // ---- local behavior ----

    @Test
    fun clampingUsesWebBoundsIncludingScrollStepFifty() {
        val clamped = WorkbenchPreferences(
            systemFontSize = 5, editorFontSize = 50, terminalFontSize = 2, terminalScrollStep = 100,
        ).clamped()
        assertEquals(10, clamped.systemFontSize)
        assertEquals(32, clamped.editorFontSize)
        assertEquals(10, clamped.terminalFontSize)
        assertEquals(50, clamped.terminalScrollStep)
        assertEquals(1, WorkbenchPreferences(terminalScrollStep = 0).clamped().terminalScrollStep)
    }

    @Test
    fun localUpdateCommitsImmediatelyAndPersistsWithoutSource() = runBlocking {
        val store = InMemoryPreferencesStore()
        val repository = repo(store)
        repository.updatePreferences { it.copy(editorFontSize = 18, theme = WorkbenchTheme.LIGHT) }
        assertEquals(18, repository.preferences.value.editorFontSize)
        assertEquals(18, store.loadPreferences().editorFontSize)
        assertEquals(WorkbenchTheme.LIGHT, store.loadPreferences().theme)
        assertEquals(PreferenceSyncStatus.LOCAL_ONLY, repository.syncState.value.status)
        assertEquals(0, server.requests.size)
    }

    @Test
    fun sourceAndTargetSelectionAreIndependentAndRemovalKeepsSnapshot() = runBlocking {
        resolver.connect("alpha")
        val repository = repo()
        repository.switchPreferenceSource("alpha")
        repository.setSettingsTarget("alpha")
        repository.updatePreferences { it.copy(editorFontSize = 20) }
        repository.setSettingsTarget("other")
        awaitCondition("target committed") { repository.sourceTargetState.value.settingsProfileId == "other" }
        assertEquals("alpha", repository.sourceTargetState.value.preferencesProfileId)
        assertEquals("other", repository.sourceTargetState.value.settingsProfileId)

        repository.onProfileRemoved("alpha")
        awaitCondition("source removal committed") { repository.sourceTargetState.value.preferencesProfileId == null }
        val state = repository.sourceTargetState.value
        assertNull(state.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.SOURCE_REMOVED, state.preferencesStatus)
        assertEquals("other", state.settingsProfileId)
        assertEquals(20, repository.preferences.value.editorFontSize)
    }

    // ---- language wire values / legacy fallback ----

    @Test
    fun everyRealLanguageValueHydratesAndSavesExactWireValue() = runBlocking {
        resolver.connect("A")
        for (filter in ExplorerLanguageFilter.entries) {
            server.requests.clear()
            remoteUi = """{"explorerLanguageFilter":"${filter.wire}"}"""
            val repository = repo()
            assertTrue(repository.switchPreferenceSource("A"))
            assertEquals(filter, repository.preferences.value.explorerLanguageFilter)
            assertNull(repository.languageFilterMigrationNotice.value)

            val other = ExplorerLanguageFilter.entries.first { it != filter }
            repository.setExplorerLanguageFilter(other)
            awaitUiPosts(1)
            assertEquals("""{"ui":{"explorerLanguageFilter":"${other.wire}"}}""", server.posts("/api/global-config/ui").single().body)
        }
    }

    @Test
    fun legacyLanguageFallbackIsLocalNeverDirtyAndNeverSavedRemotely() = runBlocking {
        resolver.connect("A")
        for (legacy in LEGACY_EXPLORER_LANGUAGE_FILTERS) {
            server.requests.clear()
            val store = InMemoryPreferencesStore(initialLegacyExplorerLanguageFilter = legacy)
            val repository = repo(store)
            assertNotNull(repository.languageFilterMigrationNotice.value, legacy)
            assertEquals(ExplorerLanguageFilter.ALL, repository.preferences.value.explorerLanguageFilter)

            // Unrelated save on an ACTIVE source: the fallback filter is omitted from the patch.
            repository.switchPreferenceSource("A")
            assertNotNull(repository.languageFilterMigrationNotice.value, "hydrate without a remote filter keeps the notice for $legacy")
            repository.updatePreferences { it.copy(editorFontSize = 22) }
            awaitUiPosts(1)
            val body = server.posts("/api/global-config/ui").single().body
            assertEquals("""{"ui":{"editorFontSize":22}}""", body, legacy)
            assertFalse(body.contains("explorerLanguageFilter"))
            assertEquals(legacy, store.loadLegacyExplorerLanguageFilter(), "recovery metadata must survive unrelated saves")
        }
    }

    @Test
    fun unknownRemoteLanguageValueIsLocalAllWithNoticeAndNotDirty() = runBlocking {
        resolver.connect("A")
        remoteUi = """{"explorerLanguageFilter":"known"}"""
        val repository = repo()
        assertTrue(repository.switchPreferenceSource("A"))
        assertEquals(ExplorerLanguageFilter.ALL, repository.preferences.value.explorerLanguageFilter)
        assertNotNull(repository.languageFilterMigrationNotice.value)
        assertEquals("known", repository.sourceTargetState.value.lastSnapshotLegacyLanguageFilter)

        repository.updatePreferences { it.copy(terminalFontSize = 20) }
        awaitUiPosts(1)
        assertEquals("""{"ui":{"terminalFontSize":20}}""", server.posts("/api/global-config/ui").single().body)
    }

    @Test
    fun explicitAllSelectionOverFallbackIsWrittenAndClearsNotice() = runBlocking {
        resolver.connect("A")
        val store = InMemoryPreferencesStore(initialLegacyExplorerLanguageFilter = "text")
        val repository = repo(store)
        repository.switchPreferenceSource("A")
        assertNotNull(repository.languageFilterMigrationNotice.value)
        repository.setExplorerLanguageFilter(ExplorerLanguageFilter.ALL)
        assertNull(repository.languageFilterMigrationNotice.value)
        assertNull(store.loadLegacyExplorerLanguageFilter())
        awaitUiPosts(1)
        assertEquals("""{"ui":{"explorerLanguageFilter":"all"}}""", server.posts("/api/global-config/ui").single().body)
    }

    // ---- policy preservation ----

    @Test
    fun unsupportedRemotePolicyIsPreservedReadOnlyAndOmittedFromUnrelatedSaves() = runBlocking {
        resolver.connect("A")
        remoteUi = """{"terminalAgentNotifications":{"version":3,"agents":{"omp":{"enabled":true}}}}"""
        val repository = repo()
        repository.switchPreferenceSource("A")
        val raw = assertNotNull(repository.unsupportedPolicy.value)
        assertEquals(JsonPrimitive(3), raw["version"])
        assertFalse(repository.preferences.value.terminalAgentNotifications.agents.omp.enabled)

        repository.updatePolicy { it.copy(agents = it.agents.copy(omp = it.agents.omp.copy(enabled = true))) }
        assertFalse(repository.preferences.value.terminalAgentNotifications.agents.omp.enabled, "unsupported policy is read-only")

        repository.updatePreferences { it.copy(systemFontSize = 16) }
        awaitUiPosts(1)
        val body = server.posts("/api/global-config/ui").single().body
        assertEquals("""{"ui":{"systemFontSize":16}}""", body)
        assertEquals(raw, repository.unsupportedPolicy.value)
    }

    @Test
    fun explicitSupportedPolicyEditIsTheOnlySaveThatIncludesV2Policy() = runBlocking {
        resolver.connect("A")
        remoteUi = """{"terminalAgentNotifications":{"version":2,"agents":{}}}"""
        val repository = repo()
        repository.switchPreferenceSource("A")
        assertNull(repository.unsupportedPolicy.value)
        repository.updatePolicy { it.copy(agents = it.agents.copy(claude = it.agents.claude.copy(enabled = true, volume = 0.25))) }
        awaitUiPosts(1)
        val body = server.posts("/api/global-config/ui").single().body
        assertTrue(body.contains("\"terminalAgentNotifications\""), body)
        assertTrue(body.contains("\"volume\":25"), body)
        awaitCondition("first save published") { repository.syncState.value.status == PreferenceSyncStatus.SYNCED }

        repository.updatePreferences { it.copy(editorFontSize = 12) }
        awaitUiPosts(2)
        assertEquals("""{"ui":{"editorFontSize":12}}""", server.posts("/api/global-config/ui")[1].body)
    }

    // ---- source failure ----

    @Test
    fun hydrateFailureKeepsLocalSnapshotAndSaysSoWithoutAnotherServer() = runBlocking {
        resolver.connect("A")
        server.route("/api/global-config") { _ -> 500 to """{"error":"boom"}""" }
        val repository = repo()
        repository.updatePreferences { it.copy(editorFontSize = 19) }
        assertFalse(repository.switchPreferenceSource("A"))
        assertEquals(19, repository.preferences.value.editorFontSize)
        assertEquals(PreferenceSyncStatus.HYDRATE_FAILED, repository.syncState.value.status)
        assertEquals("A", repository.sourceTargetState.value.preferencesProfileId)
        assertEquals(PreferenceSourceStatus.ACTIVE, repository.sourceTargetState.value.preferencesStatus)
    }

    @Test
    fun disconnectedSourceReportsOfflineAndKeepsLocalEditsWithoutRetry() = runBlocking {
        val repository = repo()
        assertFalse(repository.switchPreferenceSource("never-connected"))
        assertEquals(PreferenceSyncStatus.OFFLINE, repository.syncState.value.status)
        repository.updatePreferences { it.copy(editorFontSize = 17) }
        delay(120)
        assertEquals(17, repository.preferences.value.editorFontSize)
        assertEquals(0, server.count("POST"))
    }

    // ---- admission / ordering ----

    @Test
    fun credentialSuspensionAbaAcrossSourcesNeverSubmitsTheFirstA() = runBlocking {
        resolver.connect("A")
        resolver.connect("B")
        val repository = repo()
        repository.switchPreferenceSource("A")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        resolver.credentialGate = { entered.complete(Unit); release.await() }

        repository.updatePreferences { it.copy(editorFontSize = 21) }
        withTimeout(10_000) { entered.await() } // save is suspended inside credential resolution
        resolver.credentialGate = null
        repository.switchPreferenceSource("B")
        repository.switchPreferenceSource("A")
        release.complete(Unit)

        delay(250)
        assertEquals(0, server.posts("/api/global-config/ui").size, "the first A must be rejected at admission")
        assertEquals(PreferenceSourceStatus.ACTIVE, repository.sourceTargetState.value.preferencesStatus)
    }

    @Test
    fun retiredOwnerAfterSuspendedCredentialsIsNotSubmittedWithZeroRequests() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        resolver.credentialGate = { entered.complete(Unit); release.await() }

        val call = async(Dispatchers.IO) { repository.clearCache(op) }
        withTimeout(10_000) { entered.await() }
        resolver.retire("T")
        release.complete(Unit)

        val outcome = withTimeout(10_000) { call.await() }
        assertTrue(outcome is SettingsOutcome.NotSubmitted, outcome.toString())
        assertEquals(0, server.count("POST", "/api/settings/cache-clear"))
    }

    @Test
    fun invalidationAfterHeldRegistryLockRejectsTheEarlierGuard() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val ref = op.owner.connection
        val heldRegistry = CountDownLatch(1)
        val releaseRegistry = CountDownLatch(1)
        val holder = async(Dispatchers.IO) {
            registry.admitCurrentOwner(ref) { heldRegistry.countDown(); releaseRegistry.await(10, TimeUnit.SECONDS); true }
        }
        assertTrue(heldRegistry.await(10, TimeUnit.SECONDS))

        val call = async(Dispatchers.IO) { repository.clearCache(op) } // waits for the registry lock
        delay(100)
        repository.setSettingsTarget("elsewhere") // newer intent registered first (operation gate is free)
        releaseRegistry.countDown()
        holder.await()

        assertTrue(withTimeout(10_000) { call.await() } is SettingsOutcome.NotSubmitted)
        assertEquals(0, server.count("POST", "/api/settings/cache-clear"))
    }

    @Test
    fun operationGateHeldWithQueuedInvalidationRejectsSimultaneousGuardAndHandsOffToTheWaiter() = runBlocking {
        val binding = resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val first = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val inGate = CountDownLatch(1)
        val releaseGate = CountDownLatch(1)
        // isCurrent() reads the published snapshot while holding ONLY the operation gate.
        resolver.snapshotHook.set { inGate.countDown(); releaseGate.await(10, TimeUnit.SECONDS) }
        val holder = async(Dispatchers.IO) { repository.isCurrent(first) }
        assertTrue(inGate.await(10, TimeUnit.SECONDS))

        repository.setSettingsTarget("later") // registers as a queued waiter on the same fair gate
        val simultaneous = repository.requestGuard(first)
        val contended = runCatching { binding.client.postJson("/api/settings/cache-clear", "{}", simultaneous) }
        assertTrue(contended.exceptionOrNull() is dev.damhopper.nativeapp.core.transport.RequestNotSubmittedError)
        assertEquals(RequestAdmissionState.REJECTED, simultaneous.admission.value, "contention is terminal, never a wait")
        assertEquals(0, server.count("POST", "/api/settings/cache-clear"))

        releaseGate.countDown()
        assertTrue(withTimeout(10_000) { holder.await() }, "the holder evaluated before the queued invalidation")
        awaitCondition("queued invalidation handed the gate") { repository.sourceTargetState.value.settingsProfileId == "later" }
        assertFalse(repository.isCurrent(first))
        assertEquals(0, server.count("POST", "/api/settings/cache-clear"), "no retry after contention")
    }

    @Test
    fun guardReuseAndConcurrentUseAreNotSubmittedWithoutAlteringTheFirstReceipt() = runBlocking {
        val binding = resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val guard = repository.requestGuard(op)
        binding.client.postJson("/api/settings/cache-clear", "{}", guard)
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)

        assertFailsWith<dev.damhopper.nativeapp.core.transport.RequestNotSubmittedError> {
            binding.client.postJson("/api/settings/cache-clear", "{}", guard)
        }
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
        assertEquals(1, server.count("POST", "/api/settings/cache-clear"))
    }

    @Test
    fun cancellationAfterAdmissionIsRecordedUnknownAndBusyTokenIsCleaned() = runBlocking {
        resolver.connect("T")
        val release = CountDownLatch(1)
        server.route("/api/settings/reset") { _ -> release.await(10, TimeUnit.SECONDS); 200 to """{"ok":true}""" }
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))

        val job = launch(Dispatchers.IO) { repository.nuclearReset(op) }
        awaitCondition("request reached the server") { server.count("POST", "/api/settings/reset") == 1 }
        assertEquals(op.operationId, repository.busy.value[SettingsBusyKind.RESET])
        job.cancel()
        job.join()
        release.countDown()

        val status = assertNotNull(repository.ownerStatus.value[op.owner])
        assertEquals(SettingsOutcomeKind.UNKNOWN, status.outcome)
        assertTrue(repository.busy.value.isEmpty())
        assertEquals(1, server.count("POST", "/api/settings/reset"), "never replayed")
    }

    @Test
    fun staleBusyCleanupCannotClearANewerTokenAfterTargetReselection() = runBlocking {
        resolver.connect("T")
        val firstRelease = CountDownLatch(1)
        val secondRelease = CountDownLatch(1)
        val hits = java.util.concurrent.atomic.AtomicInteger()
        server.route("/api/settings/export/workspace.toml") { _ ->
            if (hits.incrementAndGet() == 1) firstRelease.await(10, TimeUnit.SECONDS) else secondRelease.await(10, TimeUnit.SECONDS)
            200 to "a = 1"
        }
        val repository = repo()
        repository.setSettingsTarget("T")
        val first = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val firstCall = async(Dispatchers.IO) { repository.exportWorkspaceToml(first) }
        awaitCondition("first export busy") { repository.busy.value[SettingsBusyKind.EXPORT] == first.operationId }
        awaitCondition("first export in flight") { hits.get() == 1 }

        repository.setSettingsTarget("other")
        repository.setSettingsTarget("T") // reselect: the first token is invalidated, not merely replaced
        awaitCondition("reselected") { repository.sourceTargetState.value.settingsProfileId == "T" && repository.busy.value.isEmpty() }
        val second = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val secondCall = async(Dispatchers.IO) { repository.exportWorkspaceToml(second) }
        awaitCondition("second export busy") { repository.busy.value[SettingsBusyKind.EXPORT] == second.operationId }

        firstRelease.countDown() // the stale first request completes and runs its cleanup
        withTimeout(10_000) { firstCall.await() }
        assertEquals(second.operationId, repository.busy.value[SettingsBusyKind.EXPORT], "stale cleanup must not clear the newer token")

        secondRelease.countDown()
        withTimeout(10_000) { secondCall.await() }
        assertTrue(repository.busy.value.isEmpty())
    }

    // ---- import / cache / reset ----

    @Test
    fun importRequiresImportedTrueWithRequiredFieldsAndShowsAuthoritativeBackup() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val outcome = repository.importWorkspaceToml(op, "name = \"w\"".encodeToByteArray())
        assertTrue(outcome is SettingsOutcome.Confirmed, outcome.toString())
        val confirmed = (outcome as SettingsOutcome.Confirmed).value
        assertEquals("dam-hopper.toml.bak.1", confirmed.backupFileName)
        assertEquals("W", confirmed.workspaceName)
        assertEquals(confirmed, repository.importExportState.value.lastImportResult)
        assertTrue(server.posts("/api/settings/import/workspace.toml").single().contentType.orEmpty().startsWith("application/toml"))
    }

    @Test
    fun importFalseMissingMalformedAndHttpErrorsNeverConfirm() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val cases = listOf(
            """{"imported":false,"fileName":"f","backupFileName":"b"}""" to SettingsOutcomeKind.REJECTED,
            """{"ok":true}""" to SettingsOutcomeKind.UNKNOWN, // obsolete discriminator is not a confirmation
            """{"imported":true,"fileName":"f"}""" to SettingsOutcomeKind.UNKNOWN,
            """{"imported":"true","fileName":"f","backupFileName":"b"}""" to SettingsOutcomeKind.UNKNOWN,
            "not json" to SettingsOutcomeKind.UNKNOWN,
        )
        for ((body, expected) in cases) {
            server.route("/api/settings/import/workspace.toml") { _ -> 200 to body }
            val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
            val outcome = repository.importWorkspaceToml(op, "a = 1".encodeToByteArray())
            assertEquals(expected, outcome.kind, body)
            assertNull(repository.importExportState.value.lastImportResult, body)
        }
        server.route("/api/settings/import/workspace.toml") { _ -> 400 to """{"error":"invalid toml"}""" }
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        assertEquals(SettingsOutcomeKind.REJECTED, repository.importWorkspaceToml(op, "x".encodeToByteArray()).kind)
        server.route("/api/settings/import/workspace.toml") { _ -> 500 to """{"error":"io"}""" }
        val op2 = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        assertEquals(SettingsOutcomeKind.UNKNOWN, repository.importWorkspaceToml(op2, "x".encodeToByteArray()).kind)
        assertEquals(7, server.count("POST", "/api/settings/import/workspace.toml"), "one attempt per explicit call, no replay")
    }

    @Test
    fun importBoundaryAndInvalidUtf8AreNotSubmittedBeforeAnyRequest() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val atLimit = ByteArray(MAX_CONFIG_IMPORT_BYTES.toInt()) { 'a'.code.toByte() }
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        assertTrue(repository.importWorkspaceToml(op, atLimit) is SettingsOutcome.Confirmed)

        // A confirmed import changes the target; later attempts need a freshly captured operation.
        val overBy1 = ByteArray(MAX_CONFIG_IMPORT_BYTES.toInt() + 1) { 'a'.code.toByte() }
        val op2 = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        assertTrue(repository.importWorkspaceToml(op2, overBy1) is SettingsOutcome.NotSubmitted)
        val invalid = byteArrayOf(0x61, 0xC3.toByte(), 0x28)
        assertTrue(repository.importWorkspaceToml(op2, invalid) is SettingsOutcome.NotSubmitted)
        // Multibyte payload within the limit round-trips.
        val multibyte = "名前 = \"日本\"".encodeToByteArray()
        assertTrue(repository.importWorkspaceToml(op2, multibyte) is SettingsOutcome.Confirmed)
        assertEquals(2, server.count("POST", "/api/settings/import/workspace.toml"))
    }

    @Test
    fun clearCacheAndResetMapOkFlagAndHttpStatusHonestly() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        assertEquals(SettingsOutcomeKind.CONFIRMED, repository.clearCache(op).kind)
        server.route("/api/settings/reset") { _ -> 200 to """{"ok":false}""" }
        assertEquals(SettingsOutcomeKind.UNKNOWN, repository.nuclearReset(op).kind)
        server.route("/api/settings/reset") { _ -> 403 to """{"error":"denied"}""" }
        assertEquals(SettingsOutcomeKind.REJECTED, repository.nuclearReset(op).kind)
        server.route("/api/settings/reset") { _ -> 502 to "" }
        assertEquals(SettingsOutcomeKind.UNKNOWN, repository.nuclearReset(op).kind)
    }

    @Test
    fun exportIsBoundedAndGuarded() = runBlocking {
        resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val op = assertNotNull(repository.captureOperation(SettingsScope.SETTINGS_TARGET))
        val ok = repository.exportWorkspaceToml(op)
        assertEquals("name = \"x\"\n", (ok as SettingsOutcome.Confirmed).value.decodeToString())
        server.route("/api/settings/export/workspace.toml") { _ -> 200 to "a".repeat(MAX_CONFIG_IMPORT_BYTES.toInt() + 1) }
        assertTrue(repository.exportWorkspaceToml(op) is SettingsOutcome.Rejected, "oversize server export is refused")
    }

    // ---- agent paths ----

    @Test
    fun agentPathEditAwaitsRevocationBeforeTheRequestAndPreservesOtherEntries() = runBlocking {
        resolver.connect("A")
        remoteUi = """{"agentSettingsPaths":{"ompAgentDir":"~/.omp/agent","claudeDir":"/c","future":"keep"}}"""
        val order = CopyOnWriteArrayList<String>()
        val repository = repo(invalidate = { order += "revoke:${it.profileId}"; delay(30); order += "revoked" })
        repository.switchPreferenceSource("A")
        val revisionBefore = repository.agentPathsRevision.value
        val op = assertNotNull(repository.captureOperation(SettingsScope.PREFERENCE_SOURCE))

        val outcome = repository.updateAgentSettingsPath(op, AgentPathKey.CODEX, "/srv/codex \"q\" \\ é")
        assertTrue(outcome is SettingsOutcome.Confirmed, outcome.toString())
        assertEquals(listOf("revoke:A", "revoked"), order)
        val body = server.posts("/api/global-config/ui").single().body
        val sent = (kotlinx.serialization.json.Json.parseToJsonElement(body) as JsonObject)["ui"] as JsonObject
        val paths = sent["agentSettingsPaths"] as JsonObject
        assertEquals("/srv/codex \"q\" \\ é", (paths["codexDir"] as JsonPrimitive).content)
        assertEquals("keep", (paths["future"] as JsonPrimitive).content)
        assertEquals("/c", (paths["claudeDir"] as JsonPrimitive).content)
        assertTrue(repository.agentPathsRevision.value >= revisionBefore + 2, "revision advances before and after the edit")
    }

    @Test
    fun failedOrCancelledRevocationAbortsThePathEditWithZeroRequests() = runBlocking {
        resolver.connect("A")
        val failing = repo(invalidate = { throw IllegalStateException("provider down") })
        failing.switchPreferenceSource("A")
        val op = assertNotNull(failing.captureOperation(SettingsScope.PREFERENCE_SOURCE))
        val outcome = failing.updateAgentSettingsPath(op, AgentPathKey.OMP, "/x")
        assertTrue(outcome is SettingsOutcome.NotSubmitted, outcome.toString())
        assertEquals(0, server.posts("/api/global-config/ui").size)

        val gate = CompletableDeferred<Unit>()
        val cancelling = repo(invalidate = { gate.await() })
        cancelling.switchPreferenceSource("A")
        val op2 = assertNotNull(cancelling.captureOperation(SettingsScope.PREFERENCE_SOURCE))
        val job = launch(Dispatchers.IO) { cancelling.updateAgentSettingsPath(op2, AgentPathKey.OMP, "/x") }
        awaitCondition("revocation in progress") { cancelling.busy.value.containsKey(SettingsBusyKind.AGENT_PATHS) }
        job.cancel()
        job.join()
        assertEquals(0, server.posts("/api/global-config/ui").size)
        assertTrue(cancelling.busy.value.isEmpty())
        assertEquals(SettingsOutcomeKind.NOT_SUBMITTED, cancelling.ownerStatus.value.getValue(op2.owner).outcome)
    }

    @Test
    fun targetAuthorityGuardsOnlyTheExactSelectedOwner() = runBlocking {
        val binding = resolver.connect("T")
        val repository = repo()
        repository.setSettingsTarget("T")
        val authority = repository.targetAuthority()
        assertTrue(authority.isCurrent(binding.owner))
        assertNotNull(authority.guardFor(binding.owner))
        val otherAccount = binding.owner.copy(accountId = "someone-else")
        assertNull(authority.guardFor(otherAccount))
        assertFalse(authority.isCurrent(otherAccount))
        repository.setSettingsTarget(null)
        assertNull(authority.guardFor(binding.owner))
    }
}

/** Minimal request-local guard for non-Settings tests: admits only while the connection is the current owner. */
internal class TestGuard(private val validate: () -> Boolean = { true }) : dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard {
    private val state = MutableStateFlow(RequestAdmissionState.PENDING)
    private val claimed = MutableStateFlow(false)
    val admitCalls = java.util.concurrent.atomic.AtomicInteger()
    override val admission: kotlinx.coroutines.flow.StateFlow<RequestAdmissionState> = state

    override suspend fun admit(registry: ConnectionRegistry?, connection: ConnectionRef): Boolean {
        admitCalls.incrementAndGet()
        if (!claimed.compareAndSet(false, true)) return false
        val admitted = registry?.admitCurrentOwner(connection) {
            validate() && state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.ADMITTED)
        } ?: false
        if (!admitted) state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.REJECTED)
        return admitted
    }
}
