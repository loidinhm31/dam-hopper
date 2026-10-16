package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.security.CryptoSession
import dev.damhopper.nativeapp.core.security.CryptoSessionOwnerMismatchException
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class TransferCoordinatorTest {

    private class FakeWsConnection(
        conn: ConnectionRef,
    ) : WsConnection(conn, "http://127.0.0.1:4801") {
        val sentMessages = mutableListOf<ClientMsg>()
        val sentPairs = mutableListOf<Pair<ClientMsg, ByteArray>>()
        val messageFlow = MutableSharedFlow<ServerMsg>(extraBufferCapacity = 64)
        override val incomingMessages: SharedFlow<ServerMsg> get() = messageFlow

        var onRequest: (suspend (ULong, ClientMsg) -> ServerMsg)? = null
        var onSendAtomicPair: (suspend (ClientMsg, ByteArray) -> Unit)? = null
        var onSend: (suspend (ClientMsg) -> Unit)? = null

        override suspend fun request(reqId: ULong, msg: ClientMsg, timeoutMillis: Long): ServerMsg {
            sentMessages.add(msg)
            return onRequest?.invoke(reqId, msg) ?: throw IllegalStateException("No onRequest handler")
        }

        override suspend fun send(msg: ClientMsg) {
            sentMessages.add(msg)
            onSend?.invoke(msg)
        }

        override suspend fun sendAtomicPair(header: ClientMsg, binary: ByteArray) {
            sentPairs.add(Pair(header, binary))
            onSendAtomicPair?.invoke(header, binary)
        }
    }

    @Test
    fun testPlainUploadSuccessMultiChunk() = runTest {
        val owner = ConnectionRef("test-prof", 1L)
        val ws = FakeWsConnection(owner)
        val coordinator = TransferCoordinator(ws, { 100uL }, chunkSize = 100)

        // 250 bytes content -> 3 chunks (100, 100, 50)
        val content = ByteArray(250) { it.toByte() }
        val progressReports = mutableListOf<Pair<Long, Long>>()

        ws.onRequest = { reqId, msg ->
            assertTrue(msg is ClientMsg.FsUploadBegin)
            assertEquals("test-proj", msg.project)
            assertEquals("dir1", msg.dir)
            assertEquals("file.bin", msg.filename)
            assertEquals(250uL, msg.len)
            ServerMsg.FsUploadBeginOk(reqId = reqId, uploadId = msg.uploadId)
        }

        ws.onSendAtomicPair = { header, binary ->
            assertTrue(header is ClientMsg.FsUploadChunk)
            ws.messageFlow.emit(ServerMsg.FsUploadChunkAck(uploadId = header.uploadId, seq = header.seq))
        }

        ws.onSend = { msg ->
            if (msg is ClientMsg.FsUploadCommit) {
                ws.messageFlow.emit(
                    ServerMsg.FsUploadResult(
                        reqId = msg.reqId,
                        uploadId = msg.uploadId,
                        ok = true,
                        newMtime = 1712600000L,
                    )
                )
            }
        }

        val result = coordinator.uploadPlain(
            target = ProjectTargetRef(project = "test-proj"),
            dir = "dir1",
            filename = "file.bin",
            content = content,
            timeoutMillis = 5_000,
            onProgress = { sent, total -> progressReports.add(Pair(sent, total)) }
        )

        assertIs<TransferResult.Success>(result)
        assertEquals(1712600000L, result.newMtime)
        assertEquals(3, ws.sentPairs.size)
        assertEquals(100, ws.sentPairs[0].second.size)
        assertEquals(100, ws.sentPairs[1].second.size)
        assertEquals(50, ws.sentPairs[2].second.size)

        assertTrue(progressReports.isNotEmpty())
        assertEquals(250L, progressReports.last().first)
        assertEquals(250L, progressReports.last().second)
    }

    @Test
    fun testPlainUploadBeginError() = runTest {
        val owner = ConnectionRef("test-prof", 1L)
        val ws = FakeWsConnection(owner)
        val coordinator = TransferCoordinator(ws, { 100uL })

        ws.onRequest = { reqId, _ ->
            ServerMsg.FsError(reqId = reqId, code = "PERMISSION_DENIED", message = "Read-only workspace")
        }

        val result = coordinator.uploadPlain(
            target = ProjectTargetRef(project = "test-proj"),
            dir = "",
            filename = "file.txt",
            content = "test".encodeToByteArray()
        )

        assertIs<TransferResult.Error>(result)
        assertTrue(result.message.contains("PERMISSION_DENIED"))
        assertEquals(0, ws.sentPairs.size, "No chunks should be sent if begin fails")
    }

    @Test
    fun testEncryptedUploadSuccessAndConflict() = runTest {
        val owner = ConnectionRef("test-prof", 1L)
        val ws = FakeWsConnection(owner)
        val coordinator = TransferCoordinator(ws, { 200uL }, chunkSize = 500)
        val key = ByteArray(32) { 7.toByte() }
        val session = CryptoSession("session-enc-42", owner, key)

        val content = "Confidential code and secret keys".encodeToByteArray()

        // 1. Test success path
        ws.onRequest = { reqId, msg ->
            assertTrue(msg is ClientMsg.FsPutBegin)
            assertEquals("session-enc-42", msg.sessionId)
            assertEquals(1712500000L, msg.expectedMtime)
            ServerMsg.FsPutBeginOk(reqId = reqId, uploadId = msg.uploadId)
        }

        ws.onSendAtomicPair = { header, _ ->
            assertTrue(header is ClientMsg.FsPutChunk)
            ws.messageFlow.emit(ServerMsg.FsPutChunkAck(uploadId = header.uploadId, seq = header.seq))
        }

        ws.onSend = { msg ->
            if (msg is ClientMsg.FsPutCommit) {
                ws.messageFlow.emit(
                    ServerMsg.FsPutResult(
                        reqId = msg.reqId,
                        uploadId = msg.uploadId,
                        ok = true,
                        conflict = false,
                        newMtime = 1712500010L,
                    )
                )
            }
        }

        val successResult = coordinator.uploadEncrypted(
            target = ProjectTargetRef(project = "test-proj"),
            dir = "secrets",
            filename = "keys.txt",
            content = content,
            cryptoSession = session,
            expectedMtime = 1712500000L,
        )

        assertIs<TransferResult.Success>(successResult)
        assertEquals(1712500010L, successResult.newMtime)

        // 2. Test conflict path
        ws.onSend = { msg ->
            if (msg is ClientMsg.FsPutCommit) {
                ws.messageFlow.emit(
                    ServerMsg.FsPutResult(
                        reqId = msg.reqId,
                        uploadId = msg.uploadId,
                        ok = false,
                        conflict = true,
                        error = "File modified by another client since upload started",
                    )
                )
            }
        }

        val conflictResult = coordinator.uploadEncrypted(
            target = ProjectTargetRef(project = "test-proj"),
            dir = "secrets",
            filename = "keys.txt",
            content = content,
            cryptoSession = session,
            expectedMtime = 1712500000L,
        )

        assertIs<TransferResult.Conflict>(conflictResult)
        assertTrue(conflictResult.message.contains("File modified"))
    }

    @Test
    fun testEncryptedUploadRejectsMismatchedOwner() = runTest {
        val owner1 = ConnectionRef("prof-a", 1L)
        val owner2 = ConnectionRef("prof-a", 2L)
        val ws = FakeWsConnection(owner1)
        val coordinator = TransferCoordinator(ws, { 300uL })
        val session = CryptoSession("session-1", owner1, ByteArray(32))

        val result = coordinator.uploadEncrypted(
            target = ProjectTargetRef(project = "proj"),
            dir = "",
            filename = "a.txt",
            content = "hello".encodeToByteArray(),
            cryptoSession = session,
            expectedOwner = owner2 // Different generation!
        )
        assertIs<TransferResult.Error>(result)
        assertTrue(result.message.contains("Invalid crypto session") || result.message.contains("Owner mismatch"))
    }

    @Test
    fun testUploadPlainStream() = runTest {
        val owner = ConnectionRef("test-prof", 1L)
        val ws = FakeWsConnection(owner)
        val coordinator = TransferCoordinator(ws, { 400uL }, chunkSize = 10)

        ws.onRequest = { reqId, msg ->
            assertTrue(msg is ClientMsg.FsUploadBegin)
            ServerMsg.FsUploadBeginOk(reqId = reqId, uploadId = msg.uploadId)
        }
        ws.onSendAtomicPair = { header, _ ->
            assertTrue(header is ClientMsg.FsUploadChunk)
            ws.messageFlow.emit(ServerMsg.FsUploadChunkAck(uploadId = header.uploadId, seq = header.seq))
        }
        ws.onSend = { msg ->
            if (msg is ClientMsg.FsUploadCommit) {
                ws.messageFlow.emit(ServerMsg.FsUploadResult(reqId = msg.reqId, uploadId = msg.uploadId, ok = true, newMtime = 999L))
            }
        }

        val result = coordinator.uploadPlainStream(
            target = ProjectTargetRef(project = "proj"),
            dir = "",
            filename = "stream.txt",
            totalBytes = 25L,
            chunkProvider = { emit ->
                emit(ByteArray(10) { 1 })
                emit(ByteArray(10) { 2 })
                emit(ByteArray(5) { 3 })
            }
        )

        assertIs<TransferResult.Success>(result)
        assertEquals(999L, result.newMtime)
        assertEquals(3, ws.sentPairs.size)
    }
}
