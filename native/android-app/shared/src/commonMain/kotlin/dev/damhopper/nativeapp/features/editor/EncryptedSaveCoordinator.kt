package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.security.CryptoEnvelope
import dev.damhopper.nativeapp.core.security.CryptoSession
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.files.TransferCoordinator
import dev.damhopper.nativeapp.features.files.TransferResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

/**
 * Handles encrypted saves and force-overwrites for editor tabs without plaintext fallback.
 * Uses TransferCoordinator with expectedMtime for conflict-aware saves,
 * and fs:put_save atomic frame pairs for explicit single-blob force overwrites.
 */
class EncryptedSaveCoordinator(
    private val wsConnection: WsConnection,
    private val transferCoordinator: TransferCoordinator,
    private val nextReqId: () -> ULong,
) {
    /**
     * Saves text content with AES-256-GCM encryption and expected_mtime conflict protection.
     */
    suspend fun saveEncrypted(
        target: ProjectTargetRef,
        path: String,
        content: String,
        expectedMtime: Long,
        cryptoSession: CryptoSession,
        expectedOwner: ConnectionRef? = null,
        timeoutMillis: Long = 30_000,
    ): EditorSaveResult {
        try {
            cryptoSession.assertValid(expectedOwner)
        } catch (e: Exception) {
            return EditorSaveResult.Error("Encrypted save rejected: ${e.message}")
        }

        val normalized = path.trim().replace('\\', '/')
        val lastSlash = normalized.lastIndexOf('/')
        val dir = if (lastSlash >= 0) normalized.substring(0, lastSlash) else ""
        val filename = if (lastSlash >= 0) normalized.substring(lastSlash + 1) else normalized

        val contentBytes = content.encodeToByteArray()
        val result = transferCoordinator.uploadEncrypted(
            target = target,
            dir = dir,
            filename = filename,
            content = contentBytes,
            cryptoSession = cryptoSession,
            expectedMtime = expectedMtime,
            mimeType = "text/plain; charset=utf-8",
            timeoutMillis = timeoutMillis,
            expectedOwner = expectedOwner,
        )

        return when (result) {
            is TransferResult.Success -> {
                EditorSaveResult.Success(result.newMtime ?: expectedMtime)
            }
            is TransferResult.Conflict -> {
                EditorSaveResult.Conflict(serverMtime = null, message = result.message)
            }
            is TransferResult.UnknownOutcome -> {
                EditorSaveResult.UnknownOutcome(result.message)
            }
            is TransferResult.Error -> {
                EditorSaveResult.Error(result.message)
            }
        }
    }

    /**
     * Performs an explicit single-blob force overwrite via fs:put_save + binary frame atomic pair.
     */
    suspend fun forceOverwriteEncrypted(
        target: ProjectTargetRef,
        path: String,
        content: String,
        cryptoSession: CryptoSession,
        expectedOwner: ConnectionRef? = null,
        timeoutMillis: Long = 30_000,
    ): EditorSaveResult = coroutineScope {
        try {
            cryptoSession.assertValid(expectedOwner)
        } catch (e: Exception) {
            return@coroutineScope EditorSaveResult.Error("Encrypted overwrite rejected: ${e.message}")
        }

        val contentBytes = content.encodeToByteArray()
        val metadataJson = CryptoEnvelope.buildTextMetadataJson(
            path = path,
            size = contentBytes.size.toLong(),
        )
        val envelopeBytes = cryptoSession.encrypt(metadataJson, contentBytes)

        val reqId = nextReqId()
        val putSaveHeader = ClientMsg.FsPutSave(
            reqId = reqId,
            sessionId = cryptoSession.sessionId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
        )

        val resultDeferred = async(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.incomingMessages
                .filterIsInstance<ServerMsg.FsPutSaveResult>()
                .first { it.reqId == reqId }
        }

        var headerSent = false
        try {
            wsConnection.sendAtomicPair(putSaveHeader, envelopeBytes)
            headerSent = true

            val result = withTimeout(timeoutMillis) {
                resultDeferred.await()
            }

            if (result.ok) {
                EditorSaveResult.Success(result.newMtime ?: 0L)
            } else {
                EditorSaveResult.Error(result.error ?: "Encrypted force overwrite rejected by server")
            }
        } catch (e: TimeoutCancellationException) {
            resultDeferred.cancel()
            if (headerSent) {
                EditorSaveResult.UnknownOutcome("Encrypted force overwrite timed out after send; check server state before retrying")
            } else {
                EditorSaveResult.Error("Encrypted overwrite send timed out")
            }
        } catch (e: CancellationException) {
            resultDeferred.cancel()
            throw e
        } catch (e: Throwable) {
            resultDeferred.cancel()
            EditorSaveResult.Error("Encrypted force overwrite failed: ${e.message}")
        }
    }
}
