package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Extracts req_id from any ServerMsg that carries request correlation.
 */
fun ServerMsg.extractReqId(): ULong? = when (this) {
    is ServerMsg.TreeSnapshot -> reqId
    is ServerMsg.FsError -> reqId
    is ServerMsg.FsReadResult -> reqId
    is ServerMsg.FsWriteAck -> reqId
    is ServerMsg.FsOpResult -> reqId
    is ServerMsg.FsUploadBeginOk -> reqId
    is ServerMsg.FsUploadResult -> reqId
    is ServerMsg.AuthRegisterStartResponse -> reqId
    is ServerMsg.AuthRegisterFinishResponse -> reqId
    is ServerMsg.AuthLoginStartResponse -> reqId
    is ServerMsg.AuthLoginFinishResponse -> reqId
    is ServerMsg.FsPutBeginOk -> reqId
    is ServerMsg.FsPutResult -> reqId
    is ServerMsg.FsPutSaveResult -> reqId
    else -> null
}

/**
 * Bounded request-response correlator for WebSocket operations.
 * Bound to an exact SocketInstanceRef; all pending requests are cancelled
 * if the socket disconnects or is replaced.
 */
class WsRequestCorrelator(
    private val maxInFlight: Int = 256,
) {
    private val mutex = Mutex()
    private val pendingRequests = mutableMapOf<ULong, CompletableDeferred<ServerMsg>>()
    private var boundSocket: SocketInstanceRef? = null

    suspend fun bindSocket(socketRef: SocketInstanceRef) = mutex.withLock {
        cancelAllLocked("Socket replaced by ${socketRef.key}")
        boundSocket = socketRef
    }

    suspend fun register(reqId: ULong, deferred: CompletableDeferred<ServerMsg>) = mutex.withLock {
        if (pendingRequests.size >= maxInFlight) {
            throw ConnectionOwnerError(
                "In-flight WebSocket request capacity ($maxInFlight) exceeded",
                ConnectionErrorReason.UNAVAILABLE,
            )
        }
        pendingRequests[reqId] = deferred
    }

    suspend fun unregister(reqId: ULong) = mutex.withLock {
        pendingRequests.remove(reqId)
    }

    suspend fun dispatch(msg: ServerMsg): Boolean {
        val reqId = msg.extractReqId() ?: return false
        val deferred = mutex.withLock {
            pendingRequests.remove(reqId)
        } ?: return false

        deferred.complete(msg)
        return true
    }

    suspend fun cancelAll(reason: String) = mutex.withLock {
        cancelAllLocked(reason)
    }

    private fun cancelAllLocked(reason: String) {
        val error = ConnectionOwnerError(reason, ConnectionErrorReason.UNAVAILABLE)
        pendingRequests.values.forEach { deferred ->
            deferred.completeExceptionally(error)
        }
        pendingRequests.clear()
    }
}
