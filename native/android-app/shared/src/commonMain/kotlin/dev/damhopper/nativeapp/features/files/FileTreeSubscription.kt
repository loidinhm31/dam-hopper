package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ConnectionErrorReason
import dev.damhopper.nativeapp.core.model.ConnectionOwnerError
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Origin- and incarnation-qualified filesystem watch event.
 * Never falls back to raw absolute server paths when target-relative routing is absent.
 */
data class QualifiedWatchEvent(
    val owner: WorkspaceFileOwner?,
    val target: ProjectTargetRef,
    val watchedDirectoryPath: String,
    val originSocket: SocketInstanceRef,
    val subId: ULong,
    val requestId: ULong,
    val subscribeIncarnation: Long,
    val sequenceNumber: Long,
    val event: FsEventDto,
    val targetRelativePath: String?,
    val targetRelativeFrom: String?,
    val hasMissingRelativeRouting: Boolean,
    val estimatedBytes: Int,
) {
    fun toSocketBoundFsEvent(): SocketBoundFsEvent = SocketBoundFsEvent(
        socketRef = originSocket,
        subId = subId.toString(),
        event = event,
        sequenceNumber = sequenceNumber,
    )

    companion object {
        private const val ENVELOPE_OVERHEAD_BYTES = 64

        fun estimateEventBytes(event: FsEventDto): Int =
            ENVELOPE_OVERHEAD_BYTES +
                event.kind.length * 2 +
                event.path.length * 2 +
                (event.from?.length ?: 0) * 2 +
                (event.targetRelativePath?.length ?: 0) * 2 +
                (event.targetRelativeFrom?.length ?: 0) * 2

        fun estimateMessageBytes(msg: ServerMsg): Int = when (msg) {
            is ServerMsg.FsEventMsg -> estimateEventBytes(msg.event)
            is ServerMsg.FsOverflow -> ENVELOPE_OVERHEAD_BYTES + msg.message.length * 2
            else -> ENVELOPE_OVERHEAD_BYTES
        }

        /**
         * Extracts and normalizes a target-relative path from an event field.
         * Returns null if absent or invalid (e.g., traversal or absolute path).
         * Never falls back to raw absolute path/from fields.
         */
        fun extractSafeTargetRelativePath(rawRelative: String?): String? {
            if (rawRelative == null) return null
            val trimmed = rawRelative.trim().replace('\\', '/').trim('/')
            if (trimmed.isEmpty() || trimmed == ".") return ""
            return try {
                DocumentId.normalizeRelativePath(trimmed)
            } catch (_: IllegalArgumentException) {
                null
            }
        }

        fun fromRaw(
            owner: WorkspaceFileOwner?,
            target: ProjectTargetRef,
            watchedDirectoryPath: String,
            originSocket: SocketInstanceRef,
            subId: ULong,
            requestId: ULong,
            subscribeIncarnation: Long,
            sequenceNumber: Long,
            event: FsEventDto,
        ): QualifiedWatchEvent {
            val safeRelPath = extractSafeTargetRelativePath(event.targetRelativePath)
            val requiresFrom = event.from != null || event.targetRelativeFrom != null
            val safeRelFrom = if (requiresFrom) extractSafeTargetRelativePath(event.targetRelativeFrom) else null
            val missingRouting = safeRelPath == null || (requiresFrom && safeRelFrom == null)
            return QualifiedWatchEvent(
                owner = owner,
                target = target,
                watchedDirectoryPath = watchedDirectoryPath,
                originSocket = originSocket,
                subId = subId,
                requestId = requestId,
                subscribeIncarnation = subscribeIncarnation,
                sequenceNumber = sequenceNumber,
                event = event,
                targetRelativePath = safeRelPath,
                targetRelativeFrom = safeRelFrom,
                hasMissingRelativeRouting = missingRouting,
                estimatedBytes = estimateEventBytes(event),
            )
        }
    }
}

/**
 * Handle to an active WebSocket filesystem tree subscription bound to a specific origin socket
 * and monotonic subscription incarnation.
 */
interface FileTreeSubscription {
    val subId: ULong
    val target: ProjectTargetRef
    val path: String
    val originSocket: SocketInstanceRef
    val requestId: ULong
        get() = 0uL
    val subscribeIncarnation: Long
        get() = 0L
    fun cancel()
}

/**
 * Manages WebSocket tree subscription lifecycle, closes snapshot-to-event race
 * conditions with finite pre-buffering, and coordinates origin-socket-fenced event/overflow dispatch.
 */
class TreeSubscriptionManager(
    private val wsConnection: WsConnection,
    private val coroutineScope: CoroutineScope,
    private val owner: WorkspaceFileOwner? = null,
    private val nextReqId: () -> ULong,
) {
    constructor(
        wsConnection: WsConnection,
        coroutineScope: CoroutineScope,
        nextReqId: () -> ULong,
    ) : this(
        wsConnection = wsConnection,
        coroutineScope = coroutineScope,
        owner = null,
        nextReqId = nextReqId,
    )
    private data class SubscriptionKey(
        val originSocket: SocketInstanceRef,
        val subId: ULong,
    )

    private data class ActiveSubscriptionRecord(
        val key: SubscriptionKey,
        val subscribeIncarnation: Long,
        val requestId: ULong,
        val job: Job,
    )

    private val mutex = Mutex()
    private val activeSubscriptions = mutableMapOf<SubscriptionKey, ActiveSubscriptionRecord>()
    private val incarnationLock = Any()
    private var nextIncarnationId = 1L
    private var nextSequenceNumber = 1L

    @Volatile
    private var isDisposed = false

    fun allocateIncarnation(): Long = synchronized(incarnationLock) {
        nextIncarnationId++
    }

    fun allocateSequenceNumber(): Long = synchronized(incarnationLock) {
        nextSequenceNumber++
    }

    suspend fun subscribe(
        target: ProjectTargetRef,
        path: String = "",
        watchOnly: Boolean? = true,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit,
        onEvent: (FsEventDto) -> Unit,
        onOverflow: (String) -> Unit,
    ): FileTreeSubscription = subscribeQualified(
        target = target,
        path = path,
        watchOnly = watchOnly,
        onSnapshot = onSnapshot,
        onQualifiedEvent = { qualified -> onEvent(qualified.event) },
        onOverflow = { _, _, msg -> onOverflow(msg) },
    )

    suspend fun subscribeQualified(
        target: ProjectTargetRef,
        path: String = "",
        watchOnly: Boolean? = true,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit = {},
        onQualifiedEvent: (QualifiedWatchEvent) -> Unit,
        onOverflow: (String) -> Unit,
    ): FileTreeSubscription = subscribeQualified(
        target = target,
        path = path,
        watchOnly = watchOnly,
        onSnapshot = onSnapshot,
        onQualifiedEvent = onQualifiedEvent,
        onOverflow = { _, _, msg -> onOverflow(msg) },
    )

    suspend fun subscribeQualified(
        target: ProjectTargetRef,
        path: String = "",
        watchOnly: Boolean? = true,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit = {},
        onQualifiedEvent: (QualifiedWatchEvent) -> Unit,
        onOverflow: (subId: ULong, incarnation: Long, message: String) -> Unit,
    ): FileTreeSubscription {
        if (isDisposed) {
            throw ConnectionOwnerError("TreeSubscriptionManager is disposed", ConnectionErrorReason.UNAVAILABLE)
        }

        val originSocket = wsConnection.activeSocketRef()
            ?: throw ConnectionOwnerError(
                "Cannot subscribe to directory watcher without an active WebSocket instance",
                ConnectionErrorReason.UNAVAILABLE,
            )

        val reqId = nextReqId()
        val incarnation = allocateIncarnation()
        val normalizedDirPath = if (path.isBlank() || path == ".") "" else DocumentId.normalizeRelativePath(path)

        val earlyBuffer = Channel<ServerMsg>(capacity = WatchQueueLimits.MAX_EARLY_EVENT_COUNT)
        val bufferStateLock = Any()
        var snapshotCompleted = false
        var subscribedSubId: ULong? = null
        var earlyEventCount = 0
        var earlyEventBytes = 0L
        var earlyBufferOverflowed = false

        // Pre-activate event listener IMMEDIATELY (UNDISPATCHED) before sending subscribe request
        val collectorJob = coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            wsConnection.socketBoundMessages.collect { bound ->
                // Strict origin socket check: never accept events from a different or null socket
                if (bound.socketRef != originSocket) return@collect
                val msg = bound.message
                if (msg !is ServerMsg.FsEventMsg && msg !is ServerMsg.FsOverflow) return@collect
                val filterSubId = synchronized(bufferStateLock) { subscribedSubId }
                if (filterSubId != null) {
                    val msgSubId = when (msg) {
                        is ServerMsg.FsEventMsg -> msg.subId
                        is ServerMsg.FsOverflow -> msg.subId
                        else -> null
                    }
                    if (msgSubId != null && msgSubId != filterSubId) return@collect
                }

                val shouldEnqueue = synchronized(bufferStateLock) {
                    if (!snapshotCompleted) {
                        if (msg is ServerMsg.FsOverflow) {
                            true
                        } else if (earlyBufferOverflowed) {
                            false
                        } else {
                            val msgBytes = QualifiedWatchEvent.estimateMessageBytes(msg).toLong()
                            if (
                                earlyEventCount + 1 > WatchQueueLimits.MAX_EARLY_EVENT_COUNT ||
                                earlyEventBytes + msgBytes > WatchQueueLimits.MAX_EARLY_EVENT_BYTES
                            ) {
                                earlyBufferOverflowed = true
                                false
                            } else {
                                earlyEventCount += 1
                                earlyEventBytes += msgBytes
                                true
                            }
                        }
                    } else {
                        true
                    }
                }

                if (shouldEnqueue) {
                    val sendResult = earlyBuffer.trySend(msg)
                    if (!sendResult.isSuccess) {
                        synchronized(bufferStateLock) {
                            earlyBufferOverflowed = true
                        }
                    }
                }
            }
        }

        val subMsg = ClientMsg.FsSubscribeTree(
            reqId = reqId,
            project = target.project,
            worktreePath = target.worktreePath,
            path = normalizedDirPath,
            watchOnly = watchOnly,
        )

        val response = try {
            wsConnection.requestOnSocket(originSocket, reqId, subMsg)
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
                throw ConnectionOwnerError(
                    "fs:subscribe_tree failed: [${response.code}] ${response.message}",
                    ConnectionErrorReason.UNAVAILABLE,
                )
            }
            else -> {
                collectorJob.cancel()
                earlyBuffer.close()
                throw ConnectionOwnerError(
                    "Unexpected subscribe response: $response",
                    ConnectionErrorReason.UNAVAILABLE,
                )
            }
        }

        val subId = snapshot.subId
        val overflowBeforeDrain = synchronized(bufferStateLock) {
            subscribedSubId = subId
            snapshotCompleted = true
            earlyBufferOverflowed
        }
        onSnapshot(snapshot)
        val dispatcherJob = coroutineScope.launch {
            var overflowSignaled = false
            try {
                if (overflowBeforeDrain) {
                    overflowSignaled = true
                    onOverflow(subId, incarnation, "Client early event queue overflowed for subId=$subId")
                }
                for (msg in earlyBuffer) {
                    val dynamicOverflow = synchronized(bufferStateLock) { earlyBufferOverflowed }
                    if (dynamicOverflow && !overflowSignaled) {
                        overflowSignaled = true
                        onOverflow(subId, incarnation, "Client event buffer overflowed for subId=$subId")
                        continue
                    }
                    when (msg) {
                        is ServerMsg.FsEventMsg -> {
                            if (msg.subId == subId && !overflowSignaled) {
                                val seq = allocateSequenceNumber()
                                val qualified = QualifiedWatchEvent.fromRaw(
                                    owner = owner,
                                    target = target,
                                    watchedDirectoryPath = normalizedDirPath,
                                    originSocket = originSocket,
                                    subId = subId,
                                    requestId = reqId,
                                    subscribeIncarnation = incarnation,
                                    sequenceNumber = seq,
                                    event = msg.event,
                                )
                                onQualifiedEvent(qualified)
                            }
                        }
                        is ServerMsg.FsOverflow -> {
                            if (msg.subId == subId && !overflowSignaled) {
                                overflowSignaled = true
                                onOverflow(subId, incarnation, msg.message)
                            }
                        }
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

        val subKey = SubscriptionKey(originSocket, subId)
        mutex.withLock {
            if (isDisposed) {
                combinedJob.cancel()
                try {
                    wsConnection.sendOnSocket(originSocket, ClientMsg.FsUnsubscribeTree(subId))
                } catch (_: Throwable) {}
                throw ConnectionOwnerError(
                    "TreeSubscriptionManager was disposed during subscription",
                    ConnectionErrorReason.UNAVAILABLE,
                )
            }
            activeSubscriptions[subKey]?.job?.cancel()
            activeSubscriptions[subKey] = ActiveSubscriptionRecord(
                key = subKey,
                subscribeIncarnation = incarnation,
                requestId = reqId,
                job = combinedJob,
            )
        }

        return object : FileTreeSubscription {
            override val subId: ULong = subId
            override val target: ProjectTargetRef = target
            override val path: String = normalizedDirPath
            override val originSocket: SocketInstanceRef = originSocket
            override val requestId: ULong = reqId
            override val subscribeIncarnation: Long = incarnation

            override fun cancel() {
                unsubscribe(originSocket, subId, incarnation)
            }
        }
    }

    fun unsubscribe(
        originSocket: SocketInstanceRef?,
        subId: ULong,
        expectedIncarnation: Long? = null,
    ) {
        if (originSocket == null) return
        coroutineScope.launch {
            val key = SubscriptionKey(originSocket, subId)
            val removed = mutex.withLock {
                val current = activeSubscriptions[key] ?: return@withLock null
                if (expectedIncarnation != null && current.subscribeIncarnation != expectedIncarnation) {
                    return@withLock null
                }
                activeSubscriptions.remove(key)
            } ?: return@launch

            removed.job.cancel()
            try {
                wsConnection.sendOnSocket(originSocket, ClientMsg.FsUnsubscribeTree(subId))
            } catch (_: Throwable) {}
        }
    }

    fun unsubscribe(subId: ULong) {
        coroutineScope.launch {
            val matchingRecords = mutex.withLock {
                val matches = activeSubscriptions.values.filter { it.key.subId == subId }
                matches.forEach { activeSubscriptions.remove(it.key) }
                matches
            }
            for (record in matchingRecords) {
                record.job.cancel()
                try {
                    wsConnection.sendOnSocket(record.key.originSocket, ClientMsg.FsUnsubscribeTree(subId))
                } catch (_: Throwable) {}
            }
        }
    }

    fun dispose() {
        isDisposed = true
        coroutineScope.launch {
            val subs = mutex.withLock {
                val copy = activeSubscriptions.values.toList()
                activeSubscriptions.clear()
                copy
            }
            subs.forEach { record ->
                record.job.cancel()
                try {
                    wsConnection.sendOnSocket(
                        record.key.originSocket,
                        ClientMsg.FsUnsubscribeTree(record.key.subId),
                    )
                } catch (_: Throwable) {}
            }
        }
    }
}
