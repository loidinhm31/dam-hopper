package dev.damhopper.nativeapp.features.files

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.WsState
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Result of an epoch- and watermark-fenced directory listing request.
 */
sealed interface OrderedDirectoryListingResult {
    data class Published(
        val directoryPath: String,
        val entries: List<DirEntryDto>,
        val requestEpoch: Long,
        val watermarkSequence: Long,
        val replayedEventCount: Int = 0,
    ) : OrderedDirectoryListingResult

    data object Superseded : OrderedDirectoryListingResult

    data class Failed(
        val directoryPath: String,
        val error: Throwable,
        val requestEpoch: Long,
    ) : OrderedDirectoryListingResult
}

/**
 * Coordinates reference-counted nonrecursive directory watch subscriptions across explorer
 * expanded folders and open-document parent directories for a single logical owner.
 *
 * Guarantees:
 * - At most one active subscription per (owner, socketRef, directoryPath).
 * - Subscribe-before-list ordering when a live socket is available.
 * - Monotonic listing request epochs and bounded event history watermarks.
 * - Origin-socket and subscription-incarnation fencing against stale events and reused subIds.
 * - Strict target-relative routing: missing relative paths invalidate baseline and trigger refetch.
 * - Overflow recovery: retires dead subscription, recreates subscription first, then refetches.
 * - Background pause and foreground/reconnect reconciliation before enabling write readiness.
 */
class FileWatchCoordinator(
    val owner: WorkspaceFileOwner,
    val target: ProjectTargetRef,
    private val repository: FileRepository,
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    private val subscribeDirectoryPort: (suspend (
        dirPath: String,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit,
        onQualifiedEvent: (QualifiedWatchEvent) -> Unit,
        onOverflow: (String) -> Unit,
    ) -> FileTreeSubscription)? = null,
    var onRefetchExplorerDirectory: (suspend (directoryPath: String) -> Boolean)? = null,
    var onOpenDocumentParentEvent: (suspend (directoryPath: String, event: QualifiedWatchEvent?) -> Unit)? = null,
    var onReconcileOpenDocumentParents: (suspend (directoryPaths: Set<String>, socketRef: SocketInstanceRef) -> Boolean)? = null,
    var onOverflowNotice: ((directoryPath: String, message: String) -> Unit)? = null,
) {
    constructor(
        target: ProjectTargetRef,
        repository: FileRepository,
        coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    ) : this(
        owner = resolveEffectiveOwner(repository.owner, target),
        target = target,
        repository = repository,
        coroutineScope = coroutineScope,
    )

    private data class ActiveWatchHandle(
        val subscription: FileTreeSubscription,
        val state: WatchSubscriptionState,
    )

    private class DirectoryWatchState(
        val directoryPath: String,
        var latestListRequestEpoch: Long = 0L,
        var inFlightListCount: Int = 0,
        var publishedListEpoch: Long = 0L,
        var publishedWatermark: Long = 0L,
        var lastEventSequence: Long = 0L,
        var baselineInvalidated: Boolean = false,
        var refreshJob: Job? = null,
        var pendingCoalescedRefresh: Boolean = false,
        var isRefreshRunning: Boolean = false,
    )

    private val stateLock = Any()
    private val fallbackSubscriptionManager = TreeSubscriptionManager(
        wsConnection = repository.wsConnection,
        coroutineScope = coroutineScope,
        owner = owner,
        nextReqId = { repository.wsConnection.nextReqId() },
    )

    private val demands = mutableMapOf<String, FileWatchDemand>()
    private val activeHandles = mutableMapOf<String, ActiveWatchHandle>()
    private val directoryStates = mutableMapOf<String, DirectoryWatchState>()
    private val inFlightSubscriptions = mutableSetOf<String>()
    private val pendingInstallationEvents = mutableMapOf<String, MutableList<QualifiedWatchEvent>>()

    private val eventHistory = ArrayDeque<QualifiedWatchEvent>()
    private var eventHistoryBytes: Long = 0L
    private var oldestRetainedSequence: Long = 1L
    private var currentEventSequence: Long = 0L

    private var boundSocketRef: SocketInstanceRef? = null
    private var reconciliationEpoch: Long = 0L

    @Volatile
    private var isPaused: Boolean = false

    @Volatile
    private var isDisposed: Boolean = false

    private val _isWriteReady = MutableStateFlow(false)
    val isWriteReady: StateFlow<Boolean> = _isWriteReady.asStateFlow()

    private val _activeSubscriptions = MutableStateFlow<Map<String, WatchSubscriptionState>>(emptyMap())
    val activeSubscriptions: StateFlow<Map<String, WatchSubscriptionState>> = _activeSubscriptions.asStateFlow()

    init {
        coroutineScope.launch {
            observeSocketLifecycle()
        }
    }

    private suspend fun observeSocketLifecycle() {
        repository.wsConnection.state.collect { wsState ->
            if (isDisposed) return@collect
            when (wsState) {
                is WsState.Connected -> {
                    val newSocket = wsState.socketRef
                    val shouldReconcile = synchronized(stateLock) {
                        if (boundSocketRef != newSocket) {
                            retireAllHandlesForSocketChangeLocked(newSocket)
                            boundSocketRef = newSocket
                            !isPaused
                        } else {
                            false
                        }
                    }
                    if (shouldReconcile) {
                        reconcileAllDemands()
                    }
                }
                else -> {
                    synchronized(stateLock) {
                        _isWriteReady.value = false
                        retireAllHandlesForSocketChangeLocked(null)
                        boundSocketRef = null
                    }
                }
            }
        }
    }

    fun normalizeDirectoryPath(rawPath: String): String {
        val trimmed = rawPath.trim().replace('\\', '/').trim('/')
        if (trimmed.isEmpty() || trimmed == ".") return ""
        return DocumentId.normalizeRelativePath(trimmed)
    }

    suspend fun acquireExplorerDemand(
        directoryPath: String,
        consumerId: String = DEFAULT_EXPLORER_CONSUMER,
    ) {
        acquireDemand(directoryPath, consumerId, WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY)
    }

    suspend fun releaseExplorerDemand(
        directoryPath: String,
        consumerId: String = DEFAULT_EXPLORER_CONSUMER,
    ) {
        releaseDemand(directoryPath, consumerId, WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY)
    }

    /**
     * Synchronously invalidates in-flight explorer listings and removes explorer demand
     * on folder collapse so a racing HTTP completion cannot re-expand the collapsed folder.
     */
    fun releaseExplorerDemandImmediate(
        directoryPath: String,
        consumerId: String = DEFAULT_EXPLORER_CONSUMER,
    ) {
        val cleanDir = normalizeDirectoryPath(directoryPath)
        synchronized(stateLock) {
            directoryStates[cleanDir]?.let { state ->
                state.latestListRequestEpoch += 1
                state.refreshJob?.cancel()
                state.refreshJob = null
                state.pendingCoalescedRefresh = false
            }
            val existing = demands[cleanDir]
            if (existing != null) {
                val updated = existing.withoutConsumer(consumerId, WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY)
                if (updated.isDemanded) {
                    demands[cleanDir] = updated
                } else {
                    demands.remove(cleanDir)
                }
            }
        }
        coroutineScope.launch {
            releaseDemand(cleanDir, consumerId, WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY)
        }
    }

    suspend fun acquireDocumentParentDemand(
        documentPath: String,
        documentConsumerId: String,
    ) {
        val normalizedDoc = DocumentId.normalizeRelativePath(documentPath)
        val parentDir = FileTreeHelpers.resolveParentPath(normalizedDoc)
        acquireDemand(parentDir, documentConsumerId, WatchConsumerKind.OPEN_DOCUMENT_PARENT)
    }

    suspend fun releaseDocumentParentDemand(
        documentPath: String,
        documentConsumerId: String,
    ) {
        val normalizedDoc = DocumentId.normalizeRelativePath(documentPath)
        val parentDir = FileTreeHelpers.resolveParentPath(normalizedDoc)
        releaseDemand(parentDir, documentConsumerId, WatchConsumerKind.OPEN_DOCUMENT_PARENT)
    }

    suspend fun acquireDemand(
        directoryPath: String,
        consumerId: String,
        kind: WatchConsumerKind,
    ) {
        if (isDisposed) return
        val cleanDir = normalizeDirectoryPath(directoryPath)
        val shouldSubscribe = synchronized(stateLock) {
            val existing = demands[cleanDir] ?: FileWatchDemand(owner = owner, directoryPath = cleanDir)
            val updated = existing.withConsumer(consumerId, kind)
            demands[cleanDir] = updated
            directoryStates.getOrPut(cleanDir) { DirectoryWatchState(cleanDir) }
            !isPaused && !isDisposed && repository.wsConnection.activeSocketRef() != null &&
                !hasActiveSubscriptionLocked(cleanDir, repository.wsConnection.activeSocketRef())
        }
        if (shouldSubscribe) {
            try {
                ensureSubscribed(cleanDir)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Handled by caller or subsequent reconciliation
            }
        }
    }

    suspend fun releaseDemand(
        directoryPath: String,
        consumerId: String,
        kind: WatchConsumerKind,
    ) {
        val cleanDir = normalizeDirectoryPath(directoryPath)
        val handleToCancel = synchronized(stateLock) {
            if (kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY) {
                directoryStates[cleanDir]?.let { state ->
                    state.latestListRequestEpoch += 1
                    state.refreshJob?.cancel()
                    state.refreshJob = null
                    state.pendingCoalescedRefresh = false
                }
            }
            val existing = synchronized(stateLock) { demands[cleanDir] }
            if (existing == null) {
                val removed = activeHandles.remove(cleanDir)
                if (removed != null) publishSubscriptionsSnapshotLocked()
                return@synchronized removed
            }
            val updated = existing.withoutConsumer(consumerId, kind)
            if (updated.isDemanded) {
                synchronized(stateLock) { demands[cleanDir] = updated }
                null
            } else {
                synchronized(stateLock) { demands.remove(cleanDir) }
                val removed = activeHandles.remove(cleanDir)
                publishSubscriptionsSnapshotLocked()
                removed
            }
        }
        handleToCancel?.subscription?.cancel()
    }

    suspend fun invalidateDirectoryRequests(directoryPath: String) {
        val cleanDir = normalizeDirectoryPath(directoryPath)
        synchronized(stateLock) {
            val state = directoryStates.getOrPut(cleanDir) { DirectoryWatchState(cleanDir) }
            state.latestListRequestEpoch += 1
            state.refreshJob?.cancel()
            state.refreshJob = null
            state.pendingCoalescedRefresh = false
        }
    }

    fun getDemand(directoryPath: String): FileWatchDemand? = synchronized(stateLock) {
        val cleanDir = normalizeDirectoryPath(directoryPath)
        demands[cleanDir]
    }

    fun getActiveSubscriptionCount(): Int = _activeSubscriptions.value.size

    fun getRetainedHistoryCount(): Int = synchronized(stateLock) { eventHistory.size }

    fun getRetainedHistoryBytes(): Long = synchronized(stateLock) { eventHistoryBytes }

    private fun hasActiveSubscriptionLocked(
        cleanDir: String,
        socketRef: SocketInstanceRef?,
    ): Boolean {
        if (socketRef == null) return false
        val handle = activeHandles[cleanDir] ?: return false
        return !handle.state.isRetired && handle.state.socketRef == socketRef
    }

    /**
     * Ensures a single nonrecursive subscription exists for [directoryPath] on the active socket.
     * Enforces subscribe-before-list ordering and deduplicates concurrent callers.
     */
    suspend fun ensureSubscribed(directoryPath: String): WatchSubscriptionState? {
        if (isDisposed || isPaused) return null
        val cleanDir = normalizeDirectoryPath(directoryPath)
        val activeSocket = repository.wsConnection.activeSocketRef() ?: return null

        synchronized(stateLock) {
            val existing = activeHandles[cleanDir]
            if (existing != null && !existing.state.isRetired && existing.state.socketRef == activeSocket) {
                return existing.state
            }
            val demand = demands[cleanDir]
            if (demand == null || !demand.isDemanded) {
                return null
            }
            if (boundSocketRef != activeSocket) {
                retireAllHandlesForSocketChangeLocked(activeSocket)
                boundSocketRef = activeSocket
            }
            inFlightSubscriptions.add(cleanDir)
        }

        val sub = invokeSubscribePort(
            cleanDir = cleanDir,
            onSnapshot = {},
            onQualifiedEvent = { qualified ->
                coroutineScope.launch {
                    handleQualifiedEvent(qualified)
                }
            },
            onOverflow = { subId, incarnation, msg ->
                coroutineScope.launch {
                    handleSubscriptionOverflow(
                        directoryPath = cleanDir,
                        originSocket = activeSocket,
                        message = msg,
                        expectedSubId = subId,
                        expectedIncarnation = incarnation,
                    )
                }
            },
        )

        var staleHandleToCancel: FileTreeSubscription? = null
        val (installedState, eventsToReplay) = synchronized(stateLock) {
            val currentSocket = repository.wsConnection.activeSocketRef()
            val stillDemanded = demands[cleanDir]?.isDemanded == true
            inFlightSubscriptions.remove(cleanDir)
            if (isDisposed || isPaused || !stillDemanded || currentSocket != sub.originSocket) {
                pendingInstallationEvents.remove(cleanDir)
                staleHandleToCancel = sub
                null to emptyList()
            } else {
                val existing = activeHandles[cleanDir]
                if (existing != null && !existing.state.isRetired && existing.state.socketRef == sub.originSocket) {
                    pendingInstallationEvents.remove(cleanDir)
                    staleHandleToCancel = sub
                    existing.state to emptyList()
                } else {
                    existing?.subscription?.cancel()
                    val subIncarnation = if (sub.subscribeIncarnation > 0L) {
                        sub.subscribeIncarnation
                    } else {
                        fallbackSubscriptionManager.allocateIncarnation()
                    }
                    val state = WatchSubscriptionState(
                        owner = owner,
                        socketRef = sub.originSocket,
                        subId = sub.subId.toString(),
                        directoryPath = cleanDir,
                        subscribeIncarnation = subIncarnation,
                        eventWatermark = currentEventSequence,
                        isRetired = false,
                    )
                    activeHandles[cleanDir] = ActiveWatchHandle(sub, state)
                    publishSubscriptionsSnapshotLocked()
                    val pending = pendingInstallationEvents.remove(cleanDir)?.toList() ?: emptyList()
                    state to pending
                }
            }
        }

        staleHandleToCancel?.cancel()
        for (pendingEvent in eventsToReplay) {
            handleQualifiedEvent(pendingEvent)
        }
        return installedState
    }

    private suspend fun invokeSubscribePort(
        cleanDir: String,
        onSnapshot: (ServerMsg.TreeSnapshot) -> Unit,
        onQualifiedEvent: (QualifiedWatchEvent) -> Unit,
        onOverflow: (subId: ULong, incarnation: Long, message: String) -> Unit,
    ): FileTreeSubscription {
        val customPort = subscribeDirectoryPort
        if (customPort != null) {
            return customPort(cleanDir, onSnapshot, onQualifiedEvent) { msg ->
                onOverflow(0uL, 0L, msg)
            }
        }
        repository.assertTargetMatchesOwner(target, "subscribeTree")
        return fallbackSubscriptionManager.subscribeQualified(
            target = target,
            path = cleanDir,
            watchOnly = true,
            onSnapshot = onSnapshot,
            onQualifiedEvent = onQualifiedEvent,
            onOverflow = onOverflow,
        )
    }

    /**
     * Fetches a directory listing with subscribe-before-list ordering, request-epoch fencing,
     * and watermark event replay / invalidation recovery.
     */
    suspend fun fetchDirectoryOrdered(
        directoryPath: String,
        maxRefetchAttempts: Int = 2,
    ): OrderedDirectoryListingResult {
        val cleanDir = normalizeDirectoryPath(directoryPath)
        var attempt = 0

        while (attempt <= maxRefetchAttempts) {
            attempt++
            if (isDisposed || isPaused) return OrderedDirectoryListingResult.Superseded

            val isDemanded = synchronized(stateLock) { demands[cleanDir]?.isDemanded == true }
            if (isDemanded && repository.wsConnection.activeSocketRef() != null) {
                try {
                    ensureSubscribed(cleanDir)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    // Continue to REST list with epoch fencing; socket state checked on completion
                }
            }

            val (requestEpoch, requestWatermark, capturedSocket, capturedSubIncarnation) = synchronized(stateLock) {
                if (isDisposed || isPaused) return OrderedDirectoryListingResult.Superseded
                val dirState = directoryStates.getOrPut(cleanDir) { DirectoryWatchState(cleanDir) }
                val epoch = ++dirState.latestListRequestEpoch
                dirState.inFlightListCount += 1
                dirState.baselineInvalidated = false
                val subState = activeHandles[cleanDir]?.state
                Quadruple(
                    epoch,
                    currentEventSequence,
                    repository.wsConnection.activeSocketRef(),
                    subState?.subscribeIncarnation,
                )
            }

            val rawEntries = try {
                repository.listDirectory(target, cleanDir)
            } catch (e: CancellationException) {
                synchronized(stateLock) {
                    directoryStates[cleanDir]?.let {
                        it.inFlightListCount = (it.inFlightListCount - 1).coerceAtLeast(0)
                    }
                }
                throw e
            } catch (t: Throwable) {
                val fencedFailure = synchronized(stateLock) {
                    val dirState = directoryStates[cleanDir]
                    if (dirState != null) {
                        dirState.inFlightListCount = (dirState.inFlightListCount - 1).coerceAtLeast(0)
                    }
                    if (
                        isDisposed ||
                        isPaused ||
                        dirState == null ||
                        requestEpoch != dirState.latestListRequestEpoch ||
                        !isExplorerStillDemandedLocked(cleanDir)
                    ) {
                        OrderedDirectoryListingResult.Superseded
                    } else {
                        OrderedDirectoryListingResult.Failed(cleanDir, t, requestEpoch)
                    }
                }
                return fencedFailure
            }

            val decision = synchronized(stateLock) {
                val dirState = directoryStates[cleanDir]
                if (dirState != null) {
                    dirState.inFlightListCount = (dirState.inFlightListCount - 1).coerceAtLeast(0)
                }
                if (
                    isDisposed ||
                    isPaused ||
                    dirState == null ||
                    requestEpoch < dirState.latestListRequestEpoch ||
                    !isExplorerStillDemandedLocked(cleanDir)
                ) {
                    return@synchronized ListingDecision.Superseded
                }

                val currentSocket = repository.wsConnection.activeSocketRef()
                val currentSubIncarnation = activeHandles[cleanDir]?.state?.subscribeIncarnation
                if (
                    dirState.baselineInvalidated ||
                    capturedSocket != currentSocket ||
                    capturedSubIncarnation != currentSubIncarnation
                ) {
                    return@synchronized ListingDecision.NeedsRefetch
                }

                if (dirState.lastEventSequence <= requestWatermark) {
                    dirState.publishedListEpoch = requestEpoch
                    dirState.publishedWatermark = currentEventSequence
                    return@synchronized ListingDecision.Publish(
                        OrderedDirectoryListingResult.Published(
                            directoryPath = cleanDir,
                            entries = rawEntries,
                            requestEpoch = requestEpoch,
                            watermarkSequence = currentEventSequence,
                            replayedEventCount = 0,
                        )
                    )
                }

                // Newer events arrived for cleanDir after requestWatermark
                if (oldestRetainedSequence > requestWatermark + 1) {
                    // Event history truncated past watermark; must refetch
                    return@synchronized ListingDecision.NeedsRefetch
                }

                val newerEvents = eventHistory.filter { ev ->
                    ev.sequenceNumber > requestWatermark && doesEventAffectDirectory(ev, cleanDir)
                }
                if (newerEvents.any { it.hasMissingRelativeRouting || !isDeterministicallyReplayable(it, cleanDir) }) {
                    return@synchronized ListingDecision.NeedsRefetch
                }

                val replayedEntries = replayEventsOnEntries(cleanDir, rawEntries, newerEvents)
                dirState.publishedListEpoch = requestEpoch
                dirState.publishedWatermark = currentEventSequence
                ListingDecision.Publish(
                    OrderedDirectoryListingResult.Published(
                        directoryPath = cleanDir,
                        entries = replayedEntries,
                        requestEpoch = requestEpoch,
                        watermarkSequence = currentEventSequence,
                        replayedEventCount = newerEvents.size,
                    )
                )
            }

            when (decision) {
                is ListingDecision.Superseded -> return OrderedDirectoryListingResult.Superseded
                is ListingDecision.Publish -> {
                    val needsFollowUp = synchronized(stateLock) {
                        val state = directoryStates[cleanDir]
                        val pending = state?.pendingCoalescedRefresh == true
                        if (pending) state?.pendingCoalescedRefresh = false
                        pending
                    }
                    if (needsFollowUp) {
                        scheduleCoalescedRefresh(cleanDir)
                    }
                    return decision.result
                }
                is ListingDecision.NeedsRefetch -> {
                    // Loop to refetch with fresh watermark
                }
            }
        }

        return OrderedDirectoryListingResult.Failed(
            directoryPath = cleanDir,
            error = IllegalStateException("Exceeded max listing refetch attempts ($maxRefetchAttempts) for $cleanDir"),
            requestEpoch = synchronized(stateLock) { directoryStates[cleanDir]?.latestListRequestEpoch ?: 0L },
        )
    }

    private fun isExplorerStillDemandedLocked(cleanDir: String): Boolean = synchronized(stateLock) {
        val demand = demands[cleanDir] ?: return@synchronized cleanDir.isEmpty()
        demand.consumers.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY }
    }

    /**
     * Processes a transport-origin and incarnation-qualified watch event.
     */
    suspend fun handleQualifiedEvent(rawQualified: QualifiedWatchEvent) {
        if (isDisposed || isPaused) return

        val actions = synchronized(stateLock) {
            if (isDisposed || isPaused) return@synchronized null
            val cleanWatchedDir = normalizeDirectoryPath(rawQualified.watchedDirectoryPath)
            val activeHandle = activeHandles[cleanWatchedDir]
            if (activeHandle == null) {
                if (inFlightSubscriptions.contains(cleanWatchedDir)) {
                    val queue = pendingInstallationEvents.getOrPut(cleanWatchedDir) { mutableListOf() }
                    if (queue.size < WatchQueueLimits.MAX_EARLY_EVENT_COUNT) {
                        queue.add(rawQualified)
                    }
                }
                return@synchronized null
            }

            // Validate exact origin socket, subId, and subscription incarnation
            if (
                activeHandle.state.isRetired ||
                activeHandle.state.socketRef != rawQualified.originSocket ||
                activeHandle.subscription.subId != rawQualified.subId ||
                (rawQualified.subscribeIncarnation > 0L &&
                    activeHandle.state.subscribeIncarnation != rawQualified.subscribeIncarnation)
            ) {
                return@synchronized null
            }

            val seq = ++currentEventSequence
            val stamped = rawQualified.copy(
                owner = owner,
                watchedDirectoryPath = cleanWatchedDir,
                subscribeIncarnation = activeHandle.state.subscribeIncarnation,
                sequenceNumber = seq,
            )

            recordEventInBoundedHistoryLocked(stamped)

            activeHandles[cleanWatchedDir] = activeHandle.copy(
                state = activeHandle.state.copy(eventWatermark = seq)
            )
            publishSubscriptionsSnapshotLocked()

            if (stamped.hasMissingRelativeRouting) {
                // Missing or invalid relative routing: never use raw absolute path; invalidate baseline
                val targetDirs = demands.keys.toSet() + setOf(cleanWatchedDir)
                val explorerDirsToRefresh = mutableSetOf<String>()
                val docParentDirsToNotify = mutableSetOf<String>()
                for (dir in targetDirs) {
                    val state = directoryStates.getOrPut(dir) { DirectoryWatchState(dir) }
                    state.baselineInvalidated = true
                    state.lastEventSequence = seq
                    val demand = demands[dir]
                    if (demand != null) {
                        if (demand.consumers.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY }) {
                            explorerDirsToRefresh.add(dir)
                        }
                        if (demand.consumers.any { it.kind == WatchConsumerKind.OPEN_DOCUMENT_PARENT }) {
                            docParentDirsToNotify.add(dir)
                        }
                    }
                }
                EventDispatchPlan(
                    stampedEvent = stamped,
                    explorerDirsToRefresh = explorerDirsToRefresh,
                    docParentDirsToNotify = docParentDirsToNotify,
                )
            } else {
                val affectedDirs = resolveAffectedDirectoriesLocked(stamped)
                val explorerDirsToRefresh = mutableSetOf<String>()
                val docParentDirsToNotify = mutableSetOf<String>()
                for (dir in affectedDirs) {
                    val state = directoryStates.getOrPut(dir) { DirectoryWatchState(dir) }
                    state.lastEventSequence = seq
                    val demand = demands[dir]
                    if (demand != null) {
                        if (demand.consumers.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY }) {
                            if (state.inFlightListCount == 0) {
                                explorerDirsToRefresh.add(dir)
                            } else {
                                state.pendingCoalescedRefresh = true
                            }
                        }
                        if (demand.consumers.any { it.kind == WatchConsumerKind.OPEN_DOCUMENT_PARENT }) {
                            docParentDirsToNotify.add(dir)
                        }
                    }
                }
                EventDispatchPlan(
                    stampedEvent = stamped,
                    explorerDirsToRefresh = explorerDirsToRefresh,
                    docParentDirsToNotify = docParentDirsToNotify,
                )
            }
        } ?: return

        for (dir in actions.explorerDirsToRefresh) {
            scheduleCoalescedRefresh(dir)
        }
        for (dir in actions.docParentDirsToNotify) {
            onOpenDocumentParentEvent?.invoke(dir, actions.stampedEvent)
        }
    }

    private fun recordEventInBoundedHistoryLocked(event: QualifiedWatchEvent) {
        val hadOverflowEviction = eventHistory.size >= WatchQueueLimits.MAX_HISTORY_EVENT_COUNT ||
            (eventHistoryBytes + event.estimatedBytes > WatchQueueLimits.MAX_EARLY_EVENT_BYTES && eventHistory.isNotEmpty())

        eventHistory.addLast(event)
        eventHistoryBytes += event.estimatedBytes

        while (
            eventHistory.size > WatchQueueLimits.MAX_HISTORY_EVENT_COUNT ||
            (eventHistoryBytes > WatchQueueLimits.MAX_EARLY_EVENT_BYTES && eventHistory.size > 1)
        ) {
            val evicted = eventHistory.removeFirst()
            eventHistoryBytes = (eventHistoryBytes - evicted.estimatedBytes).coerceAtLeast(0L)
            oldestRetainedSequence = eventHistory.firstOrNull()?.sequenceNumber ?: (currentEventSequence + 1L)
        }

        if (hadOverflowEviction && eventHistory.isNotEmpty()) {
            oldestRetainedSequence = eventHistory.first().sequenceNumber
        }
    }

    private fun resolveAffectedDirectoriesLocked(event: QualifiedWatchEvent): Set<String> {
        val dirs = mutableSetOf<String>()
        val relPath = event.targetRelativePath
        if (relPath != null) {
            val parent = if (relPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relPath)
            dirs.add(parent)
            if (demands.containsKey(relPath)) {
                dirs.add(relPath)
            }
        }
        val relFrom = event.targetRelativeFrom
        if (relFrom != null) {
            val fromParent = if (relFrom.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relFrom)
            dirs.add(fromParent)
            if (demands.containsKey(relFrom)) {
                dirs.add(relFrom)
            }
        }
        if (dirs.isEmpty()) {
            dirs.add(event.watchedDirectoryPath)
        }
        return dirs
    }

    private fun doesEventAffectDirectory(event: QualifiedWatchEvent, cleanDir: String): Boolean {
        if (event.hasMissingRelativeRouting) return event.watchedDirectoryPath == cleanDir
        val relPath = event.targetRelativePath
        if (relPath != null) {
            val parent = if (relPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relPath)
            if (parent == cleanDir || relPath == cleanDir) return true
        }
        val relFrom = event.targetRelativeFrom
        if (relFrom != null) {
            val fromParent = if (relFrom.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relFrom)
            if (fromParent == cleanDir || relFrom == cleanDir) return true
        }
        return false
    }

    private fun isDeterministicallyReplayable(event: QualifiedWatchEvent, cleanDir: String): Boolean {
        if (event.hasMissingRelativeRouting) return false
        val kind = event.event.kind.lowercase()
        val relPath = event.targetRelativePath ?: return false
        if (relPath == cleanDir && (kind == "delete" || kind == "remove" || kind == "removed")) {
            return false
        }
        return kind in DETERMINISTIC_EVENT_KINDS
    }

    private fun replayEventsOnEntries(
        cleanDir: String,
        initialEntries: List<DirEntryDto>,
        events: List<QualifiedWatchEvent>,
    ): List<DirEntryDto> {
        val byName = initialEntries.associateBy { it.name }.toMutableMap()
        for (qualified in events) {
            val kind = qualified.event.kind.lowercase()
            val relPath = qualified.targetRelativePath ?: continue
            val relParent = if (relPath.isEmpty()) "" else FileTreeHelpers.resolveParentPath(relPath)
            val entryName = relPath.substringAfterLast('/')

            val relFrom = qualified.targetRelativeFrom
            val fromParent = relFrom?.let { if (it.isEmpty()) "" else FileTreeHelpers.resolveParentPath(it) }
            val fromName = relFrom?.substringAfterLast('/')

            when (kind) {
                "delete", "remove", "removed", "deleted" -> {
                    if (relParent == cleanDir && entryName.isNotEmpty()) {
                        byName.remove(entryName)
                    }
                }
                "rename", "move", "moved", "renamed" -> {
                    val movedEntry = if (fromParent == cleanDir && !fromName.isNullOrEmpty()) {
                        byName.remove(fromName)
                    } else {
                        null
                    }
                    if (relParent == cleanDir && entryName.isNotEmpty()) {
                        byName[entryName] = (movedEntry ?: DirEntryDto(name = entryName, kind = "file")).copy(
                            name = entryName
                        )
                    }
                }
                "create", "created", "create_file", "create_dir", "modify", "modified", "change" -> {
                    if (relParent == cleanDir && entryName.isNotEmpty()) {
                        val existing = byName[entryName]
                        val inferredKind = if (kind == "create_dir") "dir" else (existing?.kind ?: "file")
                        byName[entryName] = existing ?: DirEntryDto(name = entryName, kind = inferredKind)
                    }
                }
            }
        }
        return byName.values.toList()
    }

    private fun scheduleCoalescedRefresh(cleanDir: String) {
        val shouldStart = synchronized(stateLock) {
            if (isDisposed || isPaused) return
            val dirState = directoryStates.getOrPut(cleanDir) { DirectoryWatchState(cleanDir) }
            if (dirState.isRefreshRunning || dirState.inFlightListCount > 0) {
                dirState.pendingCoalescedRefresh = true
                false
            } else {
                dirState.isRefreshRunning = true
                dirState.pendingCoalescedRefresh = false
                true
            }
        }
        if (!shouldStart) return

        coroutineScope.launch {
            while (true) {
                if (isDisposed || isPaused) break
                onRefetchExplorerDirectory?.invoke(cleanDir)
                val runAgain = synchronized(stateLock) {
                    val state = directoryStates[cleanDir]
                    if (state != null && state.pendingCoalescedRefresh && !isDisposed && !isPaused) {
                        state.pendingCoalescedRefresh = false
                        true
                    } else {
                        state?.isRefreshRunning = false
                        false
                    }
                }
                if (!runAgain) break
            }
        }
    }

    /**
     * Handles server or client overflow on a watched directory:
     * 1. Retires the dropped/overflowed subscription and invalidates baseline.
     * 2. Recreates the subscription FIRST on the live socket.
     * 3. Refetches affected directory listings and open-document metadata.
     */
    suspend fun handleSubscriptionOverflow(
        directoryPath: String,
        originSocket: SocketInstanceRef?,
        message: String,
        expectedSubId: ULong? = null,
        expectedIncarnation: Long? = null,
    ) {
        if (isDisposed || isPaused) return
        val cleanDir = normalizeDirectoryPath(directoryPath)

        val retiredHandle = synchronized(stateLock) {
            if (isDisposed || isPaused) return@synchronized null
            val currentHandle = activeHandles[cleanDir] ?: return@synchronized null
            if (originSocket != null && currentHandle.state.socketRef != originSocket) {
                return@synchronized null
            }
            if (expectedSubId != null && expectedSubId > 0uL && currentHandle.subscription.subId != expectedSubId) {
                return@synchronized null
            }
            if (expectedIncarnation != null && expectedIncarnation > 0L && currentHandle.state.subscribeIncarnation != expectedIncarnation) {
                return@synchronized null
            }

            _isWriteReady.value = false
            val retired = currentHandle.copy(state = currentHandle.state.copy(isRetired = true))
            activeHandles.remove(cleanDir)
            publishSubscriptionsSnapshotLocked()

            val dirState = directoryStates.getOrPut(cleanDir) { DirectoryWatchState(cleanDir) }
            dirState.baselineInvalidated = true
            retired
        } ?: return

        retiredHandle.subscription.cancel()
        onOverflowNotice?.invoke(cleanDir, message)

        // Step 1: Recreate dropped subscription BEFORE refetching
        val newSubState = try {
            ensureSubscribed(cleanDir)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            null
        }
        if (newSubState == null) return

        // Step 2: Refetch explorer directory if demanded
        val hasExplorerDemand = synchronized(stateLock) {
            demands[cleanDir]?.consumers?.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY } == true
        }
        val explorerOk = if (hasExplorerDemand) {
            onRefetchExplorerDirectory?.invoke(cleanDir) ?: true
        } else {
            true
        }

        // Step 3: Notify/reconcile open document parent consumers
        val hasDocDemand = synchronized(stateLock) {
            demands[cleanDir]?.consumers?.any { it.kind == WatchConsumerKind.OPEN_DOCUMENT_PARENT } == true
        }
        val docsOk = if (hasDocDemand) {
            onOpenDocumentParentEvent?.invoke(cleanDir, null)
            onReconcileOpenDocumentParents?.invoke(setOf(cleanDir), newSubState.socketRef) ?: true
        } else {
            true
        }

        synchronized(stateLock) {
            val currentSocket = repository.wsConnection.activeSocketRef()
            val allStillSubscribed = demands.values
                .filter { it.isDemanded }
                .all { d -> hasActiveSubscriptionLocked(d.directoryPath, currentSocket) }
            val noInvalidatedBaselines = directoryStates.values.none { it.baselineInvalidated }
            if (
                !isDisposed &&
                !isPaused &&
                explorerOk &&
                docsOk &&
                currentSocket == newSubState.socketRef &&
                allStillSubscribed &&
                noInvalidatedBaselines
            ) {
                _isWriteReady.value = true
            }
        }
    }

    /**
     * Pauses all active watches on background transition while preserving logical demands.
     */
    suspend fun pause() {
        val handlesToCancel = synchronized(stateLock) {
            if (isPaused) return@synchronized emptyList<ActiveWatchHandle>()
            isPaused = true
            _isWriteReady.value = false
            reconciliationEpoch += 1
            directoryStates.values.forEach { state ->
                state.refreshJob?.cancel()
                state.refreshJob = null
                state.pendingCoalescedRefresh = false
                state.latestListRequestEpoch += 1
            }
            val list = activeHandles.values.toList()
            activeHandles.clear()
            publishSubscriptionsSnapshotLocked()
            list
        }
        handlesToCancel.forEach { it.subscription.cancel() }
    }

    /**
     * Resumes watches on foreground transition:
     * 1. Subscribes all demanded directories on the active socket first.
     * 2. Reconciles loaded explorer directories and open-document parents.
     * 3. Enables write readiness only after all reconciliations succeed on the current authority.
     */
    suspend fun resume(): Boolean {
        synchronized(stateLock) {
            if (isDisposed) return false
            isPaused = false
            _isWriteReady.value = false
        }
        return reconcileAllDemands()
    }

    /**
     * Reconciles all demanded directories on the current active socket before enabling writes.
     */
    suspend fun reconcileAllDemands(): Boolean {
        if (isDisposed || isPaused) return false
        val targetSocket = repository.wsConnection.activeSocketRef() ?: run {
            _isWriteReady.value = false
            return false
        }

        val (myReconcileEpoch, demandedDirs, explorerDirs, docParentDirs) = synchronized(stateLock) {
            if (isDisposed || isPaused) return false
            _isWriteReady.value = false
            if (boundSocketRef != targetSocket) {
                retireAllHandlesForSocketChangeLocked(targetSocket)
                boundSocketRef = targetSocket
            }
            val epoch = ++reconciliationEpoch
            val activeDemands = demands.values.filter { it.isDemanded }
            val allDirs = activeDemands.map { it.directoryPath }
            val expDirs = activeDemands
                .filter { d -> d.consumers.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY } }
                .map { it.directoryPath }
            val docDirs = activeDemands
                .filter { d -> d.consumers.any { it.kind == WatchConsumerKind.OPEN_DOCUMENT_PARENT } }
                .map { it.directoryPath }
                .toSet()
            Quadruple(epoch, allDirs, expDirs, docDirs)
        }

        // 1. Subscribe all demanded directories FIRST
        for (dir in demandedDirs) {
            if (isDisposed || isPaused) return false
            val state = try {
                ensureSubscribed(dir)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                null
            }
            val stillDemanded = synchronized(stateLock) { demands[dir]?.isDemanded == true }
            if (stillDemanded && (state == null || state.socketRef != targetSocket)) {
                return false
            }
        }

        // 2. Refetch explorer directories
        for (dir in explorerDirs) {
            if (isDisposed || isPaused) return false
            val ok = try {
                onRefetchExplorerDirectory?.invoke(dir) ?: true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                false
            }
            val stillExplorerDemanded = synchronized(stateLock) {
                demands[dir]?.consumers?.any { it.kind == WatchConsumerKind.EXPLORER_EXPANDED_DIRECTORY } == true
            }
            if (stillExplorerDemanded && !ok) {
                return false
            }
        }

        // 3. Reconcile open-document parent directories
        if (docParentDirs.isNotEmpty()) {
            val docsOk = try {
                for (dir in docParentDirs) {
                    onOpenDocumentParentEvent?.invoke(dir, null)
                }
                onReconcileOpenDocumentParents?.invoke(docParentDirs, targetSocket) ?: true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                false
            }
            if (!docsOk) {
                return false
            }
        }

        return synchronized(stateLock) {
            val currentSocket = repository.wsConnection.activeSocketRef()
            val allStillSubscribed = demands.values
                .filter { it.isDemanded }
                .all { d -> hasActiveSubscriptionLocked(d.directoryPath, targetSocket) }
            val ready = !isDisposed &&
                !isPaused &&
                reconciliationEpoch == myReconcileEpoch &&
                currentSocket == targetSocket &&
                allStillSubscribed
            _isWriteReady.value = ready
            ready
        }
    }

    private fun retireAllHandlesForSocketChangeLocked(newSocket: SocketInstanceRef?) {
        val iterator = activeHandles.iterator()
        while (iterator.hasNext()) {
            val (_, handle) = iterator.next()
            if (handle.state.socketRef != newSocket) {
                handle.subscription.cancel()
                iterator.remove()
            }
        }
        directoryStates.values.forEach { state ->
            state.baselineInvalidated = true
        }
        publishSubscriptionsSnapshotLocked()
    }

    private fun publishSubscriptionsSnapshotLocked() {
        _activeSubscriptions.value = activeHandles.mapValues { it.value.state }
    }

    fun dispose() {
        isDisposed = true
        _isWriteReady.value = false
        fallbackSubscriptionManager.dispose()
        coroutineScope.launch {
            val handles = synchronized(stateLock) {
                directoryStates.values.forEach { it.refreshJob?.cancel() }
                directoryStates.clear()
                demands.clear()
                eventHistory.clear()
                eventHistoryBytes = 0L
                val list = activeHandles.values.toList()
                activeHandles.clear()
                publishSubscriptionsSnapshotLocked()
                list
            }
            handles.forEach { it.subscription.cancel() }
        }
    }

    private sealed interface ListingDecision {
        data object Superseded : ListingDecision
        data object NeedsRefetch : ListingDecision
        data class Publish(val result: OrderedDirectoryListingResult.Published) : ListingDecision
    }

    private data class EventDispatchPlan(
        val stampedEvent: QualifiedWatchEvent,
        val explorerDirsToRefresh: Set<String>,
        val docParentDirsToNotify: Set<String>,
    )

    private data class Quadruple<A, B, C, D>(
        val first: A,
        val second: B,
        val third: C,
        val fourth: D,
    )

    companion object {
        const val DEFAULT_EXPLORER_CONSUMER = "explorer-tree"

        private val DETERMINISTIC_EVENT_KINDS = setOf(
            "delete",
            "remove",
            "removed",
            "deleted",
            "rename",
            "move",
            "moved",
            "renamed",
            "create",
            "created",
            "create_file",
            "create_dir",
            "modify",
            "modified",
            "change",
        )

        fun resolveEffectiveOwner(
            repoOwner: WorkspaceFileOwner,
            target: ProjectTargetRef,
        ): WorkspaceFileOwner {
            return if (repoOwner.project == "*") {
                repoOwner.copy(
                    profileId = target.profileId ?: repoOwner.profileId,
                    project = target.project,
                    worktreePath = target.worktreePath ?: repoOwner.worktreePath,
                )
            } else {
                repoOwner
            }
        }
    }
}
