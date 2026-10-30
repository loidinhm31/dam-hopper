package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

/**
 * Encapsulates the complete target and connection scope for Git actions.
 *
 * Invariants:
 * - Scoped strictly to profileId and monotonic connection generation.
 * - Changing target or connection generation immediately invalidates pending
 *   mutation baselines, confirmation dialogs, and late asynchronous responses.
 */
data class GitOperationScope(
    val owner: WorkspaceFileOwner,
    val generation: Long,
    val root: String? = null,
) {
    val profileId: String get() = owner.profileId ?: ""
    val project get() = owner.project
    val worktreePath get() = owner.worktreePath
    val targetRef get() = owner.toProjectTargetRef()

    fun matches(other: GitOperationScope?): Boolean =
        other != null && owner == other.owner && generation == other.generation && root == other.root

    companion object {
        fun from(owner: WorkspaceFileOwner, connection: ConnectionRef, root: String? = null): GitOperationScope {
            require(owner.profileId == connection.profileId) { "owner profile mismatch" }
            return GitOperationScope(owner = owner, generation = connection.generation, root = root)
        }
    }
}
