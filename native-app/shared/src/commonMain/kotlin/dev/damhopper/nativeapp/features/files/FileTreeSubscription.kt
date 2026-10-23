package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Handle to an active WebSocket filesystem tree subscription.
 */
interface FileTreeSubscription {
    val subId: ULong
    val target: ProjectTargetRef
    val path: String
    val originSocket: dev.damhopper.nativeapp.core.model.SocketInstanceRef?
    fun cancel()
}

/**
 * Manages WebSocket tree subscription lifecycle, closes snapshot-to-event race
 * conditions with pre-buffering, and coordinates event/overflow dispatch.
 */
class TreeSubscriptionManager(
    private val wsConnection: WsConnection,
    private val coroutineScope: CoroutineScope,
    private val nextReqId: () -> ULong,
) {
    private val mutex = Mutex()
    private val activeSubscriptions = mutableMapOf<Pair<dev.damhopper.nativeapp.core.model.SocketInstanceRef?, ULong>, Job>()
    @Volatile
    private var isDisposed = false

    suspend fun subscribe(
        target: ProjectTargetRef,
        path: String = "",
        watchOnly: Boolean? = true,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit,
        onEvent: (FsEventDto) -> Unit,
        onOverflow: (String) -> Unit,
    ): FileTreeSubscription {
        if (isDisposed) {
            throw ConnectionOwnerError("TreeSubscriptionManager is disposed", ConnectionErrorReason.UNAVAILABLE)
        }

        val reqId = nextReqId()
        val activeSocket = wsConnection.activeSocketRef()
        val earlyBuffer = Channel<ServerMsg>(capacity = Channel.UNLIMITED)

        // Pre-activate event buffer IMMEDIATELY (UNDISPATCHED) before sending subscribe request
        val collectorJob = coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.socketBoundMessages.collect { bound ->
                if (activeSocket == null || bound.socketRef == activeSocket) {
                    val msg = bound.message
                    if (msg is ServerMsg.FsEventMsg || msg is ServerMsg.FsOverflow) {
                        earlyBuffer.trySend(msg)
                    }
                }
            }
        }

        val subMsg = ClientMsg.FsSubscribeTree(
            reqId = reqId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
            watchOnly = watchOnly,
        )

        val response = try {
            if (activeSocket != null) {
                wsConnection.requestOnSocket(activeSocket, reqId, subMsg)
            } else {
                wsConnection.request(reqId, subMsg)
            }
        } catch (e: CancellationException) {
            collectorJob.cancel()
            earlyBuffer.close()
            throw e
        } catch (e: Throwable) {
            collectorJob.cancel()
            earlyBuffer.close()
            throw e
        }

        val snapshot = when (response) {
            is ServerMsg.TreeSnapshot -> response
            is ServerMsg.FsError -> {
                collectorJob.cancel()
                earlyBuffer.close()
                throw ConnectionOwnerError("fs:subscribe_tree failed: [${response.code}] ${response.message}", ConnectionErrorReason.UNAVAILABLE)
            }
            else -> {
                collectorJob.cancel()
                earlyBuffer.close()
                throw ConnectionOwnerError("Unexpected subscribe response: $response", ConnectionErrorReason.UNAVAILABLE)
            }
        }

        val subId = snapshot.subId
        onSnapshot(snapshot)

        // Drain buffered events and forward matching stream
        val dispatcherJob = coroutineScope.launch {
            try {
                for (msg in earlyBuffer) {
                    when (msg) {
                        is ServerMsg.FsEventMsg -> if (msg.subId == subId) onEvent(msg.event)
                        is ServerMsg.FsOverflow -> if (msg.subId == subId) onOverflow(msg.message)
                        else -> Unit
                    }
                }
            } catch (_: CancellationException) {}
        }

        val combinedJob = coroutineScope.launch {
            try {
                dispatcherJob.join()
            } finally {
                collectorJob.cancel()
                earlyBuffer.close()
            }
        }

        mutex.withLock {
            if (isDisposed) {
                combinedJob.cancel()
                try {
                    val cancelMsg = ClientMsg.FsUnsubscribeTree(subId)
                    if (activeSocket != null) wsConnection.sendOnSocket(activeSocket, cancelMsg)
                    else wsConnection.send(cancelMsg)
                } catch (_: Throwable) {}
                throw ConnectionOwnerError("TreeSubscriptionManager was disposed during subscription", ConnectionErrorReason.UNAVAILABLE)
            }
            activeSubscriptions[Pair(activeSocket, subId)] = combinedJob
        }

        return object : FileTreeSubscription {
            override val subId: ULong = snapshot.subId
            override val target: ProjectTargetRef = target
            override val path: String = path
            override val originSocket: dev.damhopper.nativeapp.core.model.SocketInstanceRef? = activeSocket

            override fun cancel() {
                unsubscribe(originSocket, subId)
            }
        }
    }

    fun unsubscribe(originSocket: dev.damhopper.nativeapp.core.model.SocketInstanceRef?, subId: ULong) {
        coroutineScope.launch {
            val key = Pair(originSocket, subId)
            val job = mutex.withLock { activeSubscriptions.remove(key) }
            job?.cancel()

            if (originSocket != null) {
                try {
                    val cancelMsg = ClientMsg.FsUnsubscribeTree(subId)
                    wsConnection.sendOnSocket(originSocket, cancelMsg)
                } catch (_: Throwable) {}
            }
        }
    }

    fun unsubscribe(subId: ULong) {
        val currentSocket = wsConnection.activeSocketRef()
        unsubscribe(currentSocket, subId)
    }

    fun dispose() {
        isDisposed = true
        coroutineScope.launch {
            val subs = mutex.withLock {
                val copy = activeSubscriptions.toMap()
                activeSubscriptions.clear()
                copy
            }
            subs.forEach { (key, job) ->
                val (originSocket, subId) = key
                job.cancel()
                if (originSocket != null) {
                    try {
                        val cancelMsg = ClientMsg.FsUnsubscribeTree(subId)
                        wsConnection.sendOnSocket(originSocket, cancelMsg)
                    } catch (_: Throwable) {}
                }
            }
        }
    }
}
