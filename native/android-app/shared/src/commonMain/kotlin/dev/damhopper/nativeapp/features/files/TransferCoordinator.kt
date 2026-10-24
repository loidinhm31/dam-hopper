package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.security.CryptoEnvelope
import dev.damhopper.nativeapp.core.security.CryptoSession
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

sealed class TransferResult {
    data class Success(val uploadId: String, val newMtime: Long?) : TransferResult()
    data class Conflict(val uploadId: String, val message: String) : TransferResult()
    data class Error(val uploadId: String, val message: String) : TransferResult()
    data class UnknownOutcome(val uploadId: String, val message: String) : TransferResult()
}

/**
 * Coordinates chunked binary uploads and encrypted transfers over WebSocket using
 * atomic frame pairs (JSON header + binary frame).
 */
class TransferCoordinator(
    private val wsConnection: WsConnection,
    private val nextReqId: () -> ULong,
    private val chunkSize: Int = DEFAULT_CHUNK_SIZE,
) {
    companion object {
        const val DEFAULT_CHUNK_SIZE: Int = 64 * 1024 // 64 KiB
        const val MAX_FILE_SIZE: Long = 100 * 1024 * 1024 // 100 MiB
    }

    /**
     * Uploads plain binary content via chunk stream using fs:upload_begin -> fs:upload_chunk* -> fs:upload_commit.
     */
    suspend fun uploadPlainStream(
        target: ProjectTargetRef,
        dir: String,
        filename: String,
        totalBytes: Long,
        chunkProvider: suspend (onChunk: suspend (chunk: ByteArray) -> Unit) -> Unit,
        timeoutMillis: Long = 60_000,
        expectedOwner: ConnectionRef? = null,
        onProgress: ((bytesSent: Long, totalBytes: Long) -> Unit)? = null,
    ): TransferResult = coroutineScope {
        val uploadId = "up-${nextReqId()}-${kotlinx.datetime.Clock.System.now().toEpochMilliseconds()}"
        if (expectedOwner != null) {
            try {
                wsConnection.registry?.assertCurrentOwner(expectedOwner, "TransferCoordinator.uploadPlainStream")
            } catch (e: Exception) {
                return@coroutineScope TransferResult.Error(uploadId, "Owner mismatch: ${e.message}")
            }
        }
        if (totalBytes > MAX_FILE_SIZE) {
            return@coroutineScope TransferResult.Error(uploadId, "Total bytes $totalBytes exceeds limit of $MAX_FILE_SIZE bytes")
        }

        // 1. Send fs:upload_begin
        val beginReqId = nextReqId()
        val beginMsg = ClientMsg.FsUploadBegin(
            reqId = beginReqId,
            uploadId = uploadId,
            project = target.project,
            worktreePath = target.worktreePath,
            dir = dir,
            filename = filename,
            len = totalBytes.toULong(),
        )

        try {
            val beginResp = wsConnection.request(beginReqId, beginMsg, timeoutMillis)
            when (beginResp) {
                is ServerMsg.FsUploadBeginOk -> {
                    if (beginResp.uploadId != uploadId) {
                        return@coroutineScope TransferResult.Error(uploadId, "Upload ID mismatch on begin")
                    }
                }
                is ServerMsg.FsError -> {
                    return@coroutineScope TransferResult.Error(uploadId, "[${beginResp.code}] ${beginResp.message}")
                }
                else -> {
                    return@coroutineScope TransferResult.Error(uploadId, "Unexpected response to fs:upload_begin")
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            return@coroutineScope TransferResult.Error(uploadId, "Failed to begin upload: ${e.message}")
        }

        // 2. Stream chunks
        var offset = 0L
        var seq = 0uL
        onProgress?.invoke(0L, totalBytes)
        var streamError: String? = null

        try {
            chunkProvider { chunk ->
                if (streamError != null) return@chunkProvider
                val chunkHeader = ClientMsg.FsUploadChunk(uploadId = uploadId, seq = seq)
                val currentSeq = seq
                val ackDeferred = async(start = CoroutineStart.UNDISPATCHED) {
                    wsConnection.incomingMessages
                        .filterIsInstance<ServerMsg.FsUploadChunkAck>()
                        .first { it.uploadId == uploadId && it.seq == currentSeq }
                }

                try {
                    wsConnection.sendAtomicPair(chunkHeader, chunk)
                    withTimeout(timeoutMillis) {
                        ackDeferred.await()
                    }
                } catch (e: CancellationException) {
                    ackDeferred.cancel()
                    throw e
                } catch (e: Throwable) {
                    ackDeferred.cancel()
                    streamError = "Chunk $seq transmission failed: ${e.message}"
                    return@chunkProvider
                }

                offset += chunk.size
                seq++
                onProgress?.invoke(offset, totalBytes)
            }
        } catch (e: CancellationException) {
            throw e
        }

        if (streamError != null) {
            return@coroutineScope TransferResult.Error(uploadId, streamError!!)
        }

        // 3. Commit
        val commitReqId = nextReqId()
        val commitMsg = ClientMsg.FsUploadCommit(reqId = commitReqId, uploadId = uploadId)

        val resultDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.incomingMessages
                .filterIsInstance<ServerMsg.FsUploadResult>()
                .first { it.uploadId == uploadId }
        }

        var commitSent = false
        try {
            wsConnection.send(commitMsg)
            commitSent = true

            val result = withTimeout(timeoutMillis) {
                resultDeferred.await()
            }

            if (result.ok) {
                TransferResult.Success(uploadId, result.newMtime)
            } else {
                TransferResult.Error(uploadId, result.error ?: "Upload commit rejected by server")
            }
        } catch (e: TimeoutCancellationException) {
            resultDeferred.cancel()
            if (commitSent) {
                TransferResult.UnknownOutcome(uploadId, "Commit timed out in-flight; check server state before retrying")
            } else {
                TransferResult.Error(uploadId, "Commit send timed out")
            }
        } catch (e: CancellationException) {
            resultDeferred.cancel()
            throw e
        } catch (e: Throwable) {
            resultDeferred.cancel()
            TransferResult.Error(uploadId, "Upload commit failed: ${e.message}")
        }
    }

    /**
     * Uploads plain binary content in chunks using uploadPlainStream.
     */
    suspend fun uploadPlain(
        target: ProjectTargetRef,
        dir: String,
        filename: String,
        content: ByteArray,
        overwrite: Boolean = true,
        timeoutMillis: Long = 60_000,
        expectedOwner: ConnectionRef? = null,
        onProgress: ((bytesSent: Long, totalBytes: Long) -> Unit)? = null,
    ): TransferResult {
        return uploadPlainStream(
            target = target,
            dir = dir,
            filename = filename,
            totalBytes = content.size.toLong(),
            chunkProvider = { emitChunk ->
                var offset = 0
                while (offset < content.size) {
                    val count = minOf(chunkSize, content.size - offset)
                    emitChunk(content.copyOfRange(offset, offset + count))
                    offset += count
                }
            },
            timeoutMillis = timeoutMillis,
            expectedOwner = expectedOwner,
            onProgress = onProgress,
        )
    }

    /**
     * Uploads an encrypted file using fs:put_begin -> fs:put_chunk* -> fs:put_commit.
     * Content is assembled into an encrypted envelope matching server decrypt_blob.
     */
    suspend fun uploadEncrypted(
        target: ProjectTargetRef,
        dir: String,
        filename: String,
        content: ByteArray,
        cryptoSession: CryptoSession,
        expectedMtime: Long? = null,
        mimeType: String = "application/octet-stream",
        timeoutMillis: Long = 60_000,
        expectedOwner: ConnectionRef? = null,
        onProgress: ((bytesSent: Long, totalBytes: Long) -> Unit)? = null,
    ): TransferResult = coroutineScope {
        val uploadId = "enc-${nextReqId()}-${kotlinx.datetime.Clock.System.now().toEpochMilliseconds()}"
        if (expectedOwner != null) {
            try {
                wsConnection.registry?.assertCurrentOwner(expectedOwner, "TransferCoordinator.uploadEncrypted")
            } catch (e: Exception) {
                return@coroutineScope TransferResult.Error(uploadId, "Owner mismatch: ${e.message}")
            }
        }
        try {
            cryptoSession.assertValid(expectedOwner)
        } catch (e: Exception) {
            return@coroutineScope TransferResult.Error(uploadId, "Invalid crypto session: ${e.message}")
        }

        val metadataJson = CryptoEnvelope.buildFileMetadataJson(
            name = filename,
            size = content.size.toLong(),
            type = mimeType,
        )
        val envelopeBytes = cryptoSession.encrypt(metadataJson, content)
        if (envelopeBytes.size > MAX_FILE_SIZE) {
            return@coroutineScope TransferResult.Error(uploadId, "Encrypted envelope size ${envelopeBytes.size} exceeds maximum limit of $MAX_FILE_SIZE bytes")
        }
        val totalBytes = envelopeBytes.size.toLong()

        // 1. Send fs:put_begin
        val beginReqId = nextReqId()
        val beginMsg = ClientMsg.FsPutBegin(
            reqId = beginReqId,
            uploadId = uploadId,
            sessionId = cryptoSession.sessionId,
            project = target.project,
            worktreePath = target.worktreePath,
            dir = dir,
            filename = filename,
            len = envelopeBytes.size.toULong(),
            expectedMtime = expectedMtime,
        )

        try {
            val beginResp = wsConnection.request(beginReqId, beginMsg, timeoutMillis)
            when (beginResp) {
                is ServerMsg.FsPutBeginOk -> {
                    if (beginResp.uploadId != uploadId) {
                        return@coroutineScope TransferResult.Error(uploadId, "Upload ID mismatch on fs:put_begin")
                    }
                }
                is ServerMsg.FsError -> {
                    return@coroutineScope TransferResult.Error(uploadId, "[${beginResp.code}] ${beginResp.message}")
                }
                else -> {
                    return@coroutineScope TransferResult.Error(uploadId, "Unexpected response to fs:put_begin")
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            return@coroutineScope TransferResult.Error(uploadId, "Failed to begin encrypted put: ${e.message}")
        }

        // 2. Stream encrypted envelope chunks
        var offset = 0
        var seq = 0uL
        onProgress?.invoke(0L, totalBytes)

        while (offset < envelopeBytes.size) {
            val count = minOf(chunkSize, envelopeBytes.size - offset)
            val chunk = envelopeBytes.copyOfRange(offset, offset + count)
            val chunkHeader = ClientMsg.FsPutChunk(uploadId = uploadId, seq = seq)

            val currentSeq = seq
            val ackDeferred = async(start = CoroutineStart.UNDISPATCHED) {
                wsConnection.incomingMessages
                    .filterIsInstance<ServerMsg.FsPutChunkAck>()
                    .first { it.uploadId == uploadId && it.seq == currentSeq }
            }

            try {
                wsConnection.sendAtomicPair(chunkHeader, chunk)
                withTimeout(timeoutMillis) {
                    ackDeferred.await()
                }
            } catch (e: CancellationException) {
                ackDeferred.cancel()
                throw e
            } catch (e: Throwable) {
                ackDeferred.cancel()
                return@coroutineScope TransferResult.Error(uploadId, "Encrypted chunk $seq transmission failed: ${e.message}")
            }

            offset += count
            seq++
            onProgress?.invoke(offset.toLong(), totalBytes)
        }

        // 3. Commit
        val commitReqId = nextReqId()
        val commitMsg = ClientMsg.FsPutCommit(reqId = commitReqId, uploadId = uploadId)

        val resultDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.incomingMessages
                .filterIsInstance<ServerMsg.FsPutResult>()
                .first { it.uploadId == uploadId }
        }

        var commitSent = false
        try {
            wsConnection.send(commitMsg)
            commitSent = true

            val result = withTimeout(timeoutMillis) {
                resultDeferred.await()
            }

            if (result.ok) {
                TransferResult.Success(uploadId, result.newMtime)
            } else if (result.conflict) {
                TransferResult.Conflict(uploadId, result.error ?: "File modified on server (mtime conflict)")
            } else {
                TransferResult.Error(uploadId, result.error ?: "Encrypted put rejected by server")
            }
        } catch (e: TimeoutCancellationException) {
            resultDeferred.cancel()
            if (commitSent) {
                TransferResult.UnknownOutcome(uploadId, "Commit timed out in-flight; check server state before retrying")
            } else {
                TransferResult.Error(uploadId, "Encrypted commit send timed out")
            }
        } catch (e: CancellationException) {
            resultDeferred.cancel()
            throw e
        } catch (e: Throwable) {
            resultDeferred.cancel()
            TransferResult.Error(uploadId, "Encrypted commit failed: ${e.message}")
        }
    }
}
