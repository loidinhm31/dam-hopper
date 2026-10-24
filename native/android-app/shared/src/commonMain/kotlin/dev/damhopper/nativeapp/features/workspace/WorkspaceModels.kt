package dev.damhopper.nativeapp.features.workspace

import dev.damhopper.nativeapp.core.model.ProfileId
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.normalizeProjectTargetPath
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.add

/**
 * Status of current active workspace returned by GET /api/workspace/status.
 * Authoritative workspace identity is [configPath].
 */
@Serializable
data class WorkspaceStatus(
    val ready: Boolean = false,
    val path: String? = null,
    val configPath: String? = null,
    val name: String? = null,
    val projectCount: Int = 0,
)

/**
 * Detailed workspace info returned by GET /api/workspace.
 */
@Serializable
data class WorkspaceInfo(
    val name: String,
    val root: String? = null,
    val configPath: String? = null,
    val projectCount: Int = 0,
)

/**
 * Known workspace registry entry.
 */
@Serializable
data class KnownWorkspace(
    val path: String,
    val name: String,
)

/**
 * Response for GET /api/workspace/known.
 */
@Serializable
data class KnownWorkspacesResponse(
    val workspaces: List<KnownWorkspace> = emptyList(),
    val current: String? = null,
)

/**
 * Project discovered in directory by GET /api/workspace/discover.
 */
@Serializable
data class DiscoveredProject(
    val name: String,
    val path: String,
    @SerialName("type")
    val projectType: String? = null,
)

/**
 * Response for GET /api/workspace/discover.
 */
@Serializable
data class DiscoverProjectsResponse(
    val path: String,
    val projects: List<DiscoveredProject> = emptyList(),
)

/**
 * Project configuration summary returned in the bare array by GET /api/projects.
 */
@Serializable
data class ProjectSummary(
    val name: String,
    val path: String,
    @SerialName("type")
    val projectType: String? = null,
    val commands: Map<String, String>? = null,
    val tags: List<String>? = null,
    val envFile: String? = null,
    val restartPolicy: String? = null,
    val restartMaxRetries: Int = 0,
)

/**
 * Git worktree entry returned in bare array by GET /api/git/:project/worktrees.
 * Note: isMain indicates the primary Git worktree branch, NOT the configured project root.
 * Root target is always the null/omitted worktreePath.
 */
@Serializable
data class ProjectWorktree(
    val path: String,
    val repositoryPath: String,
    val branch: String,
    val commitHash: String,
    val isMain: Boolean = false,
    val isLocked: Boolean = false,
    val isDetached: Boolean = false,
    val isBare: Boolean = false,
    val isPrunable: Boolean = false,
    val isAvailable: Boolean = true,
) {
    /**
     * Worktree is selectable only if available and not marked prunable.
     */
    val isSelectable: Boolean get() = isAvailable && !isPrunable

    /**
     * User-facing status badge string.
     */
    val statusLabel: String
        get() = when {
            isPrunable -> "Prunable — unavailable"
            !isAvailable -> if (isBare) "Bare — unavailable" else "Unavailable"
            isDetached && isLocked -> "Detached · Locked"
            isDetached -> "Detached"
            isLocked -> "Locked"
            else -> "Available"
        }
}

/**
 * Qualified snapshot of a selected project target (either root or worktree).
 */
data class ProjectTargetSnapshot(
    val profileId: ProfileId? = null,
    val workspaceConfigPath: String? = null,
    val workspaceRevision: Long = 0L,
    val project: String,
    val target: ProjectTargetRef,
    val targetKey: String,
    val label: String,
    val isRoot: Boolean,
    val isAvailable: Boolean,
    val statusLabel: String,
    val worktree: ProjectWorktree? = null,
) {
    companion object {
        const val ROOT_TARGET_LABEL = "Project root"

        /**
         * Builds a collision-safe structured target key using JSON array encoding.
         */
        fun buildStructuredTargetKey(
            profileId: ProfileId?,
            workspaceConfigPath: String?,
            project: String,
            worktreePath: String?,
        ): String {
            val normalizedWt = normalizeProjectTargetPath(worktreePath)
            return buildJsonArray {
                add(profileId.orEmpty())
                add(workspaceConfigPath.orEmpty())
                add(project)
                if (normalizedWt != null) add(normalizedWt) else add(null as String?)
            }.toString()
        }
    }
}
