package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * Commit entry from GET /api/git/{project}/log
 */
@Serializable
data class GitLogEntry(
    val hash: String,
    val parents: List<String> = emptyList(),
    val authorName: String,
    val authorEmail: String,
    val timestamp: Long,
    val message: String,
    val refs: List<String> = emptyList(),
    val isPushed: Boolean = false,
)

/**
 * Exact commit inspection details from GET /api/git/{project}/commit/{hash}/details
 */
@Serializable
data class GitCommitDetails(
    val hash: String,
    val authorName: String,
    val authorEmail: String,
    val authorTimestamp: Long,
    val authorTimezoneOffsetMinutes: Int = 0,
    val committerName: String? = null,
    val committerEmail: String? = null,
    val committerTimestamp: Long? = null,
    val committerTimezoneOffsetMinutes: Int = 0,
    val subject: String,
    val fullMessage: String,
)

/**
 * Snapshot returned by GET /api/git/{project}/commit/{hash}/message
 */
@Serializable
data class CommitMessageSnapshot(
    val message: String,
    val branch: String,
    val headOid: String,
)

@Serializable
data class EditCommitMessageRequest(
    val message: String,
    val expectedBranch: String,
    val expectedHeadOid: String,
    val allowSignatureRemoval: Boolean = false,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class SquashCommitsRequest(
    val hashes: List<String>,
    val message: String,
    val expectedBranch: String,
    val expectedHeadOid: String,
    val allowSignatureRemoval: Boolean = false,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class CherryPickRequest(
    val hash: String,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class ResetRequest(
    val hash: String,
    val mode: String = "mixed", // soft | mixed | hard | keep
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class FilePathsRequest(
    val paths: List<String>,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class GitRecoveryInfo(
    val operation: String? = null,
    val canAbort: Boolean = false,
    val canContinue: Boolean = false,
)

/**
 * Polymorphic outcome for branch create/checkout/delete, cherry-pick, reset,
 * drop, revert, undo-last-commit, message edit, and squash.
 */
@Serializable
data class GitActionResult(
    val ok: Boolean,
    val message: String? = null,
    val branch: String? = null,
    val hash: String? = null,
    val stashed: Boolean = false,
    val conflict: Boolean = false,
    val dirty: Boolean = false,
    val destructive: Boolean = false,
    val recovery: GitRecoveryInfo? = null,
    val blockedReason: String? = null,
    val recommendation: String? = null,
    val oldTargetOid: String? = null,
    val newTargetOid: String? = null,
    val oldHeadOid: String? = null,
    val newHeadOid: String? = null,
    val rewrittenCount: Int = 0,
    val noOp: Boolean = false,
    val signaturesRemoved: Boolean = false,
) {
    val isBlocked: Boolean get() = !ok && blockedReason != null
    val isConflict: Boolean get() = conflict
}
