package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controller for remote fetch, pull, and normal fast-forward push operations.
 */
class GitSyncController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
) {
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _lastOpResults = MutableStateFlow<List<GitOpResult>?>(null)
    val lastOpResults: StateFlow<List<GitOpResult>?> = _lastOpResults.asStateFlow()

    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            _lastOpResults.value = null
            _error.value = null
        }
    }

    fun clearOpResults() { _lastOpResults.value = null }

    fun fetch(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        val target = GitOpTarget(scope.project, scope.worktreePath)
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val results = repository.mutation.fetch(null, listOf(target))
                if (scope.matches(activeScope)) {
                    _lastOpResults.value = results
                    onCompleted()
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Fetch error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }

    fun pull(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        val target = GitOpTarget(scope.project, scope.worktreePath)
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val results = repository.mutation.pull(null, listOf(target))
                if (scope.matches(activeScope)) {
                    _lastOpResults.value = results
                    onCompleted()
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Pull error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }

    fun push(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val res = repository.mutation.push(scope.project, scope.worktreePath, scope.root)
                if (scope.matches(activeScope)) {
                    _lastOpResults.value = listOf(res)
                    if (!res.success) _error.value = res.message ?: "Push rejected"
                    onCompleted()
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) _error.value = t.message ?: "Push error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }
}
