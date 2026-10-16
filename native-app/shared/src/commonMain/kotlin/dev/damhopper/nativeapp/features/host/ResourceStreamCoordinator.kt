package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.HostResourceSseClient
import dev.damhopper.nativeapp.core.transport.HostResourceSseFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Coordinates SSE stream and REST fallback for a single ConnectionRef owner.
 */
class ResourceStreamCoordinator(
    val owner: ConnectionRef,
    val sseClient: HostResourceSseClient,
    val registry: ConnectionRegistry? = null,
    val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
    val timeProvider: () -> Long = { kotlinx.datetime.Clock.System.now().toEpochMilliseconds() },
) {
    private val stateMutex = Mutex()
    private val _state = MutableStateFlow(ResourceSourceState())
    val state: StateFlow<ResourceSourceState> = _state.asStateFlow()

    private val interestCounts = mutableMapOf<ResourceConsumerKind, Int>()
    private var isForeground = true
    private var authBlockedLatch = false
    private var restOnlyLatch = false
    private var streamAttempt = 0
    private var hasCommittedInCurrentAttempt = false
    private var retryCount = 0
    private var activeStreamJob: Job? = null
    private var disposed = false

    private val timers = ResourceStreamTimers(
        coroutineScope = coroutineScope,
        onInitialDataTimeout = { attempt ->
            if (!disposed && attempt == streamAttempt) {
                handleStreamFailure(attempt, ApiRequestError(message = "Initial data deadline expired", status = 408))
            }
        },
        onByteIdleTimeout = { attempt ->
            if (!disposed && attempt == streamAttempt) {
                handleStreamFailure(attempt, ApiRequestError(message = "Byte idle deadline expired", status = 408))
            }
        },
        onRetryTimerElapsed = { if (!disposed && isForeground && hasInterest()) startStreamAttempt() },
        onStableWindowElapsed = { if (!disposed && _state.value.mode == ResourceSourceMode.LIVE) retryCount = 0 },
    )

    fun hasInterest(): Boolean = interestCounts.values.any { it > 0 }

    fun registerInterest(kind: ResourceConsumerKind): () -> Unit {
        interestCounts[kind] = (interestCounts[kind] ?: 0) + 1
        evaluateLifecycle()
        var unreg = false
        return {
            if (!unreg) {
                unreg = true
                val cur = (interestCounts[kind] ?: 1) - 1
                if (cur <= 0) interestCounts.remove(kind) else interestCounts[kind] = cur
                evaluateLifecycle()
            }
        }
    }

    fun setForeground(foreground: Boolean) {
        if (isForeground == foreground) return
        isForeground = foreground
        if (!isForeground) {
            stopActiveStream()
            if (_state.value.mode in listOf(ResourceSourceMode.STARTING, ResourceSourceMode.LIVE, ResourceSourceMode.RETRY_WAIT)) {
                _state.value = _state.value.copy(mode = ResourceSourceMode.PAUSED)
            }
        } else if (_state.value.mode == ResourceSourceMode.PAUSED && hasInterest()) {
            evaluateLifecycle()
        }
    }

    fun canUseResourceRest(): Boolean {
        if (disposed || !isCurrentOwner() || !isForeground || !hasInterest()) return false
        val s = _state.value
        if (s.switching || authBlockedLatch) return false
        return s.mode in listOf(ResourceSourceMode.STARTING, ResourceSourceMode.RETRY_WAIT, ResourceSourceMode.REST_ONLY)
    }

    fun isCurrentOwner(): Boolean = registry?.let { reg -> reg.connectionsState.value[owner.profileId] == owner } ?: true

    fun evaluateLifecycle() {
        if (disposed) return
        if (!isCurrentOwner()) { dispose(); return }
        if (!isForeground || !hasInterest()) {
            stopActiveStream()
            val nextMode = if (!isForeground && hasInterest()) ResourceSourceMode.PAUSED else ResourceSourceMode.STOPPED
            _state.value = _state.value.copy(mode = nextMode)
            return
        }
        if (authBlockedLatch) { _state.value = _state.value.copy(mode = ResourceSourceMode.AUTH_BLOCKED); return }
        if (restOnlyLatch) { _state.value = _state.value.copy(mode = ResourceSourceMode.REST_ONLY); return }
        if (_state.value.mode != ResourceSourceMode.LIVE && _state.value.mode != ResourceSourceMode.STARTING) {
            startStreamAttempt()
        }
    }

    private fun startStreamAttempt() {
        stopActiveStream()
        val attempt = ++streamAttempt
        hasCommittedInCurrentAttempt = false
        _state.value = _state.value.copy(mode = ResourceSourceMode.STARTING)
        timers.armInitialDataDeadline(attempt)
        timers.armByteIdleDeadline(attempt)
        activeStreamJob = coroutineScope.launch {
            try {
                sseClient.openEventStream(
                    onByteProgress = { timers.armByteIdleDeadline(attempt) }
                ).collect { frame -> handleFrame(attempt, frame) }
            } catch (t: Throwable) {
                handleStreamFailure(attempt, t)
            }
        }
    }

    private fun handleFrame(attempt: Int, frame: HostResourceSseFrame) {
        if (disposed || attempt != streamAttempt || !isCurrentOwner()) return
        timers.armByteIdleDeadline(attempt)

        when (frame) {
            is HostResourceSseFrame.Status -> {
                ResourceFrameCommitter.updateFreshness(frame.status, _state.value, timeProvider)?.let {
                    _state.value = it
                }
            }
            is HostResourceSseFrame.PairedData -> {
                val isNew = !hasCommittedInCurrentAttempt
                val updated = ResourceFrameCommitter.commitPairedFrame(
                    frame.status, frame.data, _state.value, timeProvider, isNewAttemptBaseline = isNew
                )
                if (updated != null) {
                    hasCommittedInCurrentAttempt = true
                    timers.cancelInitialDataDeadline()
                    _state.value = updated
                    timers.armStableLiveWindow()
                }
            }
            is HostResourceSseFrame.ErrorControl -> handleCodedError(frame.error.code)
        }
    }

    suspend fun commitRestPair(snapshot: HostResourceSnapshotV1, metrics: HostMetrics): Boolean = stateMutex.withLock {
        if (!canUseResourceRest()) return false
        _state.value = _state.value.copy(
            latestSnapshot = snapshot,
            latestMetrics = metrics,
            freshness = null,
            sourceGeneration = _state.value.sourceGeneration + 1,
        )
        true
    }

    private fun handleStreamFailure(attempt: Int, error: Throwable) {
        if (disposed || attempt != streamAttempt) return
        stopActiveStream()
        when (val outcome = ResourceFailureHandler.handleFailure(error, retryCount)) {
            is FailureOutcome.AuthBlocked -> { authBlockedLatch = true; _state.value = _state.value.copy(mode = ResourceSourceMode.AUTH_BLOCKED) }
            is FailureOutcome.RestOnly -> { restOnlyLatch = true; _state.value = _state.value.copy(mode = ResourceSourceMode.REST_ONLY) }
            is FailureOutcome.Retry -> { retryCount = outcome.newRetryCount; _state.value = _state.value.copy(mode = ResourceSourceMode.RETRY_WAIT); timers.armRetryTimer(outcome.delayMs) }
        }
    }

    private fun handleCodedError(code: String) {
        stopActiveStream()
        when (ResourceFailureHandler.handleCodedError(code)) {
            is FailureOutcome.AuthBlocked -> { authBlockedLatch = true; _state.value = _state.value.copy(mode = ResourceSourceMode.AUTH_BLOCKED) }
            is FailureOutcome.RestOnly -> { restOnlyLatch = true; _state.value = _state.value.copy(mode = ResourceSourceMode.REST_ONLY) }
            null, is FailureOutcome.Retry -> {}
        }
    }

    private fun stopActiveStream() {
        timers.clearAll()
        activeStreamJob?.cancel()
        activeStreamJob = null
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        stopActiveStream()
        _state.value = _state.value.copy(mode = ResourceSourceMode.STOPPED)
    }
}
