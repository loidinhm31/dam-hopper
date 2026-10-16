@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Handles the 3-step WebSocket write protocol:
 * 1. fs:write_begin (with CAS expected_mtime) -> fs:write_ack
 * 2. fs:write_chunk (base64 data)
 * 3. fs:write_commit -> fs:write_result
 */
class FsWriteCoordinator(
    private val wsConnection: WsConnection,
    private val nextReqId: () -> ULong,
) {
    suspend fun writeFile(
        target: ProjectTargetRef,
        path: String,
        content: String,
        expectedMtime: Long,
        timeoutMillis: Long = 30_000,
    ): ServerMsg.FsWriteResult = coroutineScope {
        val reqId = nextReqId()
        val utf8Bytes = content.encodeToByteArray()
        val base64Data = Base64.encode(utf8Bytes)

        val beginMsg = ClientMsg.FsWriteBegin(
            reqId = reqId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
            expectedMtime = expectedMtime,
            size = utf8Bytes.size.toULong(),
            encoding = "base64",
        )

        val beginResp = wsConnection.request(reqId, beginMsg, timeoutMillis)
        val writeId = when (beginResp) {
            is ServerMsg.FsWriteAck -> beginResp.writeId
            is ServerMsg.FsError -> throw IllegalStateException("fs:write_begin failed: [${beginResp.code}] ${beginResp.message}")
            else -> throw IllegalStateException("Unexpected response to fs:write_begin")
        }

        val resultDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.incomingMessages
                .filterIsInstance<ServerMsg.FsWriteResult>()
                .first { it.writeId == writeId }
        }

        try {
            val chunkMsg = ClientMsg.FsWriteChunk(
                writeId = writeId,
                seq = 0u,
                eof = true,
                data = base64Data,
            )
            wsConnection.send(chunkMsg)

            val commitMsg = ClientMsg.FsWriteCommit(writeId = writeId)
            wsConnection.send(commitMsg)

            withTimeout(timeoutMillis) {
                resultDeferred.await()
            }
        } catch (e: CancellationException) {
            resultDeferred.cancel()
            throw e
        } catch (e: Throwable) {
            resultDeferred.cancel()
            throw e
        }
    }
}
