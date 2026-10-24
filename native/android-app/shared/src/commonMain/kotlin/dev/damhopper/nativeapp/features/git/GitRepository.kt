package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient

/**
 * Unified facade aggregating Git query, mutation, history rewrite,
 * branch/worktree, and leased publication repositories.
 */
class GitRepository(
    val apiClient: ApiClient,
    val query: GitQueryRepository = GitQueryRepository(apiClient),
    val mutation: GitMutationRepository = GitMutationRepository(apiClient),
    val history: GitHistoryMutationRepository = GitHistoryMutationRepository(apiClient),
    val branchWorktree: GitBranchWorktreeRepository = GitBranchWorktreeRepository(apiClient),
    val publish: GitPublishRepository = GitPublishRepository(apiClient),
) {
    suspend fun listRoots(project: String, worktreePath: String? = null) =
        query.listRoots(project, worktreePath)

    suspend fun listBranches(project: String, worktreePath: String? = null, root: String? = null) =
        query.listBranches(project, worktreePath, root)

    suspend fun getLog(
        project: String,
        worktreePath: String? = null,
        limit: Int = 100,
        offset: Int = 0,
        ref: String = "HEAD",
        messageQuery: String? = null,
        root: String? = null,
    ) = query.getLog(project, worktreePath, limit, offset, ref, messageQuery, root)

    suspend fun getDiffSummary(project: String, worktreePath: String? = null, root: String? = null) =
        query.getDiffSummary(project, worktreePath, root)

    suspend fun stage(project: String, paths: List<String>, worktreePath: String? = null, root: String? = null) =
        mutation.stage(project, paths, worktreePath, root)

    suspend fun unstage(project: String, paths: List<String>, worktreePath: String? = null, root: String? = null) =
        mutation.unstage(project, paths, worktreePath, root)

    suspend fun commit(project: String, message: String, amend: Boolean = false, worktreePath: String? = null, root: String? = null) =
        mutation.commit(project, message, amend, worktreePath, root)

    suspend fun fetch(projects: List<String>? = null, targets: List<GitOpTarget>? = null) =
        mutation.fetch(projects, targets)

    suspend fun pull(projects: List<String>? = null, targets: List<GitOpTarget>? = null) =
        mutation.pull(projects, targets)

    suspend fun push(project: String, worktreePath: String? = null, root: String? = null) =
        mutation.push(project, worktreePath, root)

    suspend fun listWorktrees(project: String) =
        branchWorktree.listWorktrees(project)
}
