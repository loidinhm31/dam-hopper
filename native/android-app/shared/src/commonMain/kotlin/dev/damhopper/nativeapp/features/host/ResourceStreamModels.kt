package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.Serializable

/**
 * 7 authoritative source modes for host resource stream coordination.
 */
enum class ResourceSourceMode {
    STOPPED,
    STARTING,
    LIVE,
    RETRY_WAIT,
    REST_ONLY,
    AUTH_BLOCKED,
    PAUSED,
}

/**
 * Consumer categories for reference-counted demand tracking.
 */
enum class ResourceConsumerKind {
    FLEET,
    DETAIL_SNAPSHOT,
    DETAIL_METRICS,
}

/**
 * Projected freshness of snapshot and metrics observations against server TTL.
 */
@Serializable
data class ProjectionFreshness(
    val serverEpoch: String,
    val revision: String,
    val snapshotAgeMs: Long?,
    val metricsAgeMs: Long?,
    val freshnessTtlMs: Long,
    val localReceivedAtMs: Long,
) {
    fun currentSnapshotAge(nowMs: Long): Long? {
        val base = snapshotAgeMs ?: return null
        return (base + (nowMs - localReceivedAtMs)).coerceAtLeast(0L)
    }

    fun currentMetricsAge(nowMs: Long): Long? {
        val base = metricsAgeMs ?: return null
        return (base + (nowMs - localReceivedAtMs)).coerceAtLeast(0L)
    }

    fun isSnapshotStale(nowMs: Long): Boolean {
        val age = currentSnapshotAge(nowMs) ?: return false
        return age > freshnessTtlMs
    }

    fun isMetricsStale(nowMs: Long): Boolean {
        val age = currentMetricsAge(nowMs) ?: return false
        return age > freshnessTtlMs
    }
}

/**
 * Immutable snapshot of current resource source state for UI presentation.
 */
data class ResourceSourceState(
    val mode: ResourceSourceMode = ResourceSourceMode.STOPPED,
    val sourceGeneration: Long = 1L,
    val switching: Boolean = false,
    val freshness: ProjectionFreshness? = null,
    val lastCommittedRevision: ULong? = null,
    val lastCommittedEpoch: String? = null,
    val latestSnapshot: HostResourceSnapshotV1? = null,
    val latestMetrics: HostMetrics? = null,
)
