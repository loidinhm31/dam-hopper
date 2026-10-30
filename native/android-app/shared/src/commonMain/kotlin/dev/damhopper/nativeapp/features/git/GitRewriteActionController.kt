package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controller for Git history rewrite actions: commit message editing and contiguous commit squashing
 * on active or inactive local branches.
 */
class GitRewriteActionController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
    val host: GitHostPorts,
) {
    private val _frozenMessageSnapshot = MutableStateFlow<CommitMessageSnapshot?>(null)
    val frozenMessageSnapshot: StateFlow<CommitMessageSnapshot?> = _frozenMessageSnapshot.asStateFlow()

    private val _lastRewriteReceipt = MutableStateFlow<RewriteReceipt?>(null)
    val lastRewriteReceipt: StateFlow<RewriteReceipt?> = _lastRewriteReceipt.asStateFlow()
    private val _isMutating = MutableStateFlow(false)
    val isMutating: StateFlow<Boolean> = _isMutating.asStateFlow()

    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            _frozenMessageSnapshot.value = null
            _lastRewriteReceipt.value = null
        }
    }

    fun revoke() {
        activeScope = null
        _frozenMessageSnapshot.value = null
        _lastRewriteReceipt.value = null
        _isMutating.value = false
    }

    fun loadMessageSnapshot(
        hash: String,
        branch: String? = null,
        onLoaded: (CommitMessageSnapshot) -> Unit,
        onError: (String) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch { onError("No active scope") }
        return coroutineScope.launch {
            try {
                val snapshot = repository.query.getCommitMessage(
                    project = scope.project,
                    hash = hash,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                    branch = branch,
                )
                if (scope.matches(activeScope)) {
                    _frozenMessageSnapshot.value = snapshot
                    onLoaded(snapshot)
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) onError(t.message ?: "Failed to read commit message snapshot")
            }
        }
    }

    fun editCommitMessage(
        hash: String,
        newMessage: String,
        allowSignatureRemoval: Boolean = false,
        onResult: (GitActionResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        val snapshot = _frozenMessageSnapshot.value ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No frozen snapshot; refresh first"))
        }
        val impact = GitMutationImpact.HISTORY

        return coroutineScope.launch {
            _isMutating.value = true
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    val req = EditCommitMessageRequest(
                        message = newMessage,
                        expectedBranch = snapshot.branch,
                        expectedHeadOid = snapshot.headOid,
                        allowSignatureRemoval = allowSignatureRemoval,
                        worktreePath = scope.worktreePath,
                        root = scope.root,
                    )
                    repository.history.editCommitMessage(scope.project, hash, req)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    val isPublicationUncertain = res.blockedReason == "publication-uncertain" || res.recovery?.operation == "publication-uncertain"
                    val isStaleRef = res.blockedReason == "stale-ref"
                    val kind = if (res.ok) GitOutcomeKind.SUCCEEDED else if (isPublicationUncertain) GitOutcomeKind.UNKNOWN else GitOutcomeKind.REJECTED
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = kind,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )

                    if (isPublicationUncertain || isStaleRef) {
                        if (scope.matches(activeScope)) {
                            _frozenMessageSnapshot.value = null
                            _lastRewriteReceipt.value = null
                        }
                    } else if (res.ok && !res.noOp && !isPublicationUncertain &&
                        res.branch == snapshot.branch &&
                        res.oldHeadOid == snapshot.headOid &&
                        !res.newHeadOid.isNullOrBlank() &&
                        !res.newTargetOid.isNullOrBlank() &&
                        scope.matches(activeScope)
                    ) {
                        val receipt = RewriteReceipt(
                            branch = res.branch,
                            sourceOid = res.newHeadOid,
                            oldHeadOid = res.oldHeadOid,
                            targetOid = res.newTargetOid,
                            rewrittenCount = res.rewrittenCount,
                            scope = scope,
                        )
                        _lastRewriteReceipt.value = receipt
                        _frozenMessageSnapshot.value = null
                    } else if (res.ok && scope.matches(activeScope)) {
                        _frozenMessageSnapshot.value = null
                    }
                    if (scope.matches(activeScope)) {
                        onResult(res)
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during commit rewrite", recommendation = "Re-inspect history before retry"))
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
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Commit message rewrite error"))
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
                    onResult(GitActionResult(ok = false, message = t.message ?: "Commit message rewrite error"))
                }
            } finally {
                if (scope.matches(activeScope)) _isMutating.value = false
            }
        }
    }

    fun squashCommits(
        orderedHashes: List<String>,
        combinedMessage: String,
        allowSignatureRemoval: Boolean = false,
        onResult: (GitActionResult) -> Unit,
    ): Job {
        val scope = activeScope ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No active scope"))
        }
        val snapshot = _frozenMessageSnapshot.value ?: return coroutineScope.launch {
            onResult(GitActionResult(ok = false, message = "No frozen snapshot; refresh first"))
        }

        if (orderedHashes.size < 2) {
            return coroutineScope.launch {
                onResult(GitActionResult(ok = false, message = "Squash requires at least 2 contiguous commits"))
            }
        }
        val impact = GitMutationImpact.HISTORY

        return coroutineScope.launch {
            _isMutating.value = true
            try {
                val guardResult = host.withMutationGuard(scope, impact, emptyList()) {
                    val req = SquashCommitsRequest(
                        hashes = orderedHashes,
                        message = combinedMessage,
                        expectedBranch = snapshot.branch,
                        expectedHeadOid = snapshot.headOid,
                        allowSignatureRemoval = allowSignatureRemoval,
                        worktreePath = scope.worktreePath,
                        root = scope.root,
                    )
                    repository.history.squashCommits(scope.project, req)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    val isPublicationUncertain = res.blockedReason == "publication-uncertain" || res.recovery?.operation == "publication-uncertain"
                    val isStaleRef = res.blockedReason == "stale-ref"
                    val kind = if (res.ok) GitOutcomeKind.SUCCEEDED else if (isPublicationUncertain) GitOutcomeKind.UNKNOWN else GitOutcomeKind.REJECTED
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = scope,
                            impact = impact,
                            kind = kind,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )

                    if (isPublicationUncertain || isStaleRef) {
                        if (scope.matches(activeScope)) {
                            _frozenMessageSnapshot.value = null
                            _lastRewriteReceipt.value = null
                        }
                    } else if (res.ok && !res.noOp && !isPublicationUncertain &&
                        res.branch == snapshot.branch &&
                        res.oldHeadOid == snapshot.headOid &&
                        !res.newHeadOid.isNullOrBlank() &&
                        !res.newTargetOid.isNullOrBlank() &&
                        scope.matches(activeScope)
                    ) {
                        val receipt = RewriteReceipt(
                            branch = res.branch,
                            sourceOid = res.newHeadOid,
                            oldHeadOid = res.oldHeadOid,
                            targetOid = res.newTargetOid,
                            rewrittenCount = res.rewrittenCount,
                            scope = scope,
                        )
                        _lastRewriteReceipt.value = receipt
                        _frozenMessageSnapshot.value = null
                    } else if (res.ok && scope.matches(activeScope)) {
                        _frozenMessageSnapshot.value = null
                    }
                    if (scope.matches(activeScope)) {
                        onResult(res)
                    } else {
                        onResult(GitActionResult(ok = false, message = "Scope changed during squash", recommendation = "Re-inspect history before retry"))
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
                        onResult(GitActionResult(ok = false, message = t?.message ?: "Squash execution error"))
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
                    onResult(GitActionResult(ok = false, message = t.message ?: "Squash execution error"))
                }
            } finally {
                if (scope.matches(activeScope)) _isMutating.value = false
            }
        }
    }

    fun clearReceipt() { _lastRewriteReceipt.value = null }
}
