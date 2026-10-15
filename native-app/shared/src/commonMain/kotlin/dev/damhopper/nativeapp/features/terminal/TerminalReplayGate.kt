package dev.damhopper.nativeapp.features.terminal

/**
 * Data chunk received while historical replay buffer is in flight.
 */
data class QueuedLiveChunk(
    val data: ByteArray,
    val offset: ULong,
    val incarnation: ULong,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is QueuedLiveChunk) return false
        if (!data.contentEquals(other.data)) return false
        if (offset != other.offset) return false
        if (incarnation != other.incarnation) return false
        return true
    }

    override fun hashCode(): Int {
        var result = data.contentHashCode()
        result = 31 * result + offset.hashCode()
        result = 31 * result + incarnation.hashCode()
        return result
    }
}

/**
 * Result of reconciling a live output chunk against the current authoritative stream offset.
 */
sealed class ReconcileOutputResult {
    /**
     * Chunk is contiguous or partially overlapped; render [data] and advance authoritative offset to [nextOffset].
     */
    data class Render(val data: ByteArray, val nextOffset: ULong) : ReconcileOutputResult() {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Render) return false
            return data.contentEquals(other.data) && nextOffset == other.nextOffset
        }

        override fun hashCode(): Int {
            return 31 * data.contentHashCode() + nextOffset.hashCode()
        }
    }

    /**
     * Chunk was already observed; discard duplicate and keep current offset at [nextOffset].
     */
    data class Discard(val nextOffset: ULong) : ReconcileOutputResult()

    /**
     * Stream discontinuity detected. [receivedStartOffset] is greater than [expectedOffset].
     * Client must trigger re-attach or request fresh snapshot.
     */
    data class Gap(val expectedOffset: ULong, val receivedStartOffset: ULong) : ReconcileOutputResult()
}

/**
 * State machine gating terminal stream replay and live PTY output.
 *
 * Invariants:
 * 1. Live stream does not open until historical replay buffer writes complete and drain.
 * 2. Active parser write count survives attach resets so asynchronous parser execution
 *    cannot leak terminal device queries into live sessions.
 * 3. Bounded queue with overflow detection to prevent unbounded memory growth.
 * 4. Exact UTF-8 byte length reconciliation preventing duplicate or out-of-order writes.
 */
class TerminalReplayGate(
    val maxQueuedChunks: Int = DEFAULT_MAX_QUEUED_CHUNKS,
    val maxQueuedBytes: Int = DEFAULT_MAX_QUEUED_BYTES,
) {
    companion object {
        const val DEFAULT_MAX_QUEUED_CHUNKS = 1024
        const val DEFAULT_MAX_QUEUED_BYTES = 4 * 1024 * 1024 // 4 MiB
    }

    var hasAttachBufferBeenReceived: Boolean = false
        private set

    var isReplayWriting: Boolean = false
        private set

    var isLiveStreamReady: Boolean = false
        private set

    var replayGeneration: Long = 0L
        private set

    var activeReplayWrites: Int = 0
        private set

    private val _queuedLiveData = mutableListOf<QueuedLiveChunk>()
    val queuedLiveData: List<QueuedLiveChunk> get() = _queuedLiveData

    private var queuedByteCount: Int = 0

    var onReplayDrain: (() -> Unit)? = null
    var onQueueOverflow: (() -> Unit)? = null

    /**
     * Resets gate for a new attach attempt.
     * Outstanding [activeReplayWrites] count survives attach reset so in-flight
     * historical parses cannot leak queries after an attach reset or reconnect.
     */
    fun resetForAttach() {
        hasAttachBufferBeenReceived = false
        isLiveStreamReady = false
        replayGeneration += 1L
        _queuedLiveData.clear()
        queuedByteCount = 0
        isReplayWriting = activeReplayWrites > 0
    }

    /**
     * Marks stream ready immediately after process restart where buffer was cleared on server.
     */
    fun markReadyAfterRestart() {
        hasAttachBufferBeenReceived = true
        replayGeneration += 1L
        _queuedLiveData.clear()
        queuedByteCount = 0
        isReplayWriting = activeReplayWrites > 0
        isLiveStreamReady = activeReplayWrites == 0
    }

    /**
     * Marks start of a replay buffer write.
     */
    fun beginReplayWrite() {
        hasAttachBufferBeenReceived = true
        isReplayWriting = true
        isLiveStreamReady = false
        activeReplayWrites += 1
    }

    /**
     * Marks completion of a replay buffer write.
     */
    fun finishReplayWrite() {
        activeReplayWrites = maxOf(0, activeReplayWrites - 1)
        isReplayWriting = activeReplayWrites > 0
    }

    /**
     * Notifies drain completion when all pending replay writes reach zero.
     */
    fun notifyReplayDrain() {
        if (activeReplayWrites == 0) {
            onReplayDrain?.invoke()
        }
    }

    /**
     * Returns true when outbound data/queries may be forwarded to the PTY.
     * Replay writes suppress outbound queries to prevent terminal echo loops.
     */
    fun shouldForwardTerminalData(): Boolean {
        return activeReplayWrites <= 0
    }

    /**
     * Enqueues live chunk received while historical replay is in progress.
     * Returns false if queue bounds are exceeded.
     */
    fun enqueueLiveChunk(chunk: QueuedLiveChunk): Boolean {
        if (_queuedLiveData.size >= maxQueuedChunks || (queuedByteCount + chunk.data.size) > maxQueuedBytes) {
            onQueueOverflow?.invoke()
            return false
        }
        _queuedLiveData.add(chunk)
        queuedByteCount += chunk.data.size
        return true
    }

    /**
     * Drains all queued live chunks and clears the internal queue.
     */
    fun drainQueuedChunks(): List<QueuedLiveChunk> {
        val copy = _queuedLiveData.toList()
        _queuedLiveData.clear()
        queuedByteCount = 0
        return copy
    }

    /**
     * Marks live stream ready to accept real-time chunks.
     */
    fun markLiveStreamReady() {
        if (activeReplayWrites == 0) {
            isLiveStreamReady = true
        }
    }
}

/**
 * Reconciles a live output chunk against the current authoritative stream offset.
 *
 * @param data Raw byte payload of the chunk.
 * @param endOffset Authoritative stream byte offset after this chunk.
 * @param currentOffset Client's last confirmed processed byte offset.
 */
fun reconcileTerminalOutput(
    data: ByteArray,
    endOffset: ULong,
    currentOffset: ULong,
): ReconcileOutputResult {
    // 1. Duplicate chunk already processed
    if (endOffset <= currentOffset) {
        return ReconcileOutputResult.Discard(currentOffset)
    }

    val byteLen = data.size.toULong()
    val startOffset = if (endOffset >= byteLen) endOffset - byteLen else 0uL

    // 2. Stream gap detected (startOffset > currentOffset)
    if (startOffset > currentOffset) {
        return ReconcileOutputResult.Gap(
            expectedOffset = currentOffset,
            receivedStartOffset = startOffset,
        )
    }

    // 3. Partial overlap (startOffset < currentOffset < endOffset)
    if (startOffset < currentOffset) {
        val bytesToSkip = (currentOffset - startOffset).toInt()
        val slicedData = data.copyOfRange(bytesToSkip, data.size)
        return ReconcileOutputResult.Render(slicedData, endOffset)
    }

    // 4. Contiguous chunk (startOffset == currentOffset)
    return ReconcileOutputResult.Render(data, endOffset)
}
