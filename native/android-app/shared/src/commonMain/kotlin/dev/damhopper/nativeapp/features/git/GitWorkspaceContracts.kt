package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.DocumentId
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner

enum class GitPanelSection {
    CHANGES,
    HISTORY,
    BRANCHES_WORKTREES,
}

data class GitRequestIdentity(
    val owner: WorkspaceFileOwner,
    val generation: Long,
    val root: String?,
    val ref: String,
    val search: String,
    val offset: Int,
    val sequence: Long,
)

fun gitWorkspaceRelativePath(rootPath: String, gitPath: String): String {
    require(!rootPath.contains('\u0000')) { "Path contains NUL character: $rootPath" }
    require(!gitPath.contains('\u0000')) { "Path contains NUL character: $gitPath" }
    require(gitPath.isNotBlank()) { "gitPath must not be blank" }
    val normalizedGitPath = DocumentId.normalizeRelativePath(gitPath)
    require(normalizedGitPath.isNotEmpty()) { "gitPath must not resolve to empty root: $gitPath" }

    val trimmedRoot = rootPath.trim()
    val cleanRoot = if (trimmedRoot == "." || trimmedRoot.isEmpty()) {
        ""
    } else {
        DocumentId.normalizeRelativePath(rootPath)
    }

    if (cleanRoot.isEmpty()) {
        return normalizedGitPath
    }
    return DocumentId.normalizeRelativePath("$cleanRoot/$normalizedGitPath")
}

sealed interface GitRoute {
    data object Overview : GitRoute
    data class Details(val oid: String) : GitRoute
    data class Diff(val path: String, val commitOid: String?) : GitRoute
}

enum class GitRefreshReason {
    ENTRY,
    FOREGROUND,
    MANUAL,
    MUTATION,
    RECONCILE,
}

enum class GitMutationImpact {
    REFS,
    INDEX,
    FILES,
    HISTORY,
    TARGETS,
    PUBLICATION,
}

enum class GitOutcomeKind {
    SUCCEEDED,
    REJECTED,
    UNKNOWN,
}

data class GitMutationEvent(
    val scope: GitOperationScope,
    val impact: GitMutationImpact,
    val kind: GitOutcomeKind,
    val paths: List<String>,
    val message: String?,
)

interface GitHostPorts {
    suspend fun <T> withMutationGuard(
        scope: GitOperationScope,
        impact: GitMutationImpact,
        paths: List<String>,
        dispatch: suspend () -> T,
    ): Result<T>

    suspend fun preflightRemoval(
        scope: GitOperationScope,
        worktree: ProjectWorktree,
    ): WorktreeRemovalPrecheck

    suspend fun requestWorktreeSwitch(
        scope: GitOperationScope,
        target: ProjectTargetRef,
    ): Result<Unit>

    suspend fun openWorkspaceFile(
        scope: GitOperationScope,
        rootRelativePath: String,
    ): Result<Unit>

    fun onMutationOutcome(event: GitMutationEvent)
    fun refresh(reason: GitRefreshReason)
    fun openRecoveryTerminal(scope: GitOperationScope)
}
