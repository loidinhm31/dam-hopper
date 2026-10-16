package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef

/**
 * Encapsulates the complete target and connection scope for Git actions.
 *
 * Invariants:
 * - Scoped strictly to profileId and monotonic connection generation.
 * - Changing target or connection generation immediately invalidates pending
 *   mutation baselines, confirmation dialogs, and late asynchronous responses.
 */
data class GitOperationScope(
    val profileId: String,
    val generation: Long,
    val project: String,
    val worktreePath: String? = null,
    val root: String? = null,
) {
    fun matches(other: GitOperationScope?): Boolean {
        if (other == null) return false
        return profileId == other.profileId &&
            generation == other.generation &&
            project == other.project &&
            worktreePath == other.worktreePath &&
            root == other.root
    }

    val targetRef: ProjectTargetRef
        get() = ProjectTargetRef(
            profileId = profileId,
            project = project,
            worktreePath = worktreePath,
        )

    companion object {
        fun from(connection: ConnectionRef, target: ProjectTargetRef, root: String? = null): GitOperationScope {
            return GitOperationScope(
                profileId = connection.profileId,
                generation = connection.generation,
                project = target.project,
                worktreePath = target.worktreePath,
                root = root,
            )
        }
    }
}
