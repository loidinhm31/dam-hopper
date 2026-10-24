package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Handles Git staging, working-tree discards, commits, fetch, pull, and normal push.
 */
class GitMutationRepository(
    val apiClient: ApiClient,
) {
    suspend fun stage(
        project: String,
        paths: List<String>,
        worktreePath: String? = null,
        root: String? = null,
    ): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            StageFilesRequest.serializer(),
            StageFilesRequest(paths = paths, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/stage", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun unstage(
        project: String,
        paths: List<String>,
        worktreePath: String? = null,
        root: String? = null,
    ): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            StageFilesRequest.serializer(),
            StageFilesRequest(paths = paths, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/unstage", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun discard(
        project: String,
        path: String,
        worktreePath: String? = null,
        root: String? = null,
    ): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            DiscardFileRequest.serializer(),
            DiscardFileRequest(path = path, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/discard", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun discardHunk(
        project: String,
        path: String,
        hunkIndex: Int,
        worktreePath: String? = null,
        root: String? = null,
    ): Boolean {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            DiscardHunkRequest.serializer(),
            DiscardHunkRequest(path = path, hunkIndex = hunkIndex, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/discard-hunk", body)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun commit(
        project: String,
        message: String,
        amend: Boolean = false,
        worktreePath: String? = null,
        root: String? = null,
    ): CommitResponse {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            CommitRequest.serializer(),
            CommitRequest(message = message, amend = amend, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/commit", body)
        return ProtocolJson.decodeFromString(CommitResponse.serializer(), text)
    }

    suspend fun fetch(
        projects: List<String>? = null,
        targets: List<GitOpTarget>? = null,
    ): List<GitOpResult> {
        val body = ProtocolJson.encodeToString(
            FetchPullRequest.serializer(),
            FetchPullRequest(projects = projects, targets = targets)
        )
        val text = apiClient.postJson("/api/git/fetch", body)
        return ProtocolJson.decodeFromString(ListSerializer(GitOpResult.serializer()), text)
    }

    suspend fun pull(
        projects: List<String>? = null,
        targets: List<GitOpTarget>? = null,
    ): List<GitOpResult> {
        val body = ProtocolJson.encodeToString(
            FetchPullRequest.serializer(),
            FetchPullRequest(projects = projects, targets = targets)
        )
        val text = apiClient.postJson("/api/git/pull", body)
        return ProtocolJson.decodeFromString(ListSerializer(GitOpResult.serializer()), text)
    }

    suspend fun push(
        project: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitOpResult {
        val body = ProtocolJson.encodeToString(
            PushRequest.serializer(),
            PushRequest(project = project, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/push", body)
        return ProtocolJson.decodeFromString(GitOpResult.serializer(), text)
    }
}
