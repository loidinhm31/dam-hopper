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

    fun prepareWithReceipt(receipt: SquashReceipt): Job {
        val scope = activeScope
        if (scope == null || !receipt.scope.matches(scope)) {
            _state.value = LeasedPublishState.Error("Receipt scope does not match active operation scope")
            return coroutineScope.launch {}
        }
        return prepare(receipt.branch, receipt.sourceOid)
    }

    fun prepare(branch: String, sourceOid: String): Job {
        val scope = activeScope ?: run {
            _state.value = LeasedPublishState.Error("No active operation scope")
            return coroutineScope.launch {}
        }

        activePrepareJob?.cancel()
        expectedBranch = branch
        expectedSourceOid = sourceOid
        _state.value = LeasedPublishState.Preparing

        val job = coroutineScope.launch {
            try {
                val req = PrepareLeasedPushRequest(
                    branch = branch,
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
                if (snap.branch != branch || snap.sourceOid != sourceOid) {
                    _state.value = LeasedPublishState.Blocked(
                        "Prepared snapshot mismatch: expected branch $branch at $sourceOid, got ${snap.branch} at ${snap.sourceOid}"
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

        _state.value = LeasedPublishState.Publishing

        return coroutineScope.launch {
            try {
                val req = PublishLeasedPushRequest(
                    snapshot = snapshot,
                    worktreePath = capturedScope.worktreePath,
                    root = capturedScope.root,
                )
                val res = repository.publish.publishLeasedPush(capturedScope.project, req)
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
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
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
