package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controller for Git branch discovery, creation, checkout, deletion, and tracking updates.
 */
class GitBranchController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
) {
    private val _branches = MutableStateFlow<List<GitBranch>>(emptyList())
    val branches: StateFlow<List<GitBranch>> = _branches.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var activeJob: Job? = null

    var activeScope: GitOperationScope? = null
        private set

    val activeBranch: GitBranch?
        get() = _branches.value.firstOrNull { it.isCurrent }

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            refreshBranches()
        }
    }

    fun refreshBranches(onLoaded: ((List<GitBranch>) -> Unit)? = null): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        activeJob?.cancel()
        val job = coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val list = repository.listBranches(scope.project, scope.worktreePath, scope.root)
                if (scope.matches(activeScope)) {
                    _branches.value = list
                    onLoaded?.invoke(list)
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Failed to list branches"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
        activeJob = job
        return job
    }

    fun createBranch(
        name: String,
        startPoint: String? = null,
        checkout: Boolean = false,
        onResult: (GitActionResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                val req = CreateBranchRequest(
                    name = name,
                    startPoint = startPoint,
                    checkout = checkout,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.branchWorktree.createBranch(scope.project, req)
                if (res.ok && scope.matches(activeScope)) refreshBranches()
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Failed to create branch"))
            }
        }
    }

    fun checkoutBranch(
        branchName: String,
        strategy: String = "normal",
        onResult: (GitActionResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                val req = CheckoutBranchRequest(
                    branch = branchName,
                    strategy = strategy,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.branchWorktree.checkoutBranch(scope.project, req)
                if (res.ok && scope.matches(activeScope)) refreshBranches()
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Failed to checkout branch"))
            }
        }
    }

    fun deleteBranch(
        branchName: String,
        onResult: (GitActionResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                val req = DeleteBranchRequest(
                    name = branchName,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.branchWorktree.deleteBranch(scope.project, req)
                if (res.ok && scope.matches(activeScope)) refreshBranches()
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Failed to delete branch"))
            }
        }
    }

    fun updateBranch(
        branchName: String? = null,
        onResult: (BranchUpdateResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(BranchUpdateResult(branch = branchName ?: "", success = false, reason = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                val req = UpdateBranchRequest(
                    branch = branchName,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.branchWorktree.updateBranch(scope.project, req)
                if (res.success && scope.matches(activeScope)) refreshBranches()
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(BranchUpdateResult(branch = branchName ?: "", success = false, reason = t.message))
            }
        }
    }
}
