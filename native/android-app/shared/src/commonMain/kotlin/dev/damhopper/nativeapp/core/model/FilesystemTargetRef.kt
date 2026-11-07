package dev.damhopper.nativeapp.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.put

/**
 * Target reference for filesystem operations: either whole workspace or a specific project/worktree.
 * Preserves strict differentiation between workspace-level operations and project-bound operations.
 */
@Serializable
sealed class FilesystemTargetRef {
    abstract val profileId: ProfileId?

    @Serializable
    @SerialName("workspace")
    data class Workspace(
        override val profileId: ProfileId? = null,
        val workspaceEpoch: Long? = null,
    ) : FilesystemTargetRef()

    @Serializable
    @SerialName("project")
    data class Project(
        override val profileId: ProfileId? = null,
        val project: String,
        val worktreePath: String? = null,
    ) : FilesystemTargetRef() {
        init {
            require(project.isNotBlank()) { "project name cannot be blank" }
        }

        fun toProjectTargetRef(): ProjectTargetRef =
            ProjectTargetRef(profileId = profileId, project = project, worktreePath = worktreePath)
    }

    /**
     * Converts to wire target payload for WebSocket filesystem operations.
     */
    fun toServerTarget(): ServerFsTarget = when (this) {
        is Workspace -> ServerFsTarget(type = "workspace", workspaceEpoch = workspaceEpoch)
        is Project -> ServerFsTarget(type = "project", project = project, worktreePath = worktreePath)
    }

    /**
     * Converts to JSON matching Rust serde `{ tag: "type", rename_all: "camelCase" }`.
     */
    fun toServerJsonElement(): kotlinx.serialization.json.JsonObject = when (this) {
        is Workspace -> kotlinx.serialization.json.buildJsonObject {
            put("type", "workspace")
            workspaceEpoch?.let { put("workspaceEpoch", it) }
        }
        is Project -> kotlinx.serialization.json.buildJsonObject {
            put("type", "project")
            put("project", project)
            worktreePath?.let { put("worktreePath", it) }
        }
    }

    /**
     * Converts to query parameters for REST filesystem endpoints.
     */
    fun toQueryParams(): List<Pair<String, String>> = when (this) {
        is Workspace -> buildList {
            add("targetType" to "workspace")
            if (workspaceEpoch != null) add("workspaceEpoch" to workspaceEpoch.toString())
        }
        is Project -> buildList {
            add("targetType" to "project")
            add("project" to project)
            val normalized = normalizeProjectTargetPath(worktreePath)
            if (!normalized.isNullOrBlank()) add("worktreePath" to normalized)
        }
    }

    companion object {
        fun fromProjectTargetRef(target: ProjectTargetRef): Project =
            Project(profileId = target.profileId, project = target.project, worktreePath = target.worktreePath)
    }
}

/**
 * Nested wire target for WebSocket filesystem envelopes matching server schema:
 * `{ type: "workspace", workspaceEpoch? }` or `{ type: "project", project, worktreePath? }`.
 */
@Serializable
data class ServerFsTarget(
    val type: String,
    val project: String? = null,
    val worktreePath: String? = null,
    val workspaceEpoch: Long? = null,
)
