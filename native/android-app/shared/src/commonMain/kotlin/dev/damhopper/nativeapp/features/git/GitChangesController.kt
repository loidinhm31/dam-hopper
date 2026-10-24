package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controller for working-tree changes, staging, unstaging, discarding, and committing.
 */
class GitChangesController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
) {
    private val _stagedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val stagedFiles: StateFlow<List<DiffFileEntry>> = _stagedFiles.asStateFlow()

    private val _unstagedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val unstagedFiles: StateFlow<List<DiffFileEntry>> = _unstagedFiles.asStateFlow()

    private val _untrackedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val untrackedFiles: StateFlow<List<DiffFileEntry>> = _untrackedFiles.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _commitMessage = MutableStateFlow("")
    val commitMessage: StateFlow<String> = _commitMessage.asStateFlow()

    private val _amend = MutableStateFlow(false)
    val amend: StateFlow<Boolean> = _amend.asStateFlow()

    private var activeRefreshJob: Job? = null

    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            refreshChanges()
        }
    }

    fun setCommitMessage(msg: String) { _commitMessage.value = msg }
    fun setAmend(value: Boolean) { _amend.value = value }

    fun refreshChanges(): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        activeRefreshJob?.cancel()
        val job = coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val diff = repository.getDiffSummary(scope.project, scope.worktreePath, scope.root)
                val untracked = repository.query.getUntracked(scope.project, scope.worktreePath, 0, 500, scope.root)
                if (scope.matches(activeScope)) {
                    _stagedFiles.value = diff.staged
                    _unstagedFiles.value = diff.unstaged
                    _untrackedFiles.value = untracked
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Failed to load changes"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
        activeRefreshJob = job
        return job
    }

    fun stageFile(path: String): Job = stageFiles(listOf(path))

    fun stageAll(): Job {
        val paths = (_unstagedFiles.value + _untrackedFiles.value).map { it.path }
        return if (paths.isNotEmpty()) stageFiles(paths) else coroutineScope.launch {}
    }

    fun stageFiles(paths: List<String>): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val ok = repository.stage(scope.project, paths, scope.worktreePath, scope.root)
                if (ok && scope.matches(activeScope)) refreshChanges()
                else if (scope.matches(activeScope)) _error.value = "Failed to stage files"
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Staging error"
            }
        }
    }

    fun unstageFile(path: String): Job = unstageFiles(listOf(path))

    fun unstageAll(): Job {
        val paths = _stagedFiles.value.map { it.path }
        return if (paths.isNotEmpty()) unstageFiles(paths) else coroutineScope.launch {}
    }

    fun unstageFiles(paths: List<String>): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val ok = repository.unstage(scope.project, paths, scope.worktreePath, scope.root)
                if (ok && scope.matches(activeScope)) refreshChanges()
                else if (scope.matches(activeScope)) _error.value = "Failed to unstage files"
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Unstaging error"
            }
        }
    }

    fun discardFile(path: String): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val ok = repository.mutation.discard(scope.project, path, scope.worktreePath, scope.root)
                if (ok && scope.matches(activeScope)) refreshChanges()
                else if (scope.matches(activeScope)) _error.value = "Failed to discard file"
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Discard error"
            }
        }
    }

    fun commit(onResult: (CommitResponse) -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(CommitResponse(ok = false, error = "No active scope"))
        }
        val msg = _commitMessage.value.trim()
        if (msg.isBlank()) {
            _error.value = "Commit message cannot be empty"
            return coroutineScope.launch { onResult(CommitResponse(ok = false, error = "Empty commit message")) }
        }
        return coroutineScope.launch {
            _isLoading.value = true
            try {
                val res = repository.commit(scope.project, msg, _amend.value, scope.worktreePath, scope.root)
                if (scope.matches(activeScope)) {
                    if (res.ok) {
                        _commitMessage.value = ""
                        _amend.value = false
                        refreshChanges()
                    } else {
                        _error.value = res.error ?: "Commit rejected"
                    }
                    onResult(res)
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) {
                    _error.value = t.message ?: "Commit failure"
                    onResult(CommitResponse(ok = false, error = t.message))
                }
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }
}
