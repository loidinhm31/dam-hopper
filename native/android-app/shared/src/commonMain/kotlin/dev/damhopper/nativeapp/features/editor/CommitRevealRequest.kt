package dev.damhopper.nativeapp.features.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Nonce-carrying request to inspect a historical commit without clobbering
 * or discarding dirty in-memory editor buffers.
 */
data class CommitRevealRequest(
    val owner: ConnectionRef,
    val target: ProjectTargetRef,
    val commitHash: String,
    val filePath: String? = null,
    val root: String? = null,
    val nonce: String = "${owner.profileId}:${commitHash}:${kotlinx.datetime.Clock.System.now().toEpochMilliseconds()}",
    val createdAtEpochMs: Long = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
)

/**
 * Coordinates safe inspection of historical commits.
 */
class CommitRevealCoordinator {
    private val _pendingReveal = MutableStateFlow<CommitRevealRequest?>(null)
    val pendingReveal: StateFlow<CommitRevealRequest?> = _pendingReveal.asStateFlow()

    fun requestReveal(request: CommitRevealRequest) {
        _pendingReveal.value = request
    }

    fun consumeReveal(currentOwner: ConnectionRef, currentTarget: ProjectTargetRef): CommitRevealRequest? {
        val current = _pendingReveal.value ?: return null
        if (current.owner.profileId != currentOwner.profileId ||
            current.owner.generation != currentOwner.generation ||
            current.target.project != currentTarget.project ||
            current.target.worktreePath != currentTarget.worktreePath
        ) {
            // Reject stale cross-target / cross-owner reveal request
            _pendingReveal.value = null
            return null
        }
        _pendingReveal.value = null
        return current
    }

    fun clear() {
        _pendingReveal.value = null
    }
}
