package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.security.CryptoSession
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.TransferCoordinator
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class EncryptedSaveCoordinatorTest {

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
    fun testEncryptedSaveSuccessWithConflictAwareCoordinator() = runTest {
        val owner = ConnectionRef("prof-1", 1L)
        val ws = FakeWsConnection(owner)
        val transferCoordinator = TransferCoordinator(ws, { 101uL })
        val saveCoordinator = EncryptedSaveCoordinator(ws, transferCoordinator, { 101uL })
        val session = CryptoSession("session-100", owner, ByteArray(32) { 1.toByte() })

        ws.onRequest = { reqId, msg ->
            assertTrue(msg is ClientMsg.FsPutBegin)
            assertEquals("src/features", msg.dir)
            assertEquals("Editor.kt", msg.filename)
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
                        newMtime = 1712500050L,
                    )
                )
            }
        }

        val result = saveCoordinator.saveEncrypted(
            target = ProjectTargetRef(project = "test-proj"),
            path = "src/features/Editor.kt",
            content = "class EditorState",
            expectedMtime = 1712500000L,
            cryptoSession = session,
        )

        assertIs<EditorSaveResult.Success>(result)
        assertEquals(1712500050L, result.newMtime)
    }

    @Test
    fun testEncryptedForceOverwriteSingleBlob() = runTest {
        val owner = ConnectionRef("prof-1", 1L)
        val ws = FakeWsConnection(owner)
        val transferCoordinator = TransferCoordinator(ws, { 201uL })
        val saveCoordinator = EncryptedSaveCoordinator(ws, transferCoordinator, { 201uL })
        val session = CryptoSession("session-force", owner, ByteArray(32) { 2.toByte() })

        ws.onSendAtomicPair = { header, binary ->
            assertTrue(header is ClientMsg.FsPutSave)
            assertEquals("session-force", header.sessionId)
            assertEquals("README.md", header.path)
            assertTrue(binary.size > 28, "Binary frame must contain full encrypted envelope")
            ws.messageFlow.emit(
                ServerMsg.FsPutSaveResult(
                    reqId = header.reqId,
                    ok = true,
                    newMtime = 1712600000L,
                )
            )
        }

        val result = saveCoordinator.forceOverwriteEncrypted(
            target = ProjectTargetRef(project = "test-proj"),
            path = "README.md",
            content = "# Secret Documentation",
            cryptoSession = session,
        )

        assertIs<EditorSaveResult.Success>(result)
        assertEquals(1712600000L, result.newMtime)
    }

    @Test
    fun testEditorRepositoryEncryptedSaveIntegrationFailsWithoutPlaintextDowngrade() = runTest {
        val owner = ConnectionRef("prof-1", 1L)
        val ws = FakeWsConnection(owner)
        val apiClient = ApiClient(owner, "http://127.0.0.1:4801", { null })
        val fileRepo = FileRepository(apiClient, ws)

        // 1. Without session -> must fail closed with error, never downgrading to plaintext
        val repoNoSession = EditorRepository(
            fileRepository = fileRepo,
            cryptoSessionProvider = { null }
        )

        val failResult = repoNoSession.saveFile(
            target = ProjectTargetRef(project = "proj"),
            path = "keys.txt",
            submittedContent = "secret",
            expectedMtime = 100L,
            encryptedRequested = true,
        )

        assertIs<EditorSaveResult.Error>(failResult)
        assertTrue(failResult.message.contains("Phase 11 owner-bound crypto session"))

        // 2. With valid session -> delegates to encrypted save
        val session = CryptoSession("active-sess", owner, ByteArray(32) { 9.toByte() })
        val repoWithSession = EditorRepository(
            fileRepository = fileRepo,
            cryptoSessionProvider = { session }
        )

        ws.onRequest = { reqId, msg ->
            assertTrue(msg is ClientMsg.FsPutBegin)
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
                        newMtime = 12345L,
                    )
                )
            }
        }

        val successResult = repoWithSession.saveFile(
            target = ProjectTargetRef(project = "proj"),
            path = "keys.txt",
            submittedContent = "secret",
            expectedMtime = 100L,
            encryptedRequested = true,
        )

        assertIs<EditorSaveResult.Success>(successResult)
        assertEquals(12345L, successResult.newMtime)
    }
}
