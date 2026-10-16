package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * VCS Root representation corresponding to server GET /api/git/{project}/roots
 */
@Serializable
data class VcsRoot(
    val rootId: String,
    val path: String,
    val absolutePath: String? = null,
    val kind: String = "primary", // primary | submodule | nestedRepo
    val mappingState: String? = null,
    val status: GitRootStatus? = null,
    val warnings: List<String> = emptyList(),
)

@Serializable
data class GitRootStatus(
    val branch: String? = null,
    val headCommit: String? = null,
    val isDetached: Boolean = false,
    val hasLocalChanges: Boolean = false,
)

/**
 * Branch metadata returned by GET /api/git/{project}/branches
 */
@Serializable
data class GitBranch(
    val name: String,
    val isCurrent: Boolean = false,
    val isRemote: Boolean = false,
    val trackingBranch: String? = null,
    val ahead: Int = 0,
    val behind: Int = 0,
    val lastCommit: String? = null,
) {
    val isLocal: Boolean get() = !isRemote
    val fullRef: String get() = if (name.startsWith("refs/")) name else if (isRemote) "refs/remotes/$name" else "refs/heads/$name"
}

@Serializable
data class BranchUpdateResult(
    val branch: String,
    val success: Boolean,
    val reason: String? = null,
)

@Serializable
data class CreateBranchRequest(
    val name: String,
    val startPoint: String? = null,
    val checkout: Boolean = false,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class CheckoutBranchRequest(
    val branch: String,
    val startPoint: String? = null,
    val create: Boolean = false,
    val strategy: String = "normal", // normal | stash | force
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class DeleteBranchRequest(
    val name: String,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class UpdateBranchRequest(
    val branch: String? = null,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class GitDiffSummary(
    val staged: List<DiffFileEntry> = emptyList(),
    val unstaged: List<DiffFileEntry> = emptyList(),
)

@Serializable
data class DiffFileEntry(
    val path: String,
    val status: String = "modified", // modified | added | deleted | renamed | untracked
    val oldPath: String? = null,
    val staged: Boolean = false,
)

@Serializable
data class StageFilesRequest(
    val paths: List<String>,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class DiscardFileRequest(
    val path: String,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class CommitRequest(
    val message: String,
    val amend: Boolean = false,
    val worktreePath: String? = null,
    val root: String? = null,
)

@Serializable
data class CommitResponse(
    val ok: Boolean,
    val hash: String? = null,
    val error: String? = null,
)

@Serializable
data class AddWorktreeRequest(
    val branch: String,
    val path: String? = null,
    val createBranch: Boolean? = null,
    val baseBranch: String? = null,
)

@Serializable
data class RemoveWorktreeRequest(
    val path: String,
    val force: Boolean? = null,
)
