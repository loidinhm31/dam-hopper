package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import io.ktor.http.encodeURLQueryComponent

/**
 * Handles Git history mutations, file-level variants, commit message edits, and squash.
 */
class GitHistoryMutationRepository(
    val apiClient: ApiClient,
) {
    private fun buildQuery(worktreePath: String?, root: String?): String {
        val params = mutableListOf<String>()
        worktreePath?.let { params.add("worktreePath=${it.encodeURLQueryComponent()}") }
        root?.let { params.add("root=${it.encodeURLQueryComponent()}") }
        return if (params.isEmpty()) "" else "?" + params.joinToString("&")
    }

    suspend fun cherryPick(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            CherryPickRequest.serializer(),
            CherryPickRequest(hash = hash, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/cherry-pick", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun cherryPickFiles(
        project: String,
        hash: String,
        paths: List<String>,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val body = ProtocolJson.encodeToString(
            FilePathsRequest.serializer(),
            FilePathsRequest(paths = paths, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/cherry-pick-files", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun reset(
        project: String,
        hash: String,
        mode: String = "mixed",
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(
            ResetRequest.serializer(),
            ResetRequest(hash = hash, mode = mode, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/reset", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun undoLastCommit(
        project: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val query = buildQuery(worktreePath, root)
        val text = apiClient.postJson("/api/git/$encodedProject/undo-last-commit$query", "{}")
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun dropCommit(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val query = buildQuery(worktreePath, root)
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/drop$query", "{}")
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun dropCommitFiles(
        project: String,
        hash: String,
        paths: List<String>,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val body = ProtocolJson.encodeToString(
            FilePathsRequest.serializer(),
            FilePathsRequest(paths = paths, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/drop-files", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun revertCommit(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val query = buildQuery(worktreePath, root)
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/revert$query", "{}")
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun revertCommitFiles(
        project: String,
        hash: String,
        paths: List<String>,
        worktreePath: String? = null,
        root: String? = null,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val body = ProtocolJson.encodeToString(
            FilePathsRequest.serializer(),
            FilePathsRequest(paths = paths, worktreePath = worktreePath, root = root)
        )
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/revert-files", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun editCommitMessage(
        project: String,
        hash: String,
        request: EditCommitMessageRequest,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val body = ProtocolJson.encodeToString(EditCommitMessageRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/commit/$encodedHash/message", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }

    suspend fun squashCommits(
        project: String,
        request: SquashCommitsRequest,
    ): GitActionResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(SquashCommitsRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/squash", body)
        return ProtocolJson.decodeFromString(GitActionResult.serializer(), text)
    }
}
