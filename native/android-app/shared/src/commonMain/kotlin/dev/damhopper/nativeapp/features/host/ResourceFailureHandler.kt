package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiRequestError

/**
 * Outcome of evaluating an SSE stream failure or coded error control.
 */
sealed class FailureOutcome {
    data object AuthBlocked : FailureOutcome()
    data object RestOnly : FailureOutcome()
    data class Retry(val delayMs: Long, val newRetryCount: Int) : FailureOutcome()
}

object ResourceFailureHandler {

    fun handleFailure(
        error: Throwable,
        currentRetryCount: Int,
    ): FailureOutcome {
        if (error is ApiRequestError) {
            if (error.code == "AUTH_UNAVAILABLE") return FailureOutcome.AuthBlocked
            if (error.code == "FRAME_TOO_LARGE" || error.status == 404 || error.status == 405) {
                return FailureOutcome.RestOnly
            }
        }
        if (currentRetryCount >= ResourceStreamTimers.MAX_RETRY_COUNT) {
            return FailureOutcome.RestOnly
        }
        val delayMs = ResourceStreamTimers.computeRetryDelayMs(currentRetryCount, error)
        return FailureOutcome.Retry(delayMs, currentRetryCount + 1)
    }

    fun handleCodedError(code: String): FailureOutcome? {
        return when (code) {
            "AUTH_UNAVAILABLE" -> FailureOutcome.AuthBlocked
            "FRAME_TOO_LARGE" -> FailureOutcome.RestOnly
            else -> null
        }
    }
}
