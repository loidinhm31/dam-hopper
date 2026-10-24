package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class CodexExporterStatus {
    @SerialName("notConfigured")
    NOT_CONFIGURED,
    @SerialName("managed")
    MANAGED,
    @SerialName("conflict")
    CONFLICT,
}

@Serializable
data class CollectorSetup(
    val restartRequired: Boolean = false,
    val codexExporter: CodexExporterStatus = CodexExporterStatus.NOT_CONFIGURED,
    val serverRestartRequired: Boolean = false,
)

@Serializable
data class SetupCollectorStatus(
    val codexExporter: CodexExporterStatus = CodexExporterStatus.NOT_CONFIGURED,
    val restartRequired: Boolean = false,
    val serverRestartRequired: Boolean = false,
)

@Serializable
data class UsageSettingsResponse(
    val enabled: Boolean,
    val paused: Boolean,
    val detailRetentionDays: Int,
    val aggregateRetentionDays: Long? = null,
    val collectorEnabled: Boolean,
    val collectorSetup: CollectorSetup = CollectorSetup(),
    val runtime: JsonElement? = null,
)

@Serializable
data class SettingsPatchRequest(
    val enabled: Boolean? = null,
    val paused: Boolean? = null,
    val detailRetentionDays: Int? = null,
    val aggregateRetentionDays: Long? = null,
    val codexExporter: Boolean? = null,
    val retryCollector: Boolean? = null,
)

@Serializable
data class UsageSetupStatusResponse(
    val enabled: Boolean,
    val paused: Boolean,
    val collectorEnabled: Boolean,
    val collectorSetup: SetupCollectorStatus = SetupCollectorStatus(),
    val runtime: JsonElement? = null,
)

@Serializable
data class SetupPatchRequest(
    val enabled: Boolean? = null,
    val codexExporter: Boolean? = null,
    val retryCollector: Boolean? = null,
)
