package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiRequestError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * Timer manager for ResourceStreamCoordinator.
 * Manages 10s initial data deadline, 45s byte-idle deadline, retry backoff, and 60s stable live window.
 */
class ResourceStreamTimers(
    private val coroutineScope: CoroutineScope,
    private val onInitialDataTimeout: (attempt: Int) -> Unit,
    private val onByteIdleTimeout: (attempt: Int) -> Unit,
    private val onRetryTimerElapsed: () -> Unit,
    private val onStableWindowElapsed: () -> Unit,
) {
    private var dataDeadlineJob: Job? = null
    private var byteIdleJob: Job? = null
    private var retryJob: Job? = null
    private var stableWindowJob: Job? = null

    companion object {
        const val INITIAL_DATA_DEADLINE_MS = 10_000L
        const val BYTE_IDLE_TIMEOUT_MS = 45_000L
        const val MAX_RETRY_COUNT = 5
        const val STABLE_WINDOW_MS = 60_000L
        val RETRY_DELAYS_MS = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L)

        fun computeRetryDelayMs(retryCount: Int, error: Throwable?): Long {
            val baseDelay = RETRY_DELAYS_MS.getOrElse(retryCount) { 30_000L }
            val retryAfterSeconds = (error as? ApiRequestError)?.retryAfterSeconds
            return if (retryAfterSeconds != null && retryAfterSeconds > 0) {
                (retryAfterSeconds * 1000L).coerceAtMost(60_000L)
            } else {
                val jitter = Random.nextLong(0, (baseDelay / 4).coerceAtLeast(100L))
                (baseDelay + jitter).coerceAtMost(30_000L)
            }
        }
    }

    fun armInitialDataDeadline(attempt: Int) {
        dataDeadlineJob?.cancel()
        dataDeadlineJob = coroutineScope.launch {
            delay(INITIAL_DATA_DEADLINE_MS)
            onInitialDataTimeout(attempt)
        }
    }

    fun cancelInitialDataDeadline() {
        dataDeadlineJob?.cancel()
        dataDeadlineJob = null
    }

    fun armByteIdleDeadline(attempt: Int) {
        byteIdleJob?.cancel()
        byteIdleJob = coroutineScope.launch {
            delay(BYTE_IDLE_TIMEOUT_MS)
            onByteIdleTimeout(attempt)
        }
    }

    fun armRetryTimer(delayMs: Long) {
        retryJob?.cancel()
        retryJob = coroutineScope.launch {
            delay(delayMs)
            onRetryTimerElapsed()
        }
    }

    fun armStableLiveWindow() {
        if (stableWindowJob != null && stableWindowJob?.isActive == true) return
        stableWindowJob = coroutineScope.launch {
            delay(STABLE_WINDOW_MS)
            onStableWindowElapsed()
            stableWindowJob = null
        }
    }

    fun clearAll() {
        dataDeadlineJob?.cancel()
        dataDeadlineJob = null
        byteIdleJob?.cancel()
        byteIdleJob = null
        retryJob?.cancel()
        retryJob = null
        stableWindowJob?.cancel()
        stableWindowJob = null
    }
}
