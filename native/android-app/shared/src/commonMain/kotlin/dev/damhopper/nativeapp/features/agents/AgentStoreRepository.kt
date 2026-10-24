package dev.damhopper.nativeapp.features.agents

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/**
 * Result of loading the central Agent Store item catalog.
 */
sealed class AgentStoreCatalogResult {
    data class Available(val items: List<AgentStoreItem>) : AgentStoreCatalogResult()
    data class Unavailable(val message: String) : AgentStoreCatalogResult()
}

/**
 * Repository for interacting with the remote server's Agent Store endpoints.
 */
class AgentStoreRepository(
    val apiClient: ApiClient
) {
    /**
     * List all items from the central store, optionally filtered by category.
     * Route 404 signals that Agent Store is unavailable on the remote server.
     */
    suspend fun listItems(category: AgentItemCategory? = null): Result<AgentStoreCatalogResult> = runCatching {
        try {
            val queryParams = if (category != null) mapOf("category" to category.wireName) else emptyMap()
            val responseText = apiClient.get("/api/agent-store", queryParams)
            val items = ProtocolJson.decodeFromString(ListSerializer(AgentStoreItem.serializer()), responseText)
            AgentStoreCatalogResult.Available(items)
        } catch (e: ApiRequestError) {
            if (e.status == 404) {
                AgentStoreCatalogResult.Unavailable("Agent Store is unavailable for this profile.")
            } else {
                throw e
            }
        }
    }

    /**
     * Get a specific item from the central store by category and name.
     * Item 404 returns null rather than failing the call.
     */
    suspend fun getItem(category: AgentItemCategory, name: String): Result<AgentStoreItem?> = runCatching {
        try {
            val encCat = ApiClient.encodePathSegment(category.wireName)
            val encName = ApiClient.encodePathSegment(name)
            val responseText = apiClient.get("/api/agent-store/$encCat/$encName")
            ProtocolJson.decodeFromString(AgentStoreItem.serializer(), responseText)
        } catch (e: ApiRequestError) {
            if (e.status == 404) {
                null
            } else {
                throw e
            }
        }
    }

    /**
     * Get the file content of an item in the store (e.g. SKILL.md or command markdown).
     */
    suspend fun getItemContent(
        category: AgentItemCategory,
        name: String,
        fileName: String? = null
    ): Result<String> = runCatching {
        val encCat = ApiClient.encodePathSegment(category.wireName)
        val encName = ApiClient.encodePathSegment(name)
        val queryParams = if (!fileName.isNullOrBlank()) mapOf("fileName" to fileName) else emptyMap()
        val responseText = apiClient.get("/api/agent-store/$encCat/$encName/content", queryParams)
        val parsed = ProtocolJson.decodeFromString(ItemContentResponse.serializer(), responseText)
        parsed.content
    }

    /**
     * Remove an item from the central agent store.
     */
    suspend fun removeItem(category: AgentItemCategory, name: String): Result<Boolean> = runCatching {
        val encCat = ApiClient.encodePathSegment(category.wireName)
        val encName = ApiClient.encodePathSegment(name)
        apiClient.delete("/api/agent-store/$encCat/$encName")
        true
    }

    /**
     * Ship an item to a target project for a specific agent.
     */
    suspend fun shipItem(request: ShipRequest): Result<ShipResult> = runCatching {
        val body = ProtocolJson.encodeToString(ShipRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-store/ship", body)
        ProtocolJson.decodeFromString(ShipResult.serializer(), responseText)
    }

    /**
     * Unship an item from a target project for a specific agent.
     */
    suspend fun unshipItem(request: UnshipRequest): Result<ShipResult> = runCatching {
        val body = ProtocolJson.encodeToString(UnshipRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-store/unship", body)
        ProtocolJson.decodeFromString(ShipResult.serializer(), responseText)
    }

    /**
     * Absorb a shipped item (convert symlink to project-local copy or vice-versa).
     */
    suspend fun absorbItem(request: AbsorbRequest): Result<ShipResult> = runCatching {
        val body = ProtocolJson.encodeToString(AbsorbRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-store/absorb", body)
        ProtocolJson.decodeFromString(ShipResult.serializer(), responseText)
    }

    /**
     * Bulk ship items to projects and agents.
     */
    suspend fun bulkShip(request: BulkShipRequest): Result<List<ShipResult>> = runCatching {
        val body = ProtocolJson.encodeToString(BulkShipRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-store/bulk-ship", body)
        ProtocolJson.decodeFromString(ListSerializer(ShipResult.serializer()), responseText)
    }

    /**
     * Fetch the complete distribution matrix across all items, projects, and agents.
     */
    suspend fun getMatrix(): Result<Map<String, Map<String, DistributionStatus>>> = runCatching {
        val responseText = apiClient.get("/api/agent-store/matrix")
        ProtocolJson.decodeFromString(
            MapSerializer(
                String.serializer(),
                MapSerializer(String.serializer(), DistributionStatus.serializer())
            ),
            responseText
        )
    }

    /**
     * Scan projects in the workspace for agent presence and existing items.
     */
    suspend fun scanProjects(): Result<List<ProjectAgentScanResult>> = runCatching {
        val responseText = apiClient.get("/api/agent-store/scan")
        ProtocolJson.decodeFromString(ListSerializer(ProjectAgentScanResult.serializer()), responseText)
    }

    /**
     * Run store health check for broken symlinks and orphaned items.
     */
    suspend fun healthCheck(): Result<HealthCheckResult> = runCatching {
        val responseText = apiClient.get("/api/agent-store/health")
        ProtocolJson.decodeFromString(HealthCheckResult.serializer(), responseText)
    }
}
