package dev.damhopper.nativeapp.core.transport

import kotlin.random.Random

/**
 * Outcome category of a WebSocket termination or failure for recovery decisions.
 */
sealed class WsRecoveryAction {
    data class Retry(val delayMillis: Long, val failureCount: Int, val reason: String) : WsRecoveryAction()
    data class AuthBlocked(val reason: String, val closeCode: Short?) : WsRecoveryAction()
    data class ConfigurationBlocked(val reason: String) : WsRecoveryAction()
    data object Stop : WsRecoveryAction()
}

/**
 * Pure policy calculator for WebSocket recovery backoff, jitter, and state classification.
 */
object WsRecoveryPolicy {
    val BASE_DELAYS_MILLIS = listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L)
    const val MAX_DELAY_MILLIS = 30_000L
    const val STABLE_RESET_THRESHOLD_MILLIS = 30_000L

    fun computeNextDelay(
        failureCount: Int,
        randomFraction: Double = Random.nextDouble(),
    ): Long {
        val index = (failureCount - 1).coerceIn(0, BASE_DELAYS_MILLIS.size - 1)
        val base = BASE_DELAYS_MILLIS[index]
        // Equal jitter in range [base / 2, base]
        val min = base / 2
        val jittered = min + ((base - min) * randomFraction.coerceIn(0.0, 1.0)).toLong()
        return jittered.coerceAtMost(MAX_DELAY_MILLIS)
    }

    fun classify(
        state: WsState,
        failureCount: Int,
        randomFraction: Double = Random.nextDouble(),
    ): WsRecoveryAction {
        return when (state) {
            is WsState.Disconnected -> {
                val nextCount = failureCount + 1
                WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "Disconnected")
            }
            is WsState.Error -> {
                val cause = state.cause
                if (cause is io.ktor.client.plugins.ResponseException) {
                    val status = cause.response.status.value
                    when (status) {
                        401 -> WsRecoveryAction.AuthBlocked("Unauthorized (401)", null)
                        403 -> WsRecoveryAction.ConfigurationBlocked("AccessDenied (403)")
                        else -> {
                            val nextCount = failureCount + 1
                            WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "HttpError ($status)")
                        }
                    }
                } else if (cause is ConnectTimeoutException) {
                    val nextCount = failureCount + 1
                    WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "ConnectTimeout")
                } else {
                    val nextCount = failureCount + 1
                    WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "SocketError")
                }
            }
            is WsState.AuthUnavailable -> {
                val nextCount = failureCount + 1
                WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "AuthUnavailable (1013)")
            }
            is WsState.Overflow -> {
                val nextCount = failureCount + 1
                WsRecoveryAction.Retry(computeNextDelay(nextCount, randomFraction), nextCount, "Overflow (4001)")
            }
            is WsState.MfaRequired -> WsRecoveryAction.AuthBlocked("MfaRequired", state.closeCode)
            is WsState.LoginRequired -> WsRecoveryAction.AuthBlocked("LoginRequired", state.closeCode)
            is WsState.Connecting, is WsState.Connected -> WsRecoveryAction.Stop
        }
    }
}
