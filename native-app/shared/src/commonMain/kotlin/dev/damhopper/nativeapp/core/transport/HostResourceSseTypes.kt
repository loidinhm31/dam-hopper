package dev.damhopper.nativeapp.core.transport

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class HostResourceStatusEvent(
    val serverEpoch: String,
    val revision: String, // Decimal string representation of u64
    val snapshotAgeMs: Long? = null,
    val metricsAgeMs: Long? = null,
    val freshnessTtlMs: Long,
)

@Serializable
data class HostResourceDataEvent(
    val schemaVersion: Int,
    val serverEpoch: String,
    val revision: String, // Decimal string representation of u64
    val snapshot: JsonElement,
    val metrics: JsonElement,
    val lightSampleMs: Long,
)

@Serializable
data class HostResourceErrorEvent(
    val code: String,
    val error: String,
)

/**
 * Frames emitted by HostResourceSseClient.
 */
sealed class HostResourceSseFrame {
    data class Status(val status: HostResourceStatusEvent) : HostResourceSseFrame()

    /**
     * Complete data frame paired with its immediately preceding status frame
     * having identical serverEpoch and revision.
     */
    data class PairedData(
        val status: HostResourceStatusEvent,
        val data: HostResourceDataEvent,
    ) : HostResourceSseFrame()

    data class ErrorControl(val error: HostResourceErrorEvent) : HostResourceSseFrame()
}
