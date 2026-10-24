package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer

/**
 * Result wrapper for host resource REST responses.
 */
sealed class HostResourceResult<out T> {
    data class Available<T>(val data: T) : HostResourceResult<T>()
    data class Unavailable(val message: String, val statusCode: Int? = null) : HostResourceResult<Nothing>()
}

/**
 * REST repository for host resource snapshots, legacy metrics, and alert history.
 * Complements the authenticated SSE stream (/api/system/resources/v1/events) as exact-owner REST fallback.
 */
class HostResourceRepository(
    val apiClient: ApiClient,
) {
    /**
     * GET /api/system/resources/v1/snapshot
     */
    suspend fun getSnapshot(): Result<HostResourceResult<HostResourceSnapshotV1>> = runCatching {
        try {
            val responseText = apiClient.get("/api/system/resources/v1/snapshot")
            val snapshot = ProtocolJson.decodeFromString(HostResourceSnapshotV1.serializer(), responseText)
            HostResourceResult.Available(snapshot)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                HostResourceResult.Unavailable(e.message ?: "Host resource snapshot unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    /**
     * GET /api/system/metrics
     */
    suspend fun getMetrics(): Result<HostResourceResult<HostMetrics>> = runCatching {
        try {
            val responseText = apiClient.get("/api/system/metrics")
            val metrics = ProtocolJson.decodeFromString(HostMetrics.serializer(), responseText)
            HostResourceResult.Available(metrics)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                HostResourceResult.Unavailable(e.message ?: "Host metrics unavailable", e.status)
            } else {
                throw e
            }
        }
    }

    /**
     * GET /api/system/resources/v1/alerts
     */
    suspend fun getAlertHistory(): Result<HostResourceResult<List<AlertIncident>>> = runCatching {
        try {
            val responseText = apiClient.get("/api/system/resources/v1/alerts")
            val alerts = ProtocolJson.decodeFromString(ListSerializer(AlertIncident.serializer()), responseText)
            HostResourceResult.Available(alerts)
        } catch (e: ApiRequestError) {
            if (e.status == 404 || e.status == 503) {
                HostResourceResult.Unavailable(e.message ?: "Host alert history unavailable", e.status)
            } else {
                throw e
            }
        }
    }
}
