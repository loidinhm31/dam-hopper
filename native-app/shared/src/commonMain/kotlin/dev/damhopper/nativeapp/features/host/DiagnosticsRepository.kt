package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson

class DiagnosticsRepository(
    val apiClient: ApiClient
) {
    /**
     * POST /api/diagnostics/export
     *
     * Note: default request has includeTerminalOutput = false. Terminal output inclusion
     * must be an explicit deliberate user choice.
     */
    suspend fun exportDiagnostics(
        request: DiagnosticExportRequest = DiagnosticExportRequest()
    ): Result<DiagnosticExportResponse> = runCatching {
        val body = ProtocolJson.encodeToString(DiagnosticExportRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/diagnostics/export", body)
        ProtocolJson.decodeFromString(DiagnosticExportResponse.serializer(), responseText)
    }
}
