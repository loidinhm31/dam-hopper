package dev.damhopper.nativeapp.features.agents

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/**
 * Repository for interacting with remote server Agent Memory endpoints.
 */
class AgentMemoryRepository(
    val apiClient: ApiClient
) {
    /**
     * List all available memory templates on the server.
     */
    suspend fun listTemplates(): Result<List<MemoryTemplateInfo>> = runCatching {
        val responseText = apiClient.get("/api/agent-memory/templates")
        ProtocolJson.decodeFromString(ListSerializer(MemoryTemplateInfo.serializer()), responseText)
    }

    /**
     * List memory entries for all agents in a project.
     */
    suspend fun listProjectMemory(projectName: String): Result<Map<String, ProjectMemoryAgentEntry>> = runCatching {
        val encProject = ApiClient.encodePathSegment(projectName)
        val responseText = apiClient.get("/api/agent-memory/$encProject")
        ProtocolJson.decodeFromString(
            MapSerializer(String.serializer(), ProjectMemoryAgentEntry.serializer()),
            responseText
        )
    }

    /**
     * Get memory file content for a specific project and agent.
     * Item 404 returns null.
     */
    suspend fun getProjectMemory(projectName: String, agent: AgentType): Result<String?> = runCatching {
        try {
            val encProject = ApiClient.encodePathSegment(projectName)
            val encAgent = ApiClient.encodePathSegment(agent.wireName)
            val responseText = apiClient.get("/api/agent-memory/$encProject/$encAgent")
            val parsed = ProtocolJson.decodeFromString(ProjectMemoryDetailResponse.serializer(), responseText)
            parsed.content
        } catch (e: ApiRequestError) {
            if (e.status == 404) {
                null
            } else {
                throw e
            }
        }
    }

    /**
     * Update project memory file content for a specific agent.
     */
    suspend fun updateProjectMemory(
        projectName: String,
        agent: AgentType,
        content: String
    ): Result<Boolean> = runCatching {
        val encProject = ApiClient.encodePathSegment(projectName)
        val encAgent = ApiClient.encodePathSegment(agent.wireName)
        val body = ProtocolJson.encodeToString(UpdateMemoryRequest.serializer(), UpdateMemoryRequest(content))
        apiClient.putJson("/api/agent-memory/$encProject/$encAgent", body)
        true
    }

    /**
     * Apply a memory template to a project.
     * If write is true, writes to memory file directly on server.
     * Returns the rendered content.
     */
    suspend fun applyTemplate(
        projectName: String,
        agent: AgentType,
        templateName: String,
        write: Boolean = false
    ): Result<String> = runCatching {
        val request = ApplyTemplateRequest(
            projectName = projectName,
            agent = agent.wireName,
            templateName = templateName,
            write = write
        )
        val body = ProtocolJson.encodeToString(ApplyTemplateRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/agent-memory/apply", body)
        val parsed = ProtocolJson.decodeFromString(ApplyTemplateResponse.serializer(), responseText)
        parsed.content
    }
}
