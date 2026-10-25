package dev.damhopper.nativeapp.core.transport

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ApiClientTest {

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

    @Test
    fun testUrlRedaction() {
        val sensitiveUrl = "https://admin:superSecret123@127.0.0.1:4801/api/terminals?token=jwt.eyJhbGci.secret&active=true"
        val redacted = redactUrl(sensitiveUrl)

        assertFalse(redacted.contains("superSecret123"))
        assertFalse(redacted.contains("jwt.eyJhbGci.secret"))
        assertTrue(redacted.contains("token=[REDACTED]"))
        assertTrue(redacted.contains("admin:[REDACTED]@"))

        // Also test wss:// URL password redaction
        val wssUrl = "wss://operator:secretWsPass@10.0.2.2:4801/ws?token=ws-jwt-secret"
        val redactedWs = redactUrl(wssUrl)
        assertFalse(redactedWs.contains("secretWsPass"))
        assertFalse(redactedWs.contains("ws-jwt-secret"))
        assertTrue(redactedWs.contains("operator:[REDACTED]@"))
    }

    @Test
    fun testSuccessfulGetAndAuthorizationHeader() = runTest {
        var observedAuthHeader: String? = null

        server!!.createContext("/api/health") { exchange ->
            observedAuthHeader = exchange.requestHeaders.getFirst("Authorization")
            val resp = """{"status":"ok","version":"0.13.2"}"""
            exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(resp.toByteArray()) }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = ApiClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "my-test-bearer-token" },
        )

        val health = client.health()
        assertEquals("ok", health.status)
        assertEquals("0.13.2", health.version)
        assertEquals("Bearer my-test-bearer-token", observedAuthHeader)
    }

    @Test
    fun testServerErrorAndRetryAfterParsing() = runTest {
        server!!.createContext("/api/busy") { exchange ->
            exchange.responseHeaders.set("Retry-After", "120")
            val errorJson = """{"code":"SYSTEM_BUSY","error":"Server CPU overloaded"}"""
            exchange.sendResponseHeaders(503, errorJson.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(errorJson.toByteArray()) }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = ApiClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
        )

        val err = assertFailsWith<ApiRequestError> {
            client.get("/api/busy")
        }

        assertEquals(503, err.status)
        assertEquals("SYSTEM_BUSY", err.code)
        assertEquals("Server CPU overloaded", err.message)
        assertEquals(120L, err.retryAfterSeconds)
    }

    @Test
    fun testStaleCompletionRejection() = kotlinx.coroutines.runBlocking {
        kotlinx.coroutines.supervisorScope {
            val registry = ConnectionRegistry()
            val ref = registry.getOrCreateConnection("profile-stale")

            val serverHandlingLatch = java.util.concurrent.CountDownLatch(1)
            val testCanFinishLatch = java.util.concurrent.CountDownLatch(1)

            server!!.createContext("/api/slow") { exchange ->
                serverHandlingLatch.countDown()
                testCanFinishLatch.await(5, java.util.concurrent.TimeUnit.SECONDS)

                val resp = """{"status":"completed"}"""
                exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
                exchange.responseBody.use { it.write(resp.toByteArray()) }
            }

            val client = ApiClient(
                connection = ref,
                baseUrl = "http://127.0.0.1:$serverPort",
                registry = registry,
            )

            val deferredResult = async(kotlinx.coroutines.Dispatchers.IO) {
                client.get("/api/slow")
            }

            try {
                assertTrue(serverHandlingLatch.await(5, java.util.concurrent.TimeUnit.SECONDS))
                registry.retireConnection(ref)
            } finally {
                testCanFinishLatch.countDown()
            }

            val err = assertFailsWith<ConnectionOwnerError> {
                deferredResult.await()
            }
            assertEquals(ConnectionErrorReason.STALE, err.reason)
        }
    }
    @Test
    fun testCleartextNonLoopbackBlocksBearerToken() = kotlinx.coroutines.test.runTest {
        var observedAuthHeader: String? = null

        server!!.createContext("/api/check-auth") { exchange ->
            observedAuthHeader = exchange.requestHeaders.getFirst("Authorization")
            val resp = """{"status":"ok"}"""
            exchange.sendResponseHeaders(200, resp.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(resp.toByteArray()) }
        }

        // 1. Loopback cleartext (http://127.0.0.1) permits token for local dev
        val refLoopback = ConnectionRef("dev-profile", 1L)
        val loopbackClient = ApiClient(
            connection = refLoopback,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "secret-loopback-token" },
        )
        loopbackClient.get("/api/check-auth")
        assertEquals("Bearer secret-loopback-token", observedAuthHeader)

        // 2. Non-loopback cleartext (ws handshake) blocks token
        val remoteWs = buildWsHandshakeUrl("http://192.168.1.100:4801", "my-secret-token")
        assertFalse(remoteWs.contains("token="), "Non-loopback cleartext WebSocket must not attach token")

        // 3. Loopback cleartext (ws handshake) permits token
        val loopbackWs = buildWsHandshakeUrl("http://127.0.0.1:4801", "my-secret-token")
        assertTrue(loopbackWs.contains("token="), "Loopback cleartext WebSocket permits token")

        // 4. Secure HTTPS WebSocket always permits token
        val secureWs = buildWsHandshakeUrl("https://dam-hopper.example.com", "my-secret-token")
        assertTrue(secureWs.contains("token="), "Secure WSS permits token")

        // 5. Direct evaluation of shouldAttachBearerToken across schemas and hosts
        assertTrue(loopbackClient.shouldAttachBearerToken("tok", "https://api.example.com/api/test"))
        assertTrue(loopbackClient.shouldAttachBearerToken("tok", "http://127.0.0.1:4801/api/test"))
        assertTrue(loopbackClient.shouldAttachBearerToken("tok", "http://localhost:4801/api/test"))
        assertTrue(loopbackClient.shouldAttachBearerToken("tok", "http://10.0.2.2:4801/api/test"))
        assertTrue(loopbackClient.shouldAttachBearerToken("tok", "http://[::1]:4801/api/test"))
        assertFalse(loopbackClient.shouldAttachBearerToken("tok", "http://192.168.1.50:4801/api/test"))
        assertFalse(loopbackClient.shouldAttachBearerToken("tok", "http://api.remote.com:4801/api/test"))
        assertFalse(loopbackClient.shouldAttachBearerToken(null, "https://api.example.com/api/test"))
        assertFalse(loopbackClient.shouldAttachBearerToken("", "https://api.example.com/api/test"))
    }

    @Test
    fun testGetBytesBoundedEnforcesLimitAndSucceedsWithinBound() = runTest {
        server!!.createContext("/api/small-file") { exchange ->
            val data = "Small content within limit".encodeToByteArray()
            exchange.sendResponseHeaders(200, data.size.toLong())
            exchange.responseBody.use { it.write(data) }
        }

        server!!.createContext("/api/large-file") { exchange ->
            val data = ByteArray(20_000) { 0x41 }
            exchange.sendResponseHeaders(200, data.size.toLong())
            exchange.responseBody.use { it.write(data) }
        }

        val conn = ConnectionRef("test-p", 1L)
        val client = ApiClient(conn, "http://127.0.0.1:$serverPort")

        // 1. Success within limit
        val bytes = client.getBytesBounded("/api/small-file", maxBytes = 1024L)
        assertEquals("Small content within limit", bytes.decodeToString())

        // 2. Failure when exceeding maxBytes
        assertFailsWith<IllegalStateException> {
            client.getBytesBounded("/api/large-file", maxBytes = 1000L)
        }
    }

    // ---- C2a request-local admission ----

    private fun serve(path: String, status: Int = 200, body: String = """{"ok":true}"""): AtomicInteger {
        val requests = AtomicInteger(0)
        server!!.createContext(path) { exchange ->
            requests.incrementAndGet()
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        return requests
    }

    private fun baseUrl() = "http://127.0.0.1:$serverPort"

    private suspend fun <T> awaitBounded(deferred: Deferred<T>): T = withTimeout(10_000) { deferred.await() }

    @Test
    fun suspendedCredentialsThenRetireSendsNothingUnguarded() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<String?>()
        val client = ApiClient(ref, baseUrl(), { entered.complete(Unit); release.await() }, registry)

        val call = async(Dispatchers.IO) { runCatching { client.get("/api/x") } }
        withTimeout(10_000) { entered.await() }
        registry.retireConnection(ref)
        release.complete("token")

        val failure = awaitBounded(call).exceptionOrNull()
        assertTrue(failure is ConnectionOwnerError, "unguarded final admission must reject: $failure")
        assertEquals(ConnectionErrorReason.STALE, (failure as ConnectionOwnerError).reason)
        assertEquals(0, requests.get())
    }

    @Test
    fun suspendedCredentialsThenRetireOrAbaIsNotSubmittedWithZeroOutbound() = runBlocking {
        val requests = serve("/api/x")
        for (scenario in listOf("retire", "aba")) {
            val registry = ConnectionRegistry()
            val ref = registry.getOrCreateConnection("p")
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<String?>()
            val client = ApiClient(ref, baseUrl(), { entered.complete(Unit); release.await() }, registry)
            val guard = TestAdmissionGuard()

            val call = async(Dispatchers.IO) { runCatching { client.postJson("/api/x", "{}", guard) } }
            withTimeout(10_000) { entered.await() }
            if (scenario == "retire") {
                registry.retireConnection(ref)
            } else {
                // A -> B -> A': same profile, but a numerically distinct later owner
                registry.retireConnection(ref)
                registry.removeProfile("p")
                assertEquals(3L, registry.getOrCreateConnection("p").generation)
            }
            release.complete("token")

            val failure = awaitBounded(call).exceptionOrNull()
            assertTrue(failure is RequestNotSubmittedError, "$scenario must be NotSubmitted: $failure")
            assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
            assertEquals(1, guard.admitCalls.get())
        }
        assertEquals(0, requests.get())
    }

    @Test
    fun suspendedValidatorThenRetireIsRejectedAtAdmission() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val validatorEntered = CompletableDeferred<Unit>()
        val validatorRelease = CompletableDeferred<Unit>()
        val guard = TestAdmissionGuard(beforeAdmit = {
            validatorEntered.complete(Unit)
            validatorRelease.await()
        })
        val client = ApiClient(ref, baseUrl(), registry = registry)

        val call = async(Dispatchers.IO) { runCatching { client.putJson("/api/x", "{}", guard) } }
        withTimeout(10_000) { validatorEntered.await() }
        registry.retireConnection(ref)
        validatorRelease.complete(Unit)

        assertTrue(awaitBounded(call).exceptionOrNull() is RequestNotSubmittedError)
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
        assertEquals(0, requests.get())
    }

    @Test
    fun staleClientFailsBeforeGuardIsConsumed() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val staleClient = ApiClient(ref, baseUrl(), registry = registry)
        val successor = registry.retireConnection(ref) // identity replacement
        val guard = TestAdmissionGuard()

        val error = assertFailsWith<ConnectionOwnerError> { staleClient.patchJson("/api/x", "{}", guard) }
        assertEquals(ConnectionErrorReason.STALE, error.reason)
        assertEquals(RequestAdmissionState.PENDING, guard.admission.value)
        assertEquals(0, guard.admitCalls.get())
        assertEquals(0, requests.get())

        // The replacement owner's client with a fresh guard executes normally.
        val freshGuard = TestAdmissionGuard()
        ApiClient(successor, baseUrl(), registry = registry).patchJson("/api/x", "{}", freshGuard)
        assertEquals(RequestAdmissionState.ADMITTED, freshGuard.admission.value)
        assertEquals(1, requests.get())
    }

    @Test
    fun guardIsSingleUseAndReuseIsNotSubmittedWithoutAlteringReceipt() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)
        val guard = TestAdmissionGuard()

        assertEquals("""{"ok":true}""", client.postJson("/api/x", "{}", guard))
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
        assertEquals(1, requests.get())

        assertFailsWith<RequestNotSubmittedError> { client.postJson("/api/x", "{}", guard) }
        assertFailsWith<RequestNotSubmittedError> { client.delete("/api/x", guard = guard) }
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value) // prior receipt unchanged
        assertEquals(1, requests.get())
    }

    @Test
    fun concurrentInvocationsSharingOneGuardExecuteOnce() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)
        val guard = TestAdmissionGuard()

        val calls = List(4) { async(Dispatchers.IO) { runCatching { client.putJson("/api/x", "{}", guard) } } }
        val results = calls.map { awaitBounded(it) }

        assertEquals(1, results.count { it.isSuccess })
        assertEquals(3, results.count { it.exceptionOrNull() is RequestNotSubmittedError })
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
        assertEquals(1, requests.get())
    }

    @Test
    fun separateAndSimultaneousGuardsAdmitIndependently() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)
        val guards = List(3) { TestAdmissionGuard() }

        guards.map { guard -> async(Dispatchers.IO) { client.postToml("/api/x", "a = 1", guard) } }
            .forEach { awaitBounded(it) }

        assertTrue(guards.all { it.admission.value == RequestAdmissionState.ADMITTED })
        assertEquals(3, requests.get())
    }

    @Test
    fun contendedOperationGateRejectsWithoutRetry() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)
        val gate = Mutex()
        val guard = TestAdmissionGuard(operationGate = gate)

        gate.lock()
        try {
            assertFailsWith<RequestNotSubmittedError> { client.deleteJson("/api/x", "{}", guard) }
        } finally {
            gate.unlock()
        }
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
        assertEquals(1, guard.admitCalls.get()) // no retry inside the client
        // A rejected guard is terminal even after the contention ends.
        assertFailsWith<RequestNotSubmittedError> { client.deleteJson("/api/x", "{}", guard) }
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
        assertEquals(0, requests.get())
    }

    @Test
    fun nullRegistryFailsClosedForGuardedRequests() = runBlocking {
        val requests = serve("/api/x")
        val client = ApiClient(ConnectionRef("p", 1L), baseUrl())
        val guard = TestAdmissionGuard()

        assertFailsWith<RequestNotSubmittedError> { client.get("/api/x", guard = guard) }
        assertEquals(RequestAdmissionState.REJECTED, guard.admission.value)
        assertEquals(0, requests.get())
    }

    @Test
    fun cancellationBeforeAdmissionLeavesGuardPendingWithZeroOutbound() = runBlocking {
        val requests = serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<String?>()
        val client = ApiClient(ref, baseUrl(), { entered.complete(Unit); release.await() }, registry)
        val guard = TestAdmissionGuard()

        var caught: Throwable? = null
        val job = launch(Dispatchers.IO) {
            try {
                client.postJson("/api/x", "{}", guard)
            } catch (e: Throwable) {
                caught = e
                throw e
            }
        }
        withTimeout(10_000) { entered.await() }
        job.cancelAndJoin()

        assertTrue(caught is CancellationException, "pre-admission cancellation must propagate: $caught")
        assertEquals(RequestAdmissionState.PENDING, guard.admission.value)
        assertEquals(0, guard.admitCalls.get())
        assertEquals(0, requests.get())
    }

    @Test
    fun cancellationImmediatelyAfterOwnAdmissionPropagatesAndReceiptIsAdmitted() = runBlocking {
        serve("/api/x")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)
        var callerJob: Job? = null
        val guard = TestAdmissionGuard(onAdmitted = { callerJob?.cancel() })

        var caught: Throwable? = null
        val job = launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                client.postJson("/api/x", "{}", guard)
            } catch (e: Throwable) {
                caught = e
                throw e
            }
        }
        callerJob = job
        job.start()
        job.join()

        // Own admission is a receipt of permission, not proof of dispatch: the outcome is Unknown to
        // the caller (cancellation), never NotSubmitted and never a success.
        assertTrue(caught is CancellationException, "post-admission cancellation must propagate: $caught")
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
    }

    @Test
    fun oneAttemptOnServerAuthErrorWithoutReplay() = runBlocking {
        val requests = serve("/api/denied", status = 401, body = """{"code":"AUTH_REQUIRED","error":"login"}""")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        var tokenReads = 0
        val client = ApiClient(ref, baseUrl(), { tokenReads++; "stale-token" }, registry)
        val guard = TestAdmissionGuard()

        val error = assertFailsWith<ApiRequestError> { client.postJson("/api/denied", "{}", guard) }
        assertEquals(401, error.status)
        assertEquals(1, requests.get()) // no auth-refresh replay, no retry
        assertEquals(1, tokenReads)
        assertEquals(RequestAdmissionState.ADMITTED, guard.admission.value)
    }

    @Test
    fun everyMutationVerbExecutesExactlyOncePerGuard() = runBlocking {
        val methods = java.util.Collections.synchronizedList(mutableListOf<String>())
        server!!.createContext("/api/verb") { exchange ->
            methods += exchange.requestMethod
            exchange.requestBody.readBytes()
            val bytes = "{}".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        val registry = ConnectionRegistry()
        val client = ApiClient(registry.getOrCreateConnection("p"), baseUrl(), registry = registry)

        client.postJson("/api/verb", "{}", TestAdmissionGuard())
        client.postToml("/api/verb", "a = 1", TestAdmissionGuard())
        client.putJson("/api/verb", "{}", TestAdmissionGuard())
        client.patchJson("/api/verb", "{}", TestAdmissionGuard())
        client.delete("/api/verb", guard = TestAdmissionGuard())
        client.deleteJson("/api/verb", "{}", TestAdmissionGuard())
        client.get("/api/verb", guard = TestAdmissionGuard())

        assertEquals(listOf("POST", "POST", "PUT", "PATCH", "DELETE", "DELETE", "GET"), methods.toList())
    }

    @Test
    fun getBytesBoundedHonorsGuardBeforeExecute() = runBlocking {
        val requests = serve("/api/blob", body = "payload")
        val registry = ConnectionRegistry()
        val ref = registry.getOrCreateConnection("p")
        val client = ApiClient(ref, baseUrl(), registry = registry)

        val admitted = TestAdmissionGuard()
        assertEquals("payload", client.getBytesBounded("/api/blob", guard = admitted).decodeToString())
        assertEquals(RequestAdmissionState.ADMITTED, admitted.admission.value)
        assertEquals(1, requests.get())
        assertFailsWith<RequestNotSubmittedError> { client.getBytesBounded("/api/blob", guard = admitted) }
        assertEquals(1, requests.get())

        val rejected = TestAdmissionGuard(operationGate = Mutex(locked = true))
        assertFailsWith<RequestNotSubmittedError> { client.getBytesBounded("/api/blob", guard = rejected) }
        assertEquals(RequestAdmissionState.REJECTED, rejected.admission.value)
        assertEquals(1, requests.get())
    }
}

/**
 * Test guard mirroring the contract: request-local, thread-safe, terminal after rejection/admission.
 * Admission is decided inside `registry.admitCurrentOwner`; reuse of an ADMITTED guard is a false
 * result that never alters the prior receipt. [beforeAdmit] models a suspending validator/resolver,
 * [operationGate] models the Settings operation mutex (tryLock only), [onAdmitted] runs right after
 * this guard's own successful admission.
 */
private class TestAdmissionGuard(
    private val beforeAdmit: suspend () -> Unit = {},
    private val operationGate: Mutex? = null,
    private val onAdmitted: () -> Unit = {},
) : RequestAdmissionGuard {
    private val state = MutableStateFlow(RequestAdmissionState.PENDING)
    override val admission: StateFlow<RequestAdmissionState> = state.asStateFlow()
    val admitCalls = AtomicInteger(0)

    override suspend fun admit(registry: ConnectionRegistry?, connection: ConnectionRef): Boolean {
        admitCalls.incrementAndGet()
        if (registry == null) {
            state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.REJECTED)
            return false
        }
        beforeAdmit()
        val admitted = registry.admitCurrentOwner(connection) {
            if (operationGate != null && !operationGate.tryLock()) {
                false
            } else {
                try {
                    state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.ADMITTED)
                } finally {
                    operationGate?.unlock()
                }
            }
        }
        if (admitted) onAdmitted() else state.compareAndSet(RequestAdmissionState.PENDING, RequestAdmissionState.REJECTED)
        return admitted
    }
}

