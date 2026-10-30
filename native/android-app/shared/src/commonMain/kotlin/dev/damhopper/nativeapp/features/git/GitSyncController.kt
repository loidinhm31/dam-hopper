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
    val host: GitHostPorts,
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

    fun clearScope() {
        activeScope = null
        _lastOpResults.value = null
        _error.value = null
        _isLoading.value = false
    }

    fun revoke() {
        clearScope()
    }

    private fun isSecondaryRoot(scope: GitOperationScope): Boolean =
        scope.root != null && scope.root != "."

    fun clearOpResults() { _lastOpResults.value = null }
    fun fetch(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        if (isSecondaryRoot(scope)) {
            _error.value = "Secondary VCS roots do not support fetch or pull"
            return coroutineScope.launch {}
        }
        val target = GitOpTarget(scope.project, scope.worktreePath)
        val impact = GitMutationImpact.REFS
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.mutation.fetch(null, listOf(target))
                }
                if (guardResult.isSuccess) {
                    val results = guardResult.getOrThrow()
                    val allSuccess = results.all { it.success }
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (allSuccess) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = results.firstOrNull { !it.success }?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        _lastOpResults.value = results
                        onCompleted()
                    }
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
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Fetch error"
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
                if (scope.matches(activeScope)) _error.value = t.message ?: "Fetch error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }

    fun pull(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        if (isSecondaryRoot(scope)) {
            _error.value = "Secondary VCS roots do not support fetch or pull"
            return coroutineScope.launch {}
        }
        val target = GitOpTarget(scope.project, scope.worktreePath)
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.mutation.pull(null, listOf(target))
                }
                if (guardResult.isSuccess) {
                    val results = guardResult.getOrThrow()
                    val allSuccess = results.all { it.success }
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (allSuccess) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = results.firstOrNull { !it.success }?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        _lastOpResults.value = results
                        onCompleted()
                    }
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
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Pull error"
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
                if (scope.matches(activeScope)) _error.value = t.message ?: "Pull error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }

    fun push(onCompleted: () -> Unit = {}): Job {
        val scope = activeScope ?: return coroutineScope.launch {}
        val impact = GitMutationImpact.REFS
        return coroutineScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.mutation.push(scope.project, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.success) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        _lastOpResults.value = listOf(res)
                        if (!res.success) _error.value = res.message ?: "Push rejected"
                        onCompleted()
                    }
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
                    if (scope.matches(activeScope)) _error.value = t?.message ?: "Push error"
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
                if (scope.matches(activeScope)) _error.value = t.message ?: "Push error"
            } finally {
                if (scope.matches(activeScope)) _isLoading.value = false
            }
        }
    }
}
