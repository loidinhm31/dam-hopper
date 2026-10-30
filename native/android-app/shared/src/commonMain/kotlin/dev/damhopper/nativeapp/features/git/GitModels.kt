package dev.damhopper.nativeapp.features.git

import kotlinx.serialization.Serializable

/**
 * VCS Root representation corresponding to server GET /api/git/{project}/roots
 */
@Serializable
data class GitLastCommit(
    val hash: String,
    val message: String,
    val date: String,
)

@Serializable
data class GitSubmoduleGitlink(
    val path: String,
    val objectId: String,
    val moduleName: String? = null,
    val url: String? = null,
)

@Serializable
data class GitStatus(
    val projectName: String,
    val branch: String,
    val isClean: Boolean,
    val ahead: Int,
    val behind: Int,
    val staged: Int,
    val modified: Int,
    val untracked: Int,
    val hasStash: Boolean,
    val lastCommit: GitLastCommit,
    val pathExists: Boolean? = null,
    val statusError: String? = null,
)

@Serializable
data class VcsRoot(
    val rootId: String,
    val path: String,
    val absolutePath: String? = null,
    val kind: String = "primary", // primary | submodule | nestedRepo
    val mappingState: String? = null,
    val gitlink: GitSubmoduleGitlink? = null,
    val status: GitStatus? = null,
    val warnings: List<String> = emptyList(),
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
data class DiffFileEntry(
    val path: String,
    val status: String,
    val staged: Boolean,
    val additions: Int = 0,
    val deletions: Int = 0,
    val oldPath: String? = null,
    val rootId: String? = null,
    val rootPath: String? = null,
    val submodule: GitSubmoduleGitlink? = null,
)

@Serializable
data class GitDiffResponse(
    val entries: List<DiffFileEntry>,
    val untrackedTruncated: Boolean,
    val untrackedTotal: Int,
)

@Serializable
data class GitConflictSummary(
    val targetRevision: String,
    val entries: List<GitConflictSummaryEntry>,
    val truncated: Boolean,
    val nextCursor: String? = null,
)

@Serializable
data class GitConflictSummaryEntry(
    val conflictId: String,
    val path: String,
    val status: String,
    val isBinary: Boolean,
    val unsupportedReason: String? = null,
)

@Serializable
data class GitOperationStatus(
    val operation: String,
    val canContinue: Boolean,
    val canAbort: Boolean,
    val operationFingerprint: String,
    val fullIndexFingerprint: String,
    val stoppedReason: String? = null,
    val stageRoleLabels: GitStageRoleLabels? = null,
    val terminalHandoffRequired: GitTerminalHandoff? = null,
    val blockers: List<String> = emptyList(),
)

@Serializable
data class GitStageRoleLabels(
    val ours: String,
    val theirs: String,
    val base: String? = null,
)

@Serializable
data class GitTerminalHandoff(
    val reason: String,
    val worktreeRoot: String,
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
