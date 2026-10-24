package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class AlertState {
    @SerialName("healthy")
    HEALTHY,
    @SerialName("reclaimableCacheHigh")
    RECLAIMABLE_CACHE_HIGH,
    @SerialName("elevatedNoPressure")
    ELEVATED_NO_PRESSURE,
    @SerialName("memoryPressure")
    MEMORY_PRESSURE,
    @SerialName("oomRisk")
    OOM_RISK,
    @SerialName("limitedData")
    LIMITED_DATA,
}

@Serializable
enum class AlertSeverity {
    @SerialName("info")
    INFO,
    @SerialName("warning")
    WARNING,
    @SerialName("critical")
    CRITICAL,
}

@Serializable
enum class Confidence {
    @SerialName("low")
    LOW,
    @SerialName("medium")
    MEDIUM,
    @SerialName("high")
    HIGH,
}

@Serializable
data class AlertEvidence(
    val availablePercent: Double? = null,
    val reclaimablePercent: Double? = null,
    val psiSomeAvg10: Double? = null,
    val psiFullAvg10: Double? = null,
    val cgroupOomDelta: Boolean = false,
)

@Serializable
data class AlertSummary(
    val state: AlertState,
    val severity: AlertSeverity,
    val incidentId: String? = null,
    val openedAt: Long? = null,
    val updatedAt: Long = 0L,
    val durationSeconds: Long = 0L,
    val scope: String = "",
    val confidence: Confidence = Confidence.LOW,
    val threshold: String = "",
    val evidence: AlertEvidence = AlertEvidence(),
    val nextAction: String = "",
)

@Serializable
data class AlertIncident(
    val incidentId: String,
    val state: AlertState,
    val severity: AlertSeverity,
    val openedAt: Long,
    val updatedAt: Long,
    val resolvedAt: Long? = null,
    val durationSeconds: Long = 0L,
    val scope: String = "",
    val threshold: String = "",
    val confidence: Confidence = Confidence.LOW,
    val evidence: AlertEvidence = AlertEvidence(),
    val nextAction: String = "",
)
