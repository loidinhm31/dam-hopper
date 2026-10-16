package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.Serializable

@Serializable
data class UsageRange(
    val from: Long,
    val to: Long,
    val bucket: String,
)

@Serializable
data class TokenAggregate(
    val inputTokens: ULong? = null,
    val cachedInputTokens: ULong? = null,
    val outputTokens: ULong? = null,
    val reasoningTokens: ULong? = null,
    val responseCount: ULong = 0uL,
    val durationMs: ULong? = null,
)

@Serializable
data class UsageTimeBucket(
    val startUtcMs: Long,
    val codex: TokenAggregate? = null,
)

@Serializable
data class CollectorHealthSnapshot(
    val dropped: ULong = 0uL,
    val droppedMissingIdentity: ULong = 0uL,
    val droppedInvalidTimestamp: ULong = 0uL,
    val droppedPaused: ULong = 0uL,
    val droppedQueueFull: ULong = 0uL,
    val droppedWorkerUnavailable: ULong = 0uL,
)

@Serializable
data class UsageHealth(
    val available: Boolean,
    val paused: Boolean,
    val writerErrors: ULong = 0uL,
    val rejectedEvents: ULong = 0uL,
    val sampledAt: Long = 0L,
    val collector: CollectorHealthSnapshot = CollectorHealthSnapshot(),
)

@Serializable
data class UsageSummaryResponse(
    val range: UsageRange,
    val codex: TokenAggregate? = null,
    val timeSeries: List<UsageTimeBucket> = emptyList(),
    val health: UsageHealth,
)

@Serializable
data class SessionRange(
    val from: Long,
    val to: Long,
)

@Serializable
data class SessionTokens(
    val inputTokens: ULong? = null,
    val cachedInputTokens: ULong? = null,
    val outputTokens: ULong? = null,
    val reasoningTokens: ULong? = null,
    val responseCount: ULong = 0uL,
    val durationMs: ULong? = null,
)

@Serializable
data class ExecutorModelDto(
    val model: String? = null,
    val responseCount: ULong = 0uL,
    val tokens: SessionTokens = SessionTokens(),
)

@Serializable
data class SessionSummaryDto(
    val id: String,
    val startedAtUtcMs: Long,
    val endedAtUtcMs: Long? = null,
    val model: String? = null,
    val tokens: SessionTokens = SessionTokens(),
    val models: List<ExecutorModelDto> = emptyList(),
)

@Serializable
data class SessionListResponse(
    val range: SessionRange,
    val sessions: List<SessionSummaryDto> = emptyList(),
    val nextCursor: String? = null,
    val paused: Boolean = false,
)

@Serializable
data class SessionDetailResponse(
    val session: SessionSummaryDto,
    val paused: Boolean = false,
)

@Serializable
data class DeleteUsageRequest(
    val confirmation: String = "delete-usage-data",
    val from: Long? = null,
    val to: Long? = null,
)

object UsageBoundsHelper {
    const val DAY_MS: Long = 86_400_000L

    fun calculateUtcDayRange(nowMs: Long, daysBack: Long): Pair<Long, Long> {
        val todayUtc = (nowMs / DAY_MS) * DAY_MS
        val fromUtc = todayUtc - (daysBack * DAY_MS)
        return Pair(fromUtc, todayUtc)
    }
}
