package dev.damhopper.nativeapp.core.transport

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
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
}
