package dev.damhopper.nativeapp.features.agents

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer

/**
 * Repository for interacting with remote server Agent Import endpoints.
 */
class AgentImportRepository(
    val apiClient: ApiClient
) {
    /**
     * Trigger a shallow Git clone and scan of a remote repository on the server.
     */
    suspend fun scanRepo(repoUrl: String): Result<ScanRepoResponse> = runCatching {
        val body = ProtocolJson.encodeToString(ScanRepoRequest.serializer(), ScanRepoRequest(repoUrl))
        val responseText = apiClient.postJson("/api/agent-import/scan", body)
        ProtocolJson.decodeFromString(ScanRepoResponse.serializer(), responseText)
    }

    /**
     * Scan a server-local directory for importable agent items.
     */
    suspend fun scanLocal(dirPath: String): Result<ScanLocalResponse> = runCatching {
        val body = ProtocolJson.encodeToString(ScanLocalRequest.serializer(), ScanLocalRequest(dirPath))
        val responseText = apiClient.postJson("/api/agent-import/scan-local", body)
        ProtocolJson.decodeFromString(ScanLocalResponse.serializer(), responseText)
    }

    /**
     * Confirm import of selected items into the server's central Agent Store.
     * When importing from a remote repo clone, cleanup should be true.
     * When importing from a server-local directory, cleanup should be false.
     */
    suspend fun confirmImport(
        sourceDir: String,
        items: List<RepoScanItem>,
        cleanup: Boolean
    ): Result<List<ImportResult>> = runCatching {
        val request = ImportConfirmRequest(
            sourceDir = sourceDir,
            items = items,
            cleanup = cleanup
        )
        val body = ProtocolJson.encodeToString(ImportConfirmRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-import/confirm", body)
        ProtocolJson.decodeFromString(ListSerializer(ImportResult.serializer()), responseText)
    }
}
