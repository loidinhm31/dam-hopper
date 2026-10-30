package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class WorktreeRemovalPrecheck {
    object Allowed : WorktreeRemovalPrecheck()
    data class Blocked(val reasons: List<String>) : WorktreeRemovalPrecheck()
}

/**
 * Controller for Git worktree discovery, additions, safe deletions with preflight
 * dirty-tab / active-terminal ownership checks, and administrative pruning.
 */
class WorktreeMutationController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
    val host: GitHostPorts,
) {
    private val _worktrees = MutableStateFlow<List<ProjectWorktree>>(emptyList())
    val worktrees: StateFlow<List<ProjectWorktree>> = _worktrees.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var activeJob: Job? = null

    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            refreshWorktrees()
        }
    }

    fun clearScope() {
        activeScope = null
        activeJob?.cancel()
        _worktrees.value = emptyList()
        _error.value = null
        _isLoading.value = false
    }

    fun revoke() {
        clearScope()
    }

    fun refreshWorktrees(onLoaded: ((List<ProjectWorktree>) -> Unit)? = null): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        activeJob?.cancel()
        val job = coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val list = repository.listWorktrees(scope.project)
                if (scope.matches(activeScope)) {
                    _worktrees.value = list
                    onLoaded?.invoke(list)
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Failed to list worktrees"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
        activeJob = job
        return job
    }

    suspend fun validateRemovalPrecheck(worktree: ProjectWorktree): WorktreeRemovalPrecheck {
        val scope = activeScope ?: return WorktreeRemovalPrecheck.Blocked(listOf("No active target"))
        return host.preflightRemoval(scope, worktree)
    }

    fun addWorktree(
        branch: String,
        path: String? = null,
        createBranch: Boolean? = null,
        baseBranch: String? = null,
        onResult: (Result<ProjectWorktree>) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(Result.failure(IllegalStateException("No active scope")))
        }
        val impact = GitMutationImpact.TARGETS
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    val req = AddWorktreeRequest(branch, path, createBranch, baseBranch)
                    repository.branchWorktree.addWorktree(scope.project, req)
                }
                if (guardResult.isSuccess) {
                    val wt = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.SUCCEEDED,
                            paths = listOf(wt.path),
                            message = null,
                        )
                    )
                    if (scope.matches(activeScope)) refreshWorktrees()
                    onResult(Result.success(wt))
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = t?.message,
                        )
                    )
                    onResult(Result.failure(t ?: IllegalStateException("Failed to add worktree")))
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = emptyList(),
                        message = t.message,
                    )
                )
                onResult(Result.failure(t))
            }
        }
    }

    fun removeWorktree(
        worktree: ProjectWorktree,
        force: Boolean = false,
        onResult: (Result<Boolean>) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(Result.failure(IllegalStateException("No active scope")))
        }
        val impact = GitMutationImpact.TARGETS
        return coroutineScope.launch {
            try {
                // Re-fetch discovery immediately before removal as mandated by Git API contract
                val freshList = repository.listWorktrees(scope.project)
                if (scope.matches(activeScope)) _worktrees.value = freshList
                val current = freshList.find { it.path == worktree.path }
                if (current == null) {
                    onResult(Result.failure(IllegalStateException("Worktree '${worktree.path}' no longer exists in fresh discovery.")))
                    return@launch
                }
                if (!current.isAvailable) {
                    onResult(Result.failure(IllegalStateException("Worktree '${current.path}' is unavailable.")))
                    return@launch
                }
                if (current.isLocked) {
                    onResult(Result.failure(IllegalStateException("Worktree '${current.path}' is locked.")))
                    return@launch
                }
                if (current.isBare) {
                    onResult(Result.failure(IllegalStateException("Worktree '${current.path}' is bare.")))
                    return@launch
                }
                if (current.isMain) {
                    onResult(Result.failure(IllegalStateException("Cannot remove the primary/main worktree.")))
                    return@launch
                }

                val precheck = host.preflightRemoval(scope, current)
                if (precheck is WorktreeRemovalPrecheck.Blocked) {
                    onResult(Result.failure(IllegalStateException(precheck.reasons.joinToString("\n"))))
                    return@launch
                }

                // If removing active target, switch away first
                if (scope.worktreePath == current.path) {
                    val fallbackTarget = freshList.firstOrNull { it.isMain }?.path
                    val targetRef = ProjectTargetRef(
                        profileId = scope.profileId,
                        project = scope.project,
                        worktreePath = fallbackTarget,
                    )
                    val switchResult = host.requestWorktreeSwitch(scope, targetRef)
                    if (switchResult.isFailure) {
                        onResult(Result.failure(IllegalStateException("Failed to switch away from active worktree: ${switchResult.exceptionOrNull()?.message}")))
                        return@launch
                    }
                }

                val guardResult = host.withMutationGuard(scope, impact, listOf(current.path)) {
                    repository.branchWorktree.removeWorktree(scope.project, current.path, force)
                }
                if (guardResult.isSuccess) {
                    val ok = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = listOf(current.path),
                            message = if (ok) null else "Failed to remove worktree",
                        )
                    )
                    if (ok && scope.matches(activeScope)) {
                        refreshWorktrees()
                    }
                    onResult(Result.success(ok))
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = listOf(current.path),
                            message = t?.message,
                        )
                    )
                    onResult(Result.failure(t ?: IllegalStateException("Worktree removal failed")))
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = listOf(worktree.path),
                        message = t.message,
                    )
                )
                onResult(Result.failure(t))
            }
        }
    }

    fun pruneWorktrees(onResult: (Result<Boolean>) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(Result.failure(IllegalStateException("No active scope")))
        }
        val impact = GitMutationImpact.TARGETS
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.branchWorktree.pruneWorktrees(scope.project)
                }
                if (guardResult.isSuccess) {
                    val ok = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = if (ok) null else "Failed to prune worktrees",
                        )
                    )
                    if (ok && scope.matches(activeScope)) refreshWorktrees()
                    onResult(Result.success(ok))
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = t?.message,
                        )
                    )
                    onResult(Result.failure(t ?: IllegalStateException("Failed to prune worktrees")))
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = emptyList(),
                        message = t.message,
                    )
                )
                onResult(Result.failure(t))
            }
        }
    }
}
