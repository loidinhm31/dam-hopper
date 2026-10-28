package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class RecoveryPhase {
    STOPPED,
    CONNECTING,
    WAITING_RETRY,
    CONNECTED,
    PAUSED_BACKGROUND,
    WAITING_NETWORK,
    AUTH_BLOCKED,
    CONFIGURATION_BLOCKED
}

data class RecoverySnapshot(
    val owner: ConnectionRef,
    val phase: RecoveryPhase,
    val socketRef: SocketInstanceRef? = null,
    val attempt: Int = 0,
    val nextDelayMillis: Long? = null,
    val reason: String? = null,
)

/**
 * Retained, owner-scoped WebSocket connection recovery supervisor.
 *
 * Ensures:
 * - At most one active connect attempt or scheduled retry per runtime.
 * - Exponential backoff with jitter on transient failures; resets after 30s stable connection.
 * - Stops generic retries on MFA or login requirements (4401/4403).
 * - Immediate reconnect wake on foreground resume or network restoration.
 */
class WsRecoverySupervisor(
    val wsConnection: WsConnection,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default),
) {
    val owner: ConnectionRef get() = wsConnection.connection

    private val mutex = Mutex()
    private val _snapshot = MutableStateFlow(RecoverySnapshot(owner, RecoveryPhase.STOPPED))
    val snapshot: StateFlow<RecoverySnapshot> = _snapshot.asStateFlow()

    private var activeJob: Job? = null
    private var stateObserverJob: Job? = null
    private var stabilityTimerJob: Job? = null
    private var failureCount = 0
    private var isIntentActive = false
    private var isPausedForBackground = false
    private var isNetworkAvailable = true
    private var isAuthBlocked = false
    private var isConfigurationBlocked = false
    private var wasBackgrounded = false
    fun start() {
        scope.launch {
            mutex.withLock {
                if (isIntentActive) return@withLock
                isIntentActive = true
                isAuthBlocked = false
                isConfigurationBlocked = false
                wasBackgrounded = false
                startObserverLocked()
                scheduleAttemptLocked(immediate = true, reason = "Supervisor started")
            }
        }
    }

    suspend fun stopSuspended() = mutex.withLock {
        isIntentActive = false
        isAuthBlocked = false
        isConfigurationBlocked = false
        wasBackgrounded = false
        activeJob = null
        stabilityTimerJob?.cancel()
        stabilityTimerJob = null
        stateObserverJob?.cancel()
        stateObserverJob = null
        _snapshot.value = RecoverySnapshot(owner, RecoveryPhase.STOPPED)
        try {
            wsConnection.disconnect()
        } catch (_: Throwable) {}
    }

    fun stop() {
        scope.launch {
            stopSuspended()
        }
    }

    private fun isAuthOrConfigurationBlocked(): Boolean = isAuthBlocked || isConfigurationBlocked

    fun requestRecovery(reason: String, expectedSocket: SocketInstanceRef? = null) {
        scope.launch {
            mutex.withLock {
                if (!isIntentActive || isPausedForBackground || !isNetworkAvailable || isAuthOrConfigurationBlocked()) return@withLock
                val currentSocket = wsConnection.activeSocketRef()
                if (expectedSocket != null && currentSocket != null && currentSocket != expectedSocket) {
                    return@withLock
                }
                activeJob?.cancel()
                scheduleAttemptLocked(immediate = true, reason = reason)
            }
        }
    }

    fun onForeground() {
        scope.launch {
            mutex.withLock {
                if (!isIntentActive || isAuthOrConfigurationBlocked()) return@withLock
                isPausedForBackground = false
                wasBackgrounded = false
                val current = wsConnection.state.value
                if (current !is WsState.Connected) {
                    activeJob?.cancel()
                    scheduleAttemptLocked(immediate = true, reason = "Foreground resume")
                }
            }
        }
    }

    fun onBackground() {
        scope.launch {
            mutex.withLock {
                if (!isIntentActive) return@withLock
                isPausedForBackground = true
                wasBackgrounded = true
                if (_snapshot.value.phase == RecoveryPhase.WAITING_RETRY || _snapshot.value.phase == RecoveryPhase.CONNECTING) {
                    activeJob?.cancel()
                    _snapshot.value = _snapshot.value.copy(phase = RecoveryPhase.PAUSED_BACKGROUND)
                }
            }
        }
    }

    fun onNetworkAvailable() {
        scope.launch {
            mutex.withLock {
                isNetworkAvailable = true
                if (!isIntentActive || isPausedForBackground || isAuthOrConfigurationBlocked()) return@withLock
                val current = wsConnection.state.value
                if (current is WsState.Connected) {
                    try {
                        wsConnection.disconnect()
                    } catch (_: Throwable) {}
                }
                activeJob?.cancel()
                scheduleAttemptLocked(immediate = true, reason = "Network route change")
            }
        }
    }

    fun onNetworkLost() {
        scope.launch {
            mutex.withLock {
                isNetworkAvailable = false
                if (!isIntentActive || isAuthOrConfigurationBlocked()) return@withLock
                activeJob?.cancel()
                _snapshot.value = _snapshot.value.copy(phase = RecoveryPhase.WAITING_NETWORK, reason = "Network lost")
            }
        }
    }
    suspend fun awaitConnected(): SocketInstanceRef? {
        val current = _snapshot.value
        if (current.phase == RecoveryPhase.CONNECTED && current.socketRef != null) {
            return current.socketRef
        }
        if (current.phase == RecoveryPhase.AUTH_BLOCKED || current.phase == RecoveryPhase.CONFIGURATION_BLOCKED) {
            return null
        }
        return snapshot.first {
            it.phase == RecoveryPhase.CONNECTED ||
                it.phase == RecoveryPhase.AUTH_BLOCKED ||
                it.phase == RecoveryPhase.CONFIGURATION_BLOCKED ||
                it.phase == RecoveryPhase.STOPPED
        }.socketRef
    }

    private fun startObserverLocked() {
        stateObserverJob?.cancel()
        stateObserverJob = scope.launch {
            wsConnection.state.collect { state ->
                handleStateChange(state)
            }
        }
    }

    private suspend fun handleStateChange(state: WsState) = mutex.withLock {
        if (!isIntentActive) return@withLock
        when (state) {
            is WsState.Connected -> {
                stabilityTimerJob?.cancel()
                _snapshot.value = RecoverySnapshot(
                    owner = owner,
                    phase = RecoveryPhase.CONNECTED,
                    socketRef = state.socketRef,
                    attempt = failureCount,
                )
                stabilityTimerJob = scope.launch {
                    delay(WsRecoveryPolicy.STABLE_RESET_THRESHOLD_MILLIS)
                    mutex.withLock {
                        if (wsConnection.state.value is WsState.Connected) {
                            failureCount = 0
                        }
                    }
                }
            }
            is WsState.Connecting -> {
                _snapshot.value = _snapshot.value.copy(phase = RecoveryPhase.CONNECTING)
            }
            is WsState.Disconnected, is WsState.Error, is WsState.AuthUnavailable, is WsState.Overflow,
            is WsState.MfaRequired, is WsState.LoginRequired -> {
                stabilityTimerJob?.cancel()
                when (val action = WsRecoveryPolicy.classify(state, failureCount)) {
                    is WsRecoveryAction.AuthBlocked -> {
                        isAuthBlocked = true
                        activeJob?.cancel()
                        activeJob = null
                        _snapshot.value = RecoverySnapshot(owner, RecoveryPhase.AUTH_BLOCKED, reason = action.reason)
                        return@withLock
                    }
                    is WsRecoveryAction.ConfigurationBlocked -> {
                        isConfigurationBlocked = true
                        activeJob?.cancel()
                        activeJob = null
                        _snapshot.value = RecoverySnapshot(owner, RecoveryPhase.CONFIGURATION_BLOCKED, reason = action.reason)
                        return@withLock
                    }
                    is WsRecoveryAction.Retry -> {
                        failureCount = action.failureCount
                        if (isPausedForBackground) {
                            _snapshot.value = RecoverySnapshot(owner, RecoveryPhase.PAUSED_BACKGROUND, reason = "Backgrounded")
                            return@withLock
                        }
                        if (!isNetworkAvailable) {
                            _snapshot.value = RecoverySnapshot(owner, RecoveryPhase.WAITING_NETWORK, reason = "No network")
                            return@withLock
                        }
                        scheduleAttemptLocked(immediate = false, delayMillis = action.delayMillis, reason = action.reason)
                    }
                    is WsRecoveryAction.Stop -> Unit
                }
            }
        }
    }

    private fun scheduleAttemptLocked(immediate: Boolean = false, delayMillis: Long = 0L, reason: String = "") {
        if (!isIntentActive || isPausedForBackground || !isNetworkAvailable || isAuthBlocked || isConfigurationBlocked) return
        activeJob?.cancel()
        val delayTime = if (immediate) 0L else delayMillis
        _snapshot.value = RecoverySnapshot(
            owner = owner,
            phase = if (delayTime > 0L) RecoveryPhase.WAITING_RETRY else RecoveryPhase.CONNECTING,
            attempt = failureCount,
            nextDelayMillis = if (delayTime > 0L) delayTime else null,
            reason = reason,
        )
        activeJob = scope.launch {
            try {
                if (delayTime > 0L) {
                    delay(delayTime)
                }
                if (!isActive) return@launch
                wsConnection.connect()
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                AppLogger.recordDiagnostic(
                    type = "transport",
                    scope = "ws-recovery",
                    message = "attempt_failed",
                    profileId = owner.profileId,
                    generation = owner.generation,
                    metadata = mapOf("error" to (t.message ?: "unknown"))
                )
            }
        }
    }
}
