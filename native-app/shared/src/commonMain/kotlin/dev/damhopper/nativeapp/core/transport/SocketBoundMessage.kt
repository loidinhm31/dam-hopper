package dev.damhopper.nativeapp.core.transport

import dev.damhopper.nativeapp.core.model.SocketInstanceRef

/**
 * Transport-origin qualified message pairing a live socket instance reference
 * with the decoded ServerMsg received on that exact socket.
 */
data class SocketBoundMessage(
    val socketRef: SocketInstanceRef,
    val message: ServerMsg,
)
