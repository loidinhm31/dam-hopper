@file:OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)

package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.datetime.Clock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filter
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
    ): ServerMsg.FsWriteResult {
        val outcome = writeFileWithOutcome(
            owner = null,
            target = target,
            path = path,
            content = content,
            expectedMtime = expectedMtime,
            timeoutMillis = timeoutMillis,
            arbiter = null,
            reservationToken = null,
        )
        return when (outcome) {
            is FileOperationOutcome.Confirmed -> outcome.result
            is FileOperationOutcome.Rejected -> throw IllegalStateException("fs:write rejected: [${outcome.code}] ${outcome.message}")
            is FileOperationOutcome.NotSubmitted -> throw IllegalStateException("fs:write not submitted: ${outcome.reason}", outcome.cause)
            is FileOperationOutcome.Unknown -> throw IllegalStateException("fs:write outcome unknown at stage ${outcome.stage}: ${outcome.message}", outcome.cause)
        }
    }

    suspend fun writeFileWithOutcome(
        owner: dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner?,
        target: ProjectTargetRef,
        path: String,
        content: String,
        expectedMtime: Long,
        timeoutMillis: Long = 30_000,
        arbiter: FileOperationArbiter? = null,
        reservationToken: ReservationToken? = null,
    ): FileOperationOutcome<ServerMsg.FsWriteResult> = coroutineScope {
        if (owner != null && !owner.matchesTarget(target)) {
            return@coroutineScope FileOperationOutcome.NotSubmitted("Target $target does not match owner $owner")
        }

        val activeSocket = wsConnection.activeSocketRef()
            ?: return@coroutineScope FileOperationOutcome.NotSubmitted("WebSocket is not connected")

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

        val beginResp = try {
            wsConnection.requestOnSocket(activeSocket, reqId, beginMsg, timeoutMillis)
        } catch (e: CancellationException) {
            return@coroutineScope FileOperationOutcome.NotSubmitted("Cancelled during fs:write_begin", e)
        } catch (t: Throwable) {
            return@coroutineScope FileOperationOutcome.NotSubmitted("fs:write_begin failed: ${t.message}", t)
        }

        val writeId = when (beginResp) {
            is ServerMsg.FsWriteAck -> beginResp.writeId
            is ServerMsg.FsError -> return@coroutineScope FileOperationOutcome.Rejected(
                code = beginResp.code,
                message = beginResp.message
            )
            else -> return@coroutineScope FileOperationOutcome.NotSubmitted("Unexpected response to fs:write_begin: $beginResp")
        }

        val resultDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.socketBoundMessages
                .filter { it.socketRef == activeSocket && it.message is ServerMsg.FsWriteResult && (it.message as ServerMsg.FsWriteResult).writeId == writeId }
                .first()
                .message as ServerMsg.FsWriteResult
        }

        // Send chunk (pre-commit failure is NotSubmitted to final file write)
        try {
            val chunkMsg = ClientMsg.FsWriteChunk(
                writeId = writeId,
                seq = 0u,
                eof = true,
                data = base64Data,
            )
            wsConnection.sendOnSocket(activeSocket, chunkMsg)
        } catch (t: Throwable) {
            resultDeferred.cancel()
            return@coroutineScope FileOperationOutcome.NotSubmitted("Failed sending fs:write_chunk", t)
        }

        // Make cancellation uncertainty durable BEFORE committing
        val quarantinedOp = if (owner != null) {
            QuarantinedOperation(
                owner = owner,
                path = path,
                stage = OperationStage.COMMIT_DISPATCHED,
                opId = writeId.toString(),
                submittedRevision = null,
                baselineRevision = expectedMtime,
                submittedBytes = utf8Bytes,
                timestampMillis = Clock.System.now().toEpochMilliseconds(),
            )
        } else null

        if (arbiter != null && reservationToken != null && quarantinedOp != null) {
            arbiter.quarantineToken(reservationToken, quarantinedOp)
        }

        // Dispatch commit
        val commitMsg = ClientMsg.FsWriteCommit(writeId = writeId)
        try {
            wsConnection.sendOnSocket(activeSocket, commitMsg)
        } catch (t: Throwable) {
            resultDeferred.cancel()
            return@coroutineScope FileOperationOutcome.Unknown(
                stage = OperationStage.COMMIT_DISPATCHED,
                opId = writeId.toString(),
                message = "Failed dispatching fs:write_commit; state unknown: ${t.message}",
                cause = t,
            )
        }
        try {
            val result = withTimeout(timeoutMillis) {
                resultDeferred.await()
            }
            if (!result.ok) {
                if (arbiter != null && reservationToken != null) {
                    arbiter.abandonQuarantine(reservationToken, "Rejected by server")
                }
                val code = if (result.conflict) "CAS_CONFLICT" else "WRITE_REJECTED"
                return@coroutineScope FileOperationOutcome.Rejected(
                    code = code,
                    message = result.error ?: "File write rejected by server",
                    details = "conflict=${result.conflict}",
                )
            }
            // Server confirmed; lift quarantine
            if (arbiter != null && reservationToken != null) {
                arbiter.abandonQuarantine(reservationToken, "Confirmed by server")
            }
            FileOperationOutcome.Confirmed(result)
        } catch (e: CancellationException) {
            resultDeferred.cancel()
            FileOperationOutcome.Unknown(
                stage = OperationStage.AWAITING_RESULT,
                opId = writeId.toString(),
                message = "Cancelled while awaiting fs:write_result",
                cause = e,
            )
        } catch (t: Throwable) {
            resultDeferred.cancel()
            FileOperationOutcome.Unknown(
                stage = OperationStage.AWAITING_RESULT,
                opId = writeId.toString(),
                message = "Timeout or error awaiting fs:write_result: ${t.message}",
                cause = t,
            )
        }
    }
}
