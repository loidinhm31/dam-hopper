package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Controller for standard Git history and working-tree actions:
 * cherry-pick, revert, reset, drop, undo-last-commit, and file-level variants.
 */
class GitHistoryActionController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
) {
    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        activeScope = scope
    }

    fun cherryPick(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.cherryPick(scope.project, hash, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Cherry-pick error"))
            }
        }
    }

    fun cherryPickFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.cherryPickFiles(scope.project, hash, paths, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Cherry-pick files error"))
            }
        }
    }

    fun revert(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.revertCommit(scope.project, hash, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Revert error"))
            }
        }
    }

    fun revertFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.revertCommitFiles(scope.project, hash, paths, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Revert files error"))
            }
        }
    }

    fun reset(hash: String, mode: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.reset(scope.project, hash, mode, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Reset error"))
            }
        }
    }

    fun drop(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.dropCommit(scope.project, hash, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Drop error"))
            }
        }
    }

    fun dropFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.dropCommitFiles(scope.project, hash, paths, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Drop files error"))
            }
        }
    }

    fun undoLastCommit(onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        return coroutineScope.launch {
            try {
                onResult(repository.history.undoLastCommit(scope.project, scope.worktreePath, scope.root))
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Undo commit error"))
            }
        }
    }
}
