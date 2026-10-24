package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Repository for workspace discovery, project listing, git worktrees,
 * known workspace registry, and remote workspace initialization/switching.
 */
class WorkspaceRepository(
    val apiClient: ApiClient,
    val targetStore: ProjectTargetStore? = null,
) {
    suspend fun getWorkspaceStatus(): WorkspaceStatus {
        val text = apiClient.get("/api/workspace/status")
        return ProtocolJson.decodeFromString(WorkspaceStatus.serializer(), text)
    }

    suspend fun getWorkspaceInfo(): WorkspaceInfo {
        val text = apiClient.get("/api/workspace")
        return ProtocolJson.decodeFromString(WorkspaceInfo.serializer(), text)
    }

    suspend fun listProjects(): List<ProjectSummary> {
        val text = apiClient.get("/api/projects")
        return ProtocolJson.decodeFromString(ListSerializer(ProjectSummary.serializer()), text)
    }

    suspend fun getProject(name: String): ProjectSummary {
        val encodedName = ApiClient.encodePathSegment(name)
        val text = apiClient.get("/api/projects/$encodedName")
        return ProtocolJson.decodeFromString(ProjectSummary.serializer(), text)
    }

    suspend fun listWorktrees(project: String): List<ProjectWorktree> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val text = apiClient.get("/api/git/$encodedProject/worktrees")
        val worktrees = ProtocolJson.decodeFromString(ListSerializer(ProjectWorktree.serializer()), text)
        targetStore?.let { store ->
            val status = try { getWorkspaceStatus() } catch (_: Exception) { null }
            store.setKnownWorktrees(
                profileId = apiClient.connection.profileId,
                workspaceConfigPath = status?.configPath,
                project = project,
                worktrees = worktrees,
            )
        }
        return worktrees
    }

    suspend fun listKnownWorkspaces(): KnownWorkspacesResponse {
        val text = apiClient.get("/api/workspace/known")
        return ProtocolJson.decodeFromString(KnownWorkspacesResponse.serializer(), text)
    }

    suspend fun addKnownWorkspace(path: String, name: String? = null): Boolean {
        val body = buildJsonObject {
            put("path", path)
            if (name != null) put("name", name)
        }.toString()
        val text = apiClient.postJson("/api/workspace/known", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun removeKnownWorkspace(path: String): Boolean {
        val body = buildJsonObject {
            put("path", path)
        }.toString()
        val text = apiClient.deleteJson("/api/workspace/known", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun discoverProjects(path: String): DiscoverProjectsResponse {
        val text = apiClient.get("/api/workspace/discover", mapOf("path" to path))
        return ProtocolJson.decodeFromString(DiscoverProjectsResponse.serializer(), text)
    }

    suspend fun initWorkspace(path: String): Boolean {
        val body = buildJsonObject {
            put("path", path)
        }.toString()
        val text = apiClient.postJson("/api/workspace/init", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    /**
     * Changes active workspace on the remote server.
     * WARNING: Reinitializes server workspace and disposes ALL remote PTY sessions.
     * On success, invalidates local targetStore cache and bumps workspace revision.
     */
    suspend fun switchWorkspace(path: String): Boolean {
        val body = buildJsonObject {
            put("path", path)
        }.toString()
        val text = apiClient.postJson("/api/workspace/switch", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        val ok = obj["ok"]?.jsonPrimitive?.booleanOrNull == true
        if (ok) {
            targetStore?.invalidateWorkspace(apiClient.connection.profileId, path)
        }
        return ok
    }
}
