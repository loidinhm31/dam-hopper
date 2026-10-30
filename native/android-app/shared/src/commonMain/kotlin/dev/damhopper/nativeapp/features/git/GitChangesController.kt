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
    val host: GitHostPorts,
) {
    private val _stagedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val stagedFiles: StateFlow<List<DiffFileEntry>> = _stagedFiles.asStateFlow()

    private val _unstagedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val unstagedFiles: StateFlow<List<DiffFileEntry>> = _unstagedFiles.asStateFlow()

    private val _untrackedFiles = MutableStateFlow<List<DiffFileEntry>>(emptyList())
    val untrackedFiles: StateFlow<List<DiffFileEntry>> = _untrackedFiles.asStateFlow()

    private val _untrackedTruncated = MutableStateFlow(false)
    val untrackedTruncated: StateFlow<Boolean> = _untrackedTruncated.asStateFlow()

    private val _untrackedTotal = MutableStateFlow(0)
    val untrackedTotal: StateFlow<Int> = _untrackedTotal.asStateFlow()

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

    fun clearScope() {
        activeScope = null
        activeRefreshJob?.cancel()
        _stagedFiles.value = emptyList()
        _unstagedFiles.value = emptyList()
        _untrackedFiles.value = emptyList()
        _untrackedTruncated.value = false
        _untrackedTotal.value = 0
        _error.value = null
        _isLoading.value = false
    }

    fun revoke() {
        clearScope()
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
                if (scope.matches(activeScope)) {
                    val staged = mutableListOf<DiffFileEntry>()
                    val unstaged = mutableListOf<DiffFileEntry>()
                    val untracked = mutableListOf<DiffFileEntry>()

                    for (entry in diff.entries) {
                        if (entry.staged) {
                            staged.add(entry)
                        } else if (entry.status == "untracked" || (entry.status == "added" && entry.submodule == null)) {
                            untracked.add(entry)
                        } else {
                            unstaged.add(entry)
                        }
                    }

                    _stagedFiles.value = staged
                    _unstagedFiles.value = unstaged
                    _untrackedFiles.value = untracked
                    _untrackedTruncated.value = diff.untrackedTruncated
                    _untrackedTotal.value = diff.untrackedTotal
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

    fun loadMoreUntracked(limit: Int = 500): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        if (!_untrackedTruncated.value) return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val currentCount = _untrackedFiles.value.size
                val more = repository.query.getUntracked(
                    project = scope.project,
                    worktreePath = scope.worktreePath,
                    offset = currentCount,
                    limit = limit,
                    root = scope.root,
                )
                if (scope.matches(activeScope)) {
                    _untrackedFiles.value = _untrackedFiles.value + more.entries
                    _untrackedTruncated.value = more.untrackedTruncated
                    _untrackedTotal.value = more.untrackedTotal
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Failed to load more untracked files"
            }
        }
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
                val guardResult = host.withMutationGuard(scope, GitMutationImpact.INDEX, paths) {
                    repository.stage(scope.project, paths, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val ok = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.INDEX,
                            kind = if (ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = if (ok) null else "Failed to stage files",
                        )
                    )
                    if (ok && scope.matches(activeScope)) refreshChanges()
                    else if (scope.matches(activeScope)) _error.value = "Failed to stage files"
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.INDEX,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Staging error"
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = GitMutationImpact.INDEX,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = paths,
                        message = t.message,
                    )
                )
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
                val guardResult = host.withMutationGuard(scope, GitMutationImpact.INDEX, paths) {
                    repository.unstage(scope.project, paths, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val ok = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.INDEX,
                            kind = if (ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = if (ok) null else "Failed to unstage files",
                        )
                    )
                    if (ok && scope.matches(activeScope)) refreshChanges()
                    else if (scope.matches(activeScope)) _error.value = "Failed to unstage files"
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.INDEX,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Unstaging error"
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = GitMutationImpact.INDEX,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = paths,
                        message = t.message,
                    )
                )
                if (scope.matches(activeScope)) _error.value = t.message ?: "Unstaging error"
            }
        }
    }

    fun discardFile(path: String): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            try {
                val paths = listOf(path)
                val guardResult = host.withMutationGuard(scope, GitMutationImpact.FILES, paths) {
                    repository.mutation.discard(scope.project, path, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val ok = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.FILES,
                            kind = if (ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = if (ok) null else "Failed to discard file",
                        )
                    )
                    if (ok && scope.matches(activeScope)) refreshChanges()
                    else if (scope.matches(activeScope)) _error.value = "Failed to discard file"
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.FILES,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Discard error"
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = GitMutationImpact.FILES,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = listOf(path),
                        message = t.message,
                    )
                )
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
                val guardResult = host.withMutationGuard(scope, GitMutationImpact.HISTORY, emptyList()) {
                    repository.commit(scope.project, msg, _amend.value, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.HISTORY,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.error,
                        )
                    )
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
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = GitMutationImpact.HISTORY,
                            kind = GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        _error.value = t?.message ?: "Commit failure"
                        onResult(CommitResponse(ok = false, error = t?.message))
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = GitMutationImpact.HISTORY,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = emptyList(),
                        message = t.message,
                    )
                )
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
