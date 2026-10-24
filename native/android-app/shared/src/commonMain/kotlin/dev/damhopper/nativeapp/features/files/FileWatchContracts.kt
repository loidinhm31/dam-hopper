package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/**
 * Origin category placing watch demand on a directory.
 */
enum class WatchConsumerKind {
    EXPLORER_EXPANDED_DIRECTORY,
    OPEN_DOCUMENT_PARENT,
}

/**
 * Uniquely identifies a consumer holding watch demand on a directory.
 */
data class WatchDemandKey(
    val consumerId: String,
    val kind: WatchConsumerKind,
)

/**
 * Aggregated watch demand on a directory under a logical workspace owner.
 * Nonrecursive: watching a directory monitors only its direct entries.
 */
data class FileWatchDemand(
    val owner: WorkspaceFileOwner,
    val directoryPath: String,
    val consumers: Set<WatchDemandKey> = emptySet(),
) {
    val isDemanded: Boolean get() = consumers.isNotEmpty()

    fun withConsumer(consumerId: String, kind: WatchConsumerKind): FileWatchDemand =
        copy(consumers = consumers + WatchDemandKey(consumerId, kind))

    fun withoutConsumer(consumerId: String, kind: WatchConsumerKind): FileWatchDemand =
        copy(consumers = consumers - WatchDemandKey(consumerId, kind))
}

/**
 * State of an active subscription on a specific live socket.
 * Stamped with the exact origin socket reference and monotonic subscription incarnation.
 */
data class WatchSubscriptionState(
    val owner: WorkspaceFileOwner,
    val socketRef: SocketInstanceRef,
    val subId: String,
    val directoryPath: String,
    val subscribeIncarnation: Long,
    val eventWatermark: Long = 0L,
    val isRetired: Boolean = false,
)

/**
 * Qualified file watch event bearing transport-origin socket reference and sequence watermark.
 */
data class SocketBoundFsEvent(
    val socketRef: SocketInstanceRef,
    val subId: String,
    val event: FsEventDto,
    val sequenceNumber: Long,
)

/**
 * Bounded queue constants for watch event buffering and watermark replay.
 */
object WatchQueueLimits {
    const val MAX_EARLY_EVENT_COUNT = 128
    const val MAX_EARLY_EVENT_BYTES = 65_536L
    const val MAX_HISTORY_EVENT_COUNT = 256
}
