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
    val host: GitHostPorts,
) {
    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        activeScope = scope
    }

    fun revoke() {
        activeScope = null
    }

    fun cherryPick(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.history.cherryPick(scope.project, hash, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during cherry-pick", recommendation = "Re-inspect history before retry"))
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
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Cherry-pick error", recommendation = "Check terminal or working tree status"))
                    }
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
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Cherry-pick error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun cherryPickFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, paths) {
                    repository.history.cherryPickFiles(scope.project, hash, paths, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during cherry-pick files", recommendation = "Re-inspect history before retry"))
                    }
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Cherry-pick files error", recommendation = "Check terminal or working tree status"))
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = paths,
                        message = t.message,
                    )
                )
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Cherry-pick files error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun revert(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.history.revertCommit(scope.project, hash, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during revert", recommendation = "Re-inspect history before retry"))
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
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Revert error", recommendation = "Check terminal or working tree status"))
                    }
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
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Revert error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun revertFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, paths) {
                    repository.history.revertCommitFiles(scope.project, hash, paths, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during revert files", recommendation = "Re-inspect history before retry"))
                    }
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Revert files error", recommendation = "Check terminal or working tree status"))
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = paths,
                        message = t.message,
                    )
                )
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Revert files error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun reset(hash: String, mode: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.history.reset(scope.project, hash, mode, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during reset", recommendation = "Re-inspect history before retry"))
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
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Reset error", recommendation = "Check terminal or working tree status"))
                    }
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
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Reset error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun drop(hash: String, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.HISTORY
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.history.dropCommit(scope.project, hash, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during drop", recommendation = "Re-inspect history before retry"))
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
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Drop error", recommendation = "Check terminal or working tree status"))
                    }
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
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Drop error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun dropFiles(hash: String, paths: List<String>, onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.FILES
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, paths) {
                    repository.history.dropCommitFiles(scope.project, hash, paths, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during drop files", recommendation = "Re-inspect history before retry"))
                    }
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = paths,
                            message = t?.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Drop files error", recommendation = "Check terminal or working tree status"))
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = scope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = paths,
                        message = t.message,
                    )
                )
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Drop files error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    fun undoLastCommit(onResult: (GitActionResult) -> Unit): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope", recommendation = "Ensure project and connection are active"))
        }
        val impact = GitMutationImpact.HISTORY
        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    repository.history.undoLastCommit(scope.project, scope.worktreePath, scope.root)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = if (res.ok) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (scope.matches(activeScope)) {
                        onResult(enrichRecommendation(res))
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during undo commit", recommendation = "Re-inspect history before retry"))
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
                    if (scope.matches(activeScope)) {
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Undo commit error", recommendation = "Check terminal or working tree status"))
                    }
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
                if (scope.matches(activeScope)) {
                    onResult(GitActionResult(ok = false, message = t.message ?: "Undo commit error", recommendation = "Check terminal or working tree status"))
                }
            }
        }
    }

    private fun enrichRecommendation(res: GitActionResult): GitActionResult {
        if (res.ok || res.recommendation != null) return res
        val rec = when {
            res.conflict -> "Resolve conflicts in working tree or abort via terminal: git merge --abort / git cherry-pick --abort"
            res.blockedReason != null -> "Operation blocked (${res.blockedReason}); verify working tree status in terminal"
            else -> "Verify Git repository and branch status in terminal"
        }
        return res.copy(recommendation = rec)
    }
}
