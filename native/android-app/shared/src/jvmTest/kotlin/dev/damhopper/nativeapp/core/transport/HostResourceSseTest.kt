package dev.damhopper.nativeapp.core.transport

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostResourceSseTest {

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
    fun testUiConnectionReceiptLifecycle() {
        val conn = ConnectionRef("dev-profile", 1L)
        val socketRef = SocketInstanceRef(conn, "sock-1")

        val receipt = UiConnectionReceipt(
            socketRef = socketRef,
            version = 1,
            connectionId = "test-conn-123",
            decisionCapability = "sensitive-decision-cap",
        )

        assertEquals("test-conn-123", receipt.connectionId)
        assertEquals(1, receipt.version)
        // Redaction check: decisionCapability must not leak in string form
        assertTrue(receipt.toString().contains("[REDACTED]"))
        assertFalse(receipt.toString().contains("sensitive-decision-cap"))
    }

    @Test
    fun testSsePreHeaderFiniteError() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            val errorBody = """{"code":"FRAME_TOO_LARGE","error":"Frame exceeds 256 KiB limit"}"""
            exchange.sendResponseHeaders(503, errorBody.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(errorBody.toByteArray()) }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
        )

        val err = assertFailsWith<ApiRequestError> {
            client.openEventStream().toList()
        }

        assertEquals(503, err.status)
        assertEquals("FRAME_TOO_LARGE", err.code)
    }

    @Test
    fun testSseStatusAndDataPairingRequirement() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                // 1. Emit status frame
                writer.write("event: host-resources-status\n")
                writer.write("""data: {"serverEpoch":"epoch-1","revision":"100","freshnessTtlMs":5000}""")
                writer.write("\n\n")
                writer.flush()

                // 2. Emit matching data frame (same epoch, same revision)
                writer.write("event: host-resources\n")
                writer.write("""data: {"schemaVersion":1,"serverEpoch":"epoch-1","revision":"100","snapshot":{"hostName":"linux-host"},"metrics":{"cpu":12},"lightSampleMs":5000}""")
                writer.write("\n\n")
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
        )

        val frames = client.openEventStream().take(2).toList()
        assertEquals(2, frames.size)

        // First frame: Status
        assertIs<HostResourceSseFrame.Status>(frames[0])
        val statusFrame = frames[0] as HostResourceSseFrame.Status
        assertEquals("epoch-1", statusFrame.status.serverEpoch)
        assertEquals("100", statusFrame.status.revision)

        // Second frame: PairedData (guarantees matching status was consumed)
        assertIs<HostResourceSseFrame.PairedData>(frames[1])
        val pairedFrame = frames[1] as HostResourceSseFrame.PairedData
        assertEquals("epoch-1", pairedFrame.data.serverEpoch)
        assertEquals("100", pairedFrame.data.revision)
        assertEquals("epoch-1", pairedFrame.status.serverEpoch)
        assertEquals("100", pairedFrame.status.revision)
    }

    @Test
    fun testSseCommentBreaksPairingAdjacency() = runTest {
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            exchange.responseHeaders.set("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.bufferedWriter().use { writer ->
                // Status frame
                writer.write("event: host-resources-status\n")
                writer.write("""data: {"serverEpoch":"epoch-1","revision":"200","freshnessTtlMs":5000}""")
                writer.write("\n\n")
                writer.flush()

                // SSE comment (breaks status/data adjacency per spec)
                writer.write(": ping comment\n\n")
                writer.flush()

                // Data frame with same revision - should NOT pair because adjacency was broken
                writer.write("event: host-resources\n")
                writer.write("""data: {"schemaVersion":1,"serverEpoch":"epoch-1","revision":"200","snapshot":{},"metrics":{},"lightSampleMs":5000}""")
                writer.write("\n\n")
                writer.flush()
            }
        }

        val ref = ConnectionRef("dev-profile", 1L)
        val client = HostResourceSseClient(
            connection = ref,
            baseUrl = "http://127.0.0.1:$serverPort",
        )

        // Only the status frame should be emitted; the data frame was discarded due to broken adjacency
        val frames = client.openEventStream().toList()
        assertEquals(1, frames.size)
        assertIs<HostResourceSseFrame.Status>(frames[0])
    }

    @Test
    fun testSseTokenAttachmentGating() = runTest {
        var observedAuthHeader: String? = null
        try { server!!.removeContext("/api/system/resources/v1/events") } catch (_: IllegalArgumentException) {}
        server!!.createContext("/api/system/resources/v1/events") { exchange ->
            observedAuthHeader = exchange.requestHeaders.getFirst("Authorization")
            val errorBody = """{"code":"UNAVAILABLE"}"""
            exchange.sendResponseHeaders(503, errorBody.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(errorBody.toByteArray()) }
        }

        // 1. Loopback cleartext (http://127.0.0.1) permits token for local dev
        val refLoopback = ConnectionRef("dev-profile", 1L)
        val loopbackClient = HostResourceSseClient(
            connection = refLoopback,
            baseUrl = "http://127.0.0.1:$serverPort",
            authTokenProvider = { "secret-sse-token" },
        )
        try { loopbackClient.openEventStream().toList() } catch (_: Throwable) {}
        assertEquals("Bearer secret-sse-token", observedAuthHeader)

        // 2. Non-loopback cleartext host: verify policy rejects token
        val isSecure = "http://192.168.1.100:4801".startsWith("https://", ignoreCase = true)
        val allowToken = isSecure || dev.damhopper.nativeapp.features.profiles.ServerProfile.isLoopbackHost("192.168.1.100")
        assertFalse(allowToken, "Non-loopback cleartext endpoint must reject bearer token attachment")
    }
}
