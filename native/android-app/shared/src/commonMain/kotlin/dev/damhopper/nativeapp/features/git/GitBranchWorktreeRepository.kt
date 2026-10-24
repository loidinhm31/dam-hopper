package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Handles Git branch mutations and worktree management against /api/git/... endpoints.
 */
class GitBranchWorktreeRepository(
    val apiClient: ApiClient,
) {
    suspend fun createBranch(project: String, request: CreateBranchRequest): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(CreateBranchRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/branches", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun checkoutBranch(project: String, request: CheckoutBranchRequest): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(CheckoutBranchRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/branches/checkout", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun deleteBranch(project: String, request: DeleteBranchRequest): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(DeleteBranchRequest.serializer(), request)
        val text = apiClient.deleteJson("/api/git/$encodedProject/branches", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun updateBranch(project: String, request: UpdateBranchRequest): BranchUpdateResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(UpdateBranchRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/branches/update", body)
        return ProtocolJson.decodeFromString(BranchUpdateResult.serializer(), text)
    }

    suspend fun listWorktrees(project: String): List<ProjectWorktree> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val text = apiClient.get("/api/git/$encodedProject/worktrees")
        return ProtocolJson.decodeFromString(ListSerializer(ProjectWorktree.serializer()), text)
    }

    suspend fun addWorktree(project: String, request: AddWorktreeRequest): ProjectWorktree {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(AddWorktreeRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/worktrees", body)
        return ProtocolJson.decodeFromString(ProjectWorktree.serializer(), text)
    }

    suspend fun removeWorktree(project: String, path: String, force: Boolean? = null): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            RemoveWorktreeRequest.serializer(),
            RemoveWorktreeRequest(path, force)
        )
        val text = apiClient.deleteJson("/api/git/$encodedProject/worktrees", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun pruneWorktrees(project: String): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val text = apiClient.postJson("/api/git/$encodedProject/worktrees/prune", "{}")
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }
}
