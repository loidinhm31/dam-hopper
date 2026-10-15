package dev.damhopper.nativeapp.core.transport

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Serializes all outgoing WebSocket application frames.
 *
 * Guarantees:
 * - JSON text frames and binary frames never interleave.
 * - Atomic JSON-header + binary frame pairs (e.g. for write_chunk_binary or upload_chunk)
 *   are transmitted consecutively without intermediate messages.
 * - If cancellation or an I/O error occurs after the JSON header is transmitted but before
 *   the binary frame completes, the connection is aborted with PROTOCOL_ERROR to prevent
 *   server deserialization mismatches or frame corruption.
 */
class SerializedWsWriter(
    private val session: WebSocketSession,
) {
    private val writeMutex = Mutex()

    /**
     * Serializes and transmits a single ClientMsg text frame.
     */
    suspend fun sendText(msg: ClientMsg) {
        val jsonText = ProtocolJson.encodeToString(ClientMsg.serializer(), msg)
        writeMutex.withLock {
            session.send(Frame.Text(jsonText))
        }
    }

    /**
     * Transmits raw binary bytes under the serialization lock.
     */
    suspend fun sendBinary(bytes: ByteArray) {
        writeMutex.withLock {
            session.send(Frame.Binary(true, bytes))
        }
    }

    /**
     * Transmits an atomic JSON header frame followed immediately by a raw binary frame.
     * Aborts the underlying WebSocket session if partial transmission occurs.
     */
    suspend fun sendAtomicPair(header: ClientMsg, binary: ByteArray) {
        val jsonText = ProtocolJson.encodeToString(ClientMsg.serializer(), header)
        writeMutex.withLock {
            var headerSent = false
            try {
                session.send(Frame.Text(jsonText))
                headerSent = true
                session.send(Frame.Binary(true, binary))
            } catch (t: Throwable) {
                if (headerSent) {
                    // Header frame reached the socket, but binary frame failed or was cancelled.
                    // Must close the session immediately to prevent protocol desynchronization.
                    try {
                        session.close(
                            CloseReason(
                                CloseReason.Codes.PROTOCOL_ERROR,
                                "Atomic binary pair aborted after header send: ${t.message}",
                            )
                        )
                    } catch (_: Throwable) {
                    }
                }
                throw t
            }
        }
    }
}
