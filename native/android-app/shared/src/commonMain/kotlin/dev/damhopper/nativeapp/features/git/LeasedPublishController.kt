package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class LeasedPublishState {
    object Idle : LeasedPublishState()
    object Preparing : LeasedPublishState()
    data class Ready(val preview: PublishPreview, val capturedScope: GitOperationScope) : LeasedPublishState()
    data class Blocked(val reason: String) : LeasedPublishState()
    object Publishing : LeasedPublishState()
    data class Success(val result: PublishResult) : LeasedPublishState()
    data class Error(val message: String) : LeasedPublishState()
}

/**
 * Controller for CAS-leased publication of rewritten local branch history.
 */
class LeasedPublishController(
    val repository: GitRepository,
    val coroutineScope: CoroutineScope,
    val host: GitHostPorts,
) {
    private val _state = MutableStateFlow<LeasedPublishState>(LeasedPublishState.Idle)
    val state: StateFlow<LeasedPublishState> = _state.asStateFlow()

    private var activePrepareJob: Job? = null

    var activeScope: GitOperationScope? = null
        private set

    var expectedBranch: String? = null
        private set

    var expectedSourceOid: String? = null
        private set

    fun updateScope(scope: GitOperationScope) {
        val changed = !scope.matches(activeScope)
        activeScope = scope
        if (changed) {
            cancel()
        }
    }

    fun revoke() {
        cancel()
        activeScope = null
    }

    fun prepareWithReceipt(receipt: RewriteReceipt): Job {
        val scope = activeScope
        if (scope == null || !receipt.scope.matches(scope)) {
            _state.value = LeasedPublishState.Error("Receipt scope does not match active operation scope")
            return coroutineScope.launch {}
        }

        activePrepareJob?.cancel()
        expectedBranch = receipt.branch
        expectedSourceOid = receipt.sourceOid
        _state.value = LeasedPublishState.Preparing

        val job = coroutineScope.launch {
            try {
                val req = PrepareLeasedPushRequest(
                    branch = receipt.branch,
                    worktreePath = scope.worktreePath,
                    root = scope.root,
                )
                val preview = repository.publish.prepareLeasedPush(scope.project, req)
                if (!scope.matches(activeScope)) return@launch

                if (!preview.isReady || preview.snapshot == null) {
                    _state.value = LeasedPublishState.Blocked(
                        preview.message ?: preview.reason ?: "Leased publication blocked"
                    )
                    return@launch
                }

                val snap = preview.snapshot
                if (snap.branch != receipt.branch || snap.sourceOid != receipt.sourceOid) {
                    _state.value = LeasedPublishState.Blocked(
                        "Prepared snapshot mismatch: expected branch ${receipt.branch} at ${receipt.sourceOid}, got ${snap.branch} at ${snap.sourceOid}"
                    )
                    return@launch
                }

                _state.value = LeasedPublishState.Ready(preview, scope)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if (scope.matches(activeScope)) {
                    _state.value = LeasedPublishState.Error(t.message ?: "Failed to prepare leased push")
                }
            }
        }
        activePrepareJob = job
        return job
    }

    fun confirmPublish(onComplete: (PublishResult) -> Unit = {}): Job {
        val currentReady = _state.value as? LeasedPublishState.Ready ?: run {
            return coroutineScope.launch {
                onComplete(PublishResult(status = "rejected", message = "No prepared preview to publish"))
            }
        }
        val snapshot = currentReady.preview.snapshot ?: return coroutineScope.launch {}
        val capturedScope = currentReady.capturedScope

        if (!capturedScope.matches(activeScope)) {
            _state.value = LeasedPublishState.Error("Scope changed since preparation; please re-prepare")
            return coroutineScope.launch {}
        }

        val impact = GitMutationImpact.PUBLICATION
        _state.value = LeasedPublishState.Publishing

        return coroutineScope.launch {
            try {
                val guardResult = host.withMutationGuard(capturedScope, impact, emptyList()) {
                    val req = PublishLeasedPushRequest(
                        snapshot = snapshot,
                        worktreePath = capturedScope.worktreePath,
                        root = capturedScope.root,
                    )
                    repository.publish.publishLeasedPush(capturedScope.project, req)
                }
                if (guardResult.isSuccess) {
                    val res = guardResult.getOrThrow()
                    val kind = if (res.isPublished) GitOutcomeKind.SUCCEEDED else GitOutcomeKind.REJECTED
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = capturedScope,
                            impact = impact,
                            kind = kind,
                            paths = emptyList(),
                            message = res.message,
                        )
                    )
                    if (capturedScope.matches(activeScope)) {
                        if (res.isPublished) {
                            _state.value = LeasedPublishState.Success(res)
                        } else if (res.isStaleRemote) {
                            _state.value = LeasedPublishState.Blocked(
                                "Remote reference changed concurrently (stale remote). Refresh history before retry."
                            )
                        } else {
                            _state.value = LeasedPublishState.Error(res.message ?: "Publication failed: ${res.status}")
                        }
                        onComplete(res)
                    }
                } else {
                    val t = guardResult.exceptionOrNull()
                    host.onMutationOutcome(
                        GitMutationEvent(
                            scope = capturedScope,
                            impact = impact,
                            kind = GitOutcomeKind.REJECTED,
                            paths = emptyList(),
                            message = t?.message,
                        )
                    )
                    if (capturedScope.matches(activeScope)) {
                        _state.value = LeasedPublishState.Error(t?.message ?: "Publication rejected by safety guard")
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                host.onMutationOutcome(
                    GitMutationEvent(
                        scope = capturedScope,
                        impact = impact,
                        kind = GitOutcomeKind.UNKNOWN,
                        paths = emptyList(),
                        message = t.message,
                    )
                )
                if (capturedScope.matches(activeScope)) {
                    _state.value = LeasedPublishState.Error(t.message ?: "Leased publish error")
                }
            }
        }
    }

    fun cancel() {
        activePrepareJob?.cancel()
        activePrepareJob = null
        _state.value = LeasedPublishState.Idle
        expectedBranch = null
        expectedSourceOid = null
    }
}
