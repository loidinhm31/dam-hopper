package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.SocketInstanceRef

/**
 * Standard WebSocket close codes matching server/src/api/ws.rs.
 */
object WsCloseCodes {
    /** WS close code for backpressure overflow. */
    const val CLOSE_OVERFLOW: Short = 4001
    /** Step-up or MFA challenge required. */
    const val CLOSE_MFA_REQUIRED: Short = 4403
    /** Session expired or revoked, full login required. */
    const val CLOSE_FULL_LOGIN_REQUIRED: Short = 4401
    /** Auth backend unavailable (503 / Try again later). */
    const val CLOSE_AUTH_UNAVAILABLE: Short = 1013
}

/**
 * Live WebSocket connection state machine.
 */
sealed class WsState {
    data object Disconnected : WsState()
    data object Connecting : WsState()
    data class Connected(val socketRef: SocketInstanceRef) : WsState()
    data class MfaRequired(val closeCode: Short) : WsState()
    data class LoginRequired(val closeCode: Short) : WsState()
    data class AuthUnavailable(val closeCode: Short) : WsState()
    data class Overflow(val closeCode: Short) : WsState()
    data class Error(val cause: Throwable) : WsState()
}

/**
 * Receipt proving active host:uiConnection capability on an exact live socket.
 * Revoked immediately when the socket closes, reconnects, or is retired.
 * Never persisted to disk.
 */
data class UiConnectionReceipt(
    val socketRef: SocketInstanceRef,
    val version: Int,
    val connectionId: String,
    val decisionCapability: String,
) {
    override fun toString(): String =
        "UiConnectionReceipt(socketRef=${socketRef.key}, version=$version, connectionId='$connectionId', decisionCapability=[REDACTED])"
}
