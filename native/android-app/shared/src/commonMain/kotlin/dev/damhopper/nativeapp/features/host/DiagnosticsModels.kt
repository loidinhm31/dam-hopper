package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class DiagnosticExportRequest(
    val windowMinutes: Int? = null,
    val includeTerminalOutput: Boolean = false,
    val terminalTailBytes: Int? = null,
    val terminalIds: List<String>? = null
)

@Serializable
data class DiagnosticExportResponse(
    @SerialName("diagnostic_schema_version")
    val diagnosticSchemaVersion: Int,
    @SerialName("generated_at")
    val generatedAt: Long,
    val manifest: JsonObject? = null,
    val scope: JsonObject? = null,
    val system: JsonObject? = null
)
