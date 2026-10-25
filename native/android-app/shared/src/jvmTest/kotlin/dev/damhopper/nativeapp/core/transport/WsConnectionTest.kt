package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.readReason
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.test.runTest
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class WsConnectionTest {

    @Test
    fun testBuildWsHandshakeUrl() {
        val httpUrl = "http://10.0.2.2:4801"
        val wsUrl = buildWsHandshakeUrl(httpUrl, "jwt-sample-token-123")
        assertEquals("ws://10.0.2.2:4801/ws?token=jwt-sample-token-123", wsUrl)

        val httpsUrl = "https://dam-hopper.example.com/"
        val wssUrl = buildWsHandshakeUrl(httpsUrl, "token with spaces&symbols")
        assertTrue(wssUrl.startsWith("wss://dam-hopper.example.com/ws?token="))
        assertFalse(wssUrl.contains(" ")) // Pinned: must be URL encoded

        val noAuthUrl = buildWsHandshakeUrl("https://dev.local:4801", null)
        assertEquals("wss://dev.local:4801/ws", noAuthUrl)
    }

    @Test
    fun testBuildWsHandshakeUrlStripsInheritedTokenOnNonLoopbackCleartext() {
        // Base URL already has an inherited token parameter in cleartext non-loopback
        val remoteWithInheritedToken = "http://192.168.1.50:4801/ws?token=leakedSecret"
        val wsUrl = buildWsHandshakeUrl(remoteWithInheritedToken, null)
        assertFalse(wsUrl.contains("token="), "Inherited token parameter must be stripped on non-loopback cleartext")

        // Even if non-null token argument is provided to non-loopback cleartext, no token is attached
        val wsUrlWithArg = buildWsHandshakeUrl(remoteWithInheritedToken, "newToken")
        assertFalse(wsUrlWithArg.contains("token="), "Non-loopback cleartext must not have token parameter")

        // But loopback cleartext permits token
        val loopbackWithInheritedToken = "http://127.0.0.1:4801/ws"
        val loopbackWs = buildWsHandshakeUrl(loopbackWithInheritedToken, "validDevToken")
        assertTrue(loopbackWs.contains("token=validDevToken"))
    }

    @Test
    fun testWsRequestCorrelator() = runTest {
        val correlator = WsRequestCorrelator(maxInFlight = 2)
        val conn = ConnectionRef("test-profile", 1L)
        val socketRef = SocketInstanceRef(conn, "sock-1")
        correlator.bindSocket(socketRef)

        val deferred1 = CompletableDeferred<ServerMsg>()
        val deferred2 = CompletableDeferred<ServerMsg>()

        correlator.register(101UL, deferred1)
        correlator.register(102UL, deferred2)

        // Exceeding max in-flight must throw
        val deferred3 = CompletableDeferred<ServerMsg>()
        assertFailsWith<ConnectionOwnerError> {
            correlator.register(103UL, deferred3)
        }

        // Dispatch response for 101UL
        val response101 = ServerMsg.FsReadResult(
            reqId = 101UL,
            ok = true,
            mime = "text/plain",
            data = "VGhpcyBpcyBhIHRlc3Q=",
        )
        val dispatched = correlator.dispatch(response101)
        assertTrue(dispatched)
        assertEquals(response101, deferred1.await())
        assertFalse(deferred2.isCompleted)

        // Cancel remaining requests (e.g. on socket drop)
        correlator.cancelAll("Socket disconnected")
        assertTrue(deferred2.isCompleted)
        assertFailsWith<ConnectionOwnerError> {
            deferred2.await()
        }
    }

    @Test
    fun testWsRequestCorrelatorUnregisterOnTimeoutFreesCapacity() = runTest {
        val correlator = WsRequestCorrelator(maxInFlight = 1)
        val conn = ConnectionRef("test-profile", 1L)
        correlator.bindSocket(SocketInstanceRef(conn, "sock-timeout"))

        val deferred1 = CompletableDeferred<ServerMsg>()
        correlator.register(999UL, deferred1)

        // Capacity is full (1/1)
        val deferred2 = CompletableDeferred<ServerMsg>()
        assertFailsWith<ConnectionOwnerError> {
            correlator.register(1000UL, deferred2)
        }

        // Request 999UL times out -> unregister
        correlator.unregister(999UL)

        // Now capacity is freed (0/1), new request succeeds
        val deferred3 = CompletableDeferred<ServerMsg>()
        correlator.register(1000UL, deferred3)

        val resp = ServerMsg.FsReadResult(reqId = 1000UL, ok = true)
        assertTrue(correlator.dispatch(resp))
        assertEquals(resp, deferred3.await())
    }

    @Test
    fun testSerializedWsWriterAtomicPairTransmission() = runTest {
        val sentFrames = mutableListOf<Frame>()
        val mockSession = MockWebSocketSession(sentFrames)
        val writer = SerializedWsWriter(mockSession)

        val header = ClientMsg.FsWriteChunkBinary(
            writeId = 55UL,
            seq = 1u,
        )
        val binaryData = byteArrayOf(0x01, 0x02, 0x03, 0x04)

        writer.sendAtomicPair(header, binaryData)

        assertEquals(2, sentFrames.size)
        assertIs<Frame.Text>(sentFrames[0])
        val textFrame = sentFrames[0] as Frame.Text
        val textContent = textFrame.data.decodeToString()
        assertTrue(textContent.contains(""""kind":"fs:write_chunk_binary""""))
        assertTrue(textContent.contains(""""write_id":55"""))

        assertIs<Frame.Binary>(sentFrames[1])
        val binaryFrame = sentFrames[1] as Frame.Binary
        assertEquals(4, binaryFrame.data.size)
        assertEquals(0x01, binaryFrame.data[0])
    }

    @Test
    fun testSerializedWsWriterAbortsOnPartialSendFailure() = runTest {
        val sentFrames = mutableListOf<Frame>()
        val failingOutgoing = Channel<Frame>(Channel.UNLIMITED)
        val failingSession = object : MockWebSocketSession(sentFrames, failingOutgoing) {
            override suspend fun send(frame: Frame) {
                if (frame is Frame.Binary) {
                    throw RuntimeException("Network pipe broken during binary chunk")
                }
                super.send(frame)
            }
        }

        val writer = SerializedWsWriter(failingSession)
        val header = ClientMsg.FsWriteChunkBinary(writeId = 1UL, seq = 0u)

        assertFailsWith<RuntimeException> {
            writer.sendAtomicPair(header, byteArrayOf(0xAA.toByte()))
        }

        // The session must have sent the header, and then close was triggered
        assertEquals(2, sentFrames.size)
        assertIs<Frame.Text>(sentFrames[0])
        val closeFrame = sentFrames[1]
        assertIs<Frame.Close>(closeFrame)
        assertEquals(CloseReason.Codes.PROTOCOL_ERROR.code, closeFrame.readReason()?.code)
    }

    @Test
    fun testTeardownCancelsAllPendingRequestsInCorrelator() = runTest {
        val correlator = WsRequestCorrelator()
        val conn = ConnectionRef("test-prof", 1L)
        correlator.bindSocket(SocketInstanceRef(conn, "s1"))

        val def1 = CompletableDeferred<ServerMsg>()
        val def2 = CompletableDeferred<ServerMsg>()
        correlator.register(1UL, def1)
        correlator.register(2UL, def2)

        // Teardown
        correlator.cancelAll("Explicit session teardown")

        assertTrue(def1.isCompleted)
        assertTrue(def2.isCompleted)

        val err1 = assertFailsWith<ConnectionOwnerError> { def1.await() }
        assertEquals(ConnectionErrorReason.UNAVAILABLE, err1.reason)

        // Verify new request can be registered after teardown cancelled old ones
        val def3 = CompletableDeferred<ServerMsg>()
        correlator.register(3UL, def3)
        val resp = ServerMsg.FsReadResult(reqId = 3UL, ok = true)
        assertTrue(correlator.dispatch(resp))
        assertEquals(resp, def3.await())
    }

    @Test
    fun testSocketInstanceRefFencingRejectsMismatchedSocketEvents() {
        val conn = ConnectionRef("dev-profile", 1L)
        val sock1 = SocketInstanceRef(conn, "sock-1")
        val sock2 = SocketInstanceRef(conn, "sock-2")

        val receipt1 = UiConnectionReceipt(
            socketRef = sock1,
            version = 1,
            connectionId = "c1",
            decisionCapability = "cap1",
        )
        val receipt2 = UiConnectionReceipt(
            socketRef = sock2,
            version = 1,
            connectionId = "c2",
            decisionCapability = "cap2",
        )

        // sock1 key differs from sock2 key
        assertTrue(sock1.key != sock2.key)
        assertTrue(receipt1.socketRef == sock1)
        assertFalse(receipt1.socketRef == sock2)
        assertEquals("sock-1", sock1.socketId)
        assertEquals("sock-2", sock2.socketId)
    }

    @Test
    fun testWsRequestCorrelatorSocketFencing() = runTest {
        val correlator = WsRequestCorrelator()
        val conn = ConnectionRef("test-p", 1L)
        val sock1 = SocketInstanceRef(conn, "sock-1")
        val sock2 = SocketInstanceRef(conn, "sock-2")

        correlator.bindSocket(sock1)
        val deferred = CompletableDeferred<ServerMsg>()
        correlator.register(1001uL, deferred, expectedSocket = sock1)

        // Registering with mismatched socket fails
        assertFailsWith<ConnectionOwnerError> {
            correlator.register(1002uL, CompletableDeferred(), expectedSocket = sock2)
        }

        // Dispatching response with mismatched socket does NOT complete request
        val resp = ServerMsg.FsOpResult(reqId = 1001uL, ok = true)
        val dispatchedWrong = correlator.dispatch(resp, socketRef = sock2)
        assertFalse(dispatchedWrong)
        assertFalse(deferred.isCompleted)

        // Dispatching with matching socket succeeds
        val dispatchedRight = correlator.dispatch(resp, socketRef = sock1)
        assertTrue(dispatchedRight)
        assertTrue(deferred.isCompleted)
    }

    @Test
    fun tryAdmitCurrentSocketAdmitsOnlyTheConnectedSocketAndAlwaysReleasesTheGate() = kotlinx.coroutines.runBlocking {
        RawWebSocketServer().use { server ->
            val connection = ConnectionRef("admit-profile", 1L)
            val ws = WsConnection(connection, "http://127.0.0.1:${server.port}")
            val absent = SocketInstanceRef(connection, "sock-1")
            var ran = 0

            // Not connected: the captured socket is stale and the leaf never runs.
            assertEquals(WsSocketAdmission.STALE, ws.tryAdmitCurrentSocket(absent) { ran++; true })
            assertEquals(0, ran)

            kotlinx.coroutines.withTimeout(15_000) { ws.connect() }
            val socket = assertIs<WsState.Connected>(ws.state.value).socketRef
            assertEquals(WsSocketAdmission.COMMITTED, ws.tryAdmitCurrentSocket(socket) { ran++; true })
            assertEquals(1, ran)

            // Another socket of the same connection is stale; a declined commit is stale too.
            val replaced = SocketInstanceRef(connection, "sock-other")
            assertEquals(WsSocketAdmission.STALE, ws.tryAdmitCurrentSocket(replaced) { ran++; true })
            assertEquals(WsSocketAdmission.STALE, ws.tryAdmitCurrentSocket(socket) { false })
            assertEquals(1, ran)

            // Same-coroutine reentry is BUSY (lifecycleMutex is try-locked only, never waited on).
            var inner: WsSocketAdmission? = null
            val outer = ws.tryAdmitCurrentSocket(socket) {
                inner = ws.tryAdmitCurrentSocket(socket) { true }
                false
            }
            assertEquals(WsSocketAdmission.BUSY, inner)
            assertEquals(WsSocketAdmission.STALE, outer)

            // Released in finally even when the leaf throws.
            assertFailsWith<IllegalStateException> { ws.tryAdmitCurrentSocket(socket) { error("boom") } }
            assertEquals(WsSocketAdmission.COMMITTED, ws.tryAdmitCurrentSocket(socket) { true })

            // After disconnect the old socket is stale.
            kotlinx.coroutines.withTimeout(15_000) { ws.disconnect() }
            assertEquals(WsSocketAdmission.STALE, ws.tryAdmitCurrentSocket(socket) { true })
        }
    }

    /** Minimal loopback RFC 6455 server: completes the upgrade handshake and then only drains client frames. */
    private class RawWebSocketServer : java.io.Closeable {
        private val server = java.net.ServerSocket(0, 50, java.net.InetAddress.getLoopbackAddress())
        private val clients = java.util.concurrent.CopyOnWriteArrayList<java.net.Socket>()
        val port: Int get() = server.localPort

        init {
            Thread {
                try {
                    while (!server.isClosed) {
                        val socket = server.accept()
                        clients += socket
                        Thread { serve(socket) }.apply { isDaemon = true }.start()
                    }
                } catch (_: Exception) {
                    // closed
                }
            }.apply { isDaemon = true }.start()
        }

        private fun serve(socket: java.net.Socket) {
            try {
                val input = socket.getInputStream()
                val header = StringBuilder()
                while (!header.endsWith("\r\n\r\n")) {
                    val b = input.read()
                    if (b < 0) return
                    header.append(b.toChar())
                }
                val key = header.lines()
                    .firstOrNull { it.startsWith("Sec-WebSocket-Key:", ignoreCase = true) }
                    ?.substringAfter(':')?.trim() ?: return
                val digest = java.security.MessageDigest.getInstance("SHA-1")
                    .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.ISO_8859_1))
                val accept = java.util.Base64.getEncoder().encodeToString(digest)
                val out = socket.getOutputStream()
                out.write(
                    ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                        "Sec-WebSocket-Accept: $accept\r\n\r\n").toByteArray(Charsets.ISO_8859_1),
                )
                out.flush()
                val buffer = ByteArray(1024)
                while (input.read(buffer) >= 0) {
                    // drain client frames (close/pings) until the socket closes
                }
            } catch (_: Exception) {
                // peer closed
            }
        }

        override fun close() {
            server.close()
            clients.forEach { runCatching { it.close() } }
        }
    }

    private open class MockWebSocketSession(
        val sent: MutableList<Frame>,
        override val outgoing: Channel<Frame> = Channel(Channel.UNLIMITED),
    ) : WebSocketSession {
        override val coroutineContext: CoroutineContext = EmptyCoroutineContext
        override val incoming: ReceiveChannel<Frame> = Channel()
        override val extensions: List<io.ktor.websocket.WebSocketExtension<*>> = emptyList()
        override var maxFrameSize: Long = 65536
        override var masking: Boolean = false

        override suspend fun send(frame: Frame) {
            sent.add(frame)
        }

        override suspend fun flush() {}
        override fun terminate() {}
    }
}
