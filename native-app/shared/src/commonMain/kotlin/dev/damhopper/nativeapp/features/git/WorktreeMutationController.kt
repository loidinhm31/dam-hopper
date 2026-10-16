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
    val isTargetDirty: (ProjectTargetRef) -> Boolean,
    val hasActiveTerminal: (ProjectTargetRef) -> Boolean,
    val onActiveWorktreeRemoved: (String) -> Unit = {},
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

    fun validateRemovalPrecheck(worktree: ProjectWorktree): WorktreeRemovalPrecheck {
        val scope = activeScope ?: return WorktreeRemovalPrecheck.Blocked(listOf("No active target"))
        if (worktree.isMain) {
            return WorktreeRemovalPrecheck.Blocked(listOf("Cannot remove the primary/main worktree."))
        }
        val target = ProjectTargetRef(
            profileId = scope.profileId,
            project = scope.project,
            worktreePath = worktree.path,
        )
        val blockers = mutableListOf<String>()
        if (isTargetDirty(target)) {
            blockers.add("Worktree target contains open, unsaved editor tabs. Save or discard changes first.")
        }
        if (hasActiveTerminal(target)) {
            blockers.add("Worktree target owns active terminal sessions. Close terminal sessions first.")
        }
        return if (blockers.isEmpty()) {
            WorktreeRemovalPrecheck.Allowed
        } else {
            WorktreeRemovalPrecheck.Blocked(blockers)
        }
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
        return coroutineScope.launch {
            try {
                val req = AddWorktreeRequest(branch, path, createBranch, baseBranch)
                val wt = repository.branchWorktree.addWorktree(scope.project, req)
                if (scope.matches(activeScope)) refreshWorktrees()
                onResult(Result.success(wt))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
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
        return coroutineScope.launch {
            try {
                // Re-fetch discovery immediately before removal as mandated by Git API contract
                val freshList = repository.listWorktrees(scope.project)
                if (scope.matches(activeScope)) _worktrees.value = freshList
                val current = freshList.find { it.path == worktree.path } ?: worktree

                val precheck = validateRemovalPrecheck(current)
                if (precheck is WorktreeRemovalPrecheck.Blocked) {
                    onResult(Result.failure(IllegalStateException(precheck.reasons.joinToString("\n"))))
                    return@launch
                }

                val ok = repository.branchWorktree.removeWorktree(scope.project, current.path, force)
                if (ok && scope.matches(activeScope)) {
                    refreshWorktrees()
                    if (scope.worktreePath == current.path) {
                        onActiveWorktreeRemoved(current.path)
                    }
                }
                onResult(Result.success(ok))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(Result.failure(t))
            }
        }
    }

    fun pruneWorktrees(onResult: (Result<Boolean>) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(Result.failure(IllegalStateException("No active scope")))
        }
        return coroutineScope.launch {
            try {
                val ok = repository.branchWorktree.pruneWorktrees(scope.project)
                if (ok && scope.matches(activeScope)) refreshWorktrees()
                onResult(Result.success(ok))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(Result.failure(t))
            }
        }
    }
}
