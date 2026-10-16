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
) {
    private val _frozenMessageSnapshot = MutableStateFlow<CommitMessageSnapshot?>(null)
    val frozenMessageSnapshot: StateFlow<CommitMessageSnapshot?> = _frozenMessageSnapshot.asStateFlow()

    private val _lastSquashReceipt = MutableStateFlow<SquashReceipt?>(null)
    val lastSquashReceipt: StateFlow<SquashReceipt?> = _lastSquashReceipt.asStateFlow()

    private val _isMutating = MutableStateFlow(false)
    val isMutating: StateFlow<Boolean> = _isMutating.asStateFlow()

    var activeScope: GitOperationScope? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            _frozenMessageSnapshot.value = null
            _lastSquashReceipt.value = null
        }
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

        return coroutineScope.launch {
            _isMutating.value = true
            try {
                val req = EditCommitMessageRequest(
                    message = newMessage,
                    expectedBranch = snapshot.branch,
                    expectedHeadOid = snapshot.headOid,
                    allowSignatureRemoval = allowSignatureRemoval,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.history.editCommitMessage(scope.project, hash, req)
                if (res.ok && scope.matches(activeScope)) _frozenMessageSnapshot.value = null
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Commit message rewrite error"))
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

        return coroutineScope.launch {
            _isMutating.value = true
            try {
                val req = SquashCommitsRequest(
                    hashes = orderedHashes,
                    message = combinedMessage,
                    expectedBranch = snapshot.branch,
                    expectedHeadOid = snapshot.headOid,
                    allowSignatureRemoval = allowSignatureRemoval,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val res = repository.history.squashCommits(scope.project, req)
                if (res.ok && res.newHeadOid != null && scope.matches(activeScope)) {
                    val receipt = SquashReceipt(
                        branch = snapshot.branch,
                        sourceOid = res.newHeadOid,
                        count = res.rewrittenCount,
                        targetOid = res.newTargetOid,
                        scope = scope,
                    )
                    _lastSquashReceipt.value = receipt
                    _frozenMessageSnapshot.value = null
                }
                onResult(res)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                onResult(GitActionResult(ok = false, message = t.message ?: "Squash execution error"))
            } finally {
                if (scope.matches(activeScope)) _isMutating.value = false
            }
        }
    }

    fun clearReceipt() { _lastSquashReceipt.value = null }
    fun clearSnapshot() { _frozenMessageSnapshot.value = null }
}
