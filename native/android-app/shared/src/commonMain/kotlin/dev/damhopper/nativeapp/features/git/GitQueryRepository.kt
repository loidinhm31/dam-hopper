package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer

/**
 * Handles Git read queries against /api/git/... endpoints.
 */
class GitQueryRepository(
    val apiClient: ApiClient,
) {
    suspend fun listRoots(project: String, worktreePath: String? = null): List<VcsRoot> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        val text = apiClient.get("/api/git/$encodedProject/roots", params)
        return ProtocolJson.decodeFromString(ListSerializer(VcsRoot.serializer()), text)
    }

    suspend fun listBranches(project: String, worktreePath: String? = null, root: String? = null): List<GitBranch> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/branches", params)
        return ProtocolJson.decodeFromString(ListSerializer(GitBranch.serializer()), text)
    }

    suspend fun getLog(
        project: String,
        worktreePath: String? = null,
        limit: Int = 100,
        offset: Int = 0,
        ref: String = "HEAD",
        messageQuery: String? = null,
        root: String? = null,
    ): List<GitLogEntry> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf(
            "limit" to limit.toString(),
            "offset" to offset.toString(),
            "ref" to ref,
        )
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        messageQuery?.takeIf { it.isNotBlank() }?.let { params["messageQuery"] = it }
        val text = apiClient.get("/api/git/$encodedProject/log", params)
        return ProtocolJson.decodeFromString(ListSerializer(GitLogEntry.serializer()), text)
    }

    suspend fun getCommitDetails(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitCommitDetails {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/commit/$encodedHash/details", params)
        return ProtocolJson.decodeFromString(GitCommitDetails.serializer(), text)
    }

    suspend fun getCommitFiles(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
    ): List<DiffFileEntry> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/commit/$encodedHash/files", params)
        return ProtocolJson.decodeFromString(ListSerializer(DiffFileEntry.serializer()), text)
    }

    suspend fun getCommitFileDiff(
        project: String,
        hash: String,
        path: String,
        worktreePath: String? = null,
        root: String? = null,
    ): FileDiffContent {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val params = mutableMapOf("path" to path)
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/commit/$encodedHash/diff", params)
        return ProtocolJson.decodeFromString(FileDiffContent.serializer(), text)
    }

    suspend fun getDiffSummary(
        project: String,
        worktreePath: String? = null,
        root: String? = null,
    ): GitDiffSummary {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/diff", params)
        return ProtocolJson.decodeFromString(GitDiffSummary.serializer(), text)
    }

    suspend fun getUntracked(
        project: String,
        worktreePath: String? = null,
        offset: Int = 0,
        limit: Int = 500,
        root: String? = null,
    ): List<DiffFileEntry> {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf(
            "offset" to offset.toString(),
            "limit" to limit.toString(),
        )
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/untracked", params)
        return ProtocolJson.decodeFromString(ListSerializer(DiffFileEntry.serializer()), text)
    }

    suspend fun getFileDiff(
        project: String,
        path: String,
        worktreePath: String? = null,
        root: String? = null,
    ): FileDiffContent {
        val encodedProject = ApiClient.encodePathSegment(project)
        val params = mutableMapOf("path" to path)
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        val text = apiClient.get("/api/git/$encodedProject/diff/file", params)
        return ProtocolJson.decodeFromString(FileDiffContent.serializer(), text)
    }

    suspend fun getCommitMessage(
        project: String,
        hash: String,
        worktreePath: String? = null,
        root: String? = null,
        branch: String? = null,
    ): CommitMessageSnapshot {
        val encodedProject = ApiClient.encodePathSegment(project)
        val encodedHash = ApiClient.encodePathSegment(hash)
        val params = mutableMapOf<String, String>()
        worktreePath?.let { params["worktreePath"] = it }
        root?.let { params["root"] = it }
        branch?.let { params["branch"] = it }
        val text = apiClient.get("/api/git/$encodedProject/commit/$encodedHash/message", params)
        return ProtocolJson.decodeFromString(CommitMessageSnapshot.serializer(), text)
    }
}
