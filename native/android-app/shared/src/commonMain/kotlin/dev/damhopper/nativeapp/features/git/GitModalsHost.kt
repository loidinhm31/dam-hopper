package dev.damhopper.nativeapp.features.git

import androidx.compose.runtime.*

@Composable
fun GitModalsHost(
    runtime: GitWorkspaceRuntime,
    state: GitWorkspaceState,
) {
    val modalState by state.modal.collectAsState()
    val onDismiss = { state.updateModal(GitModalState()) }
    var pendingError by remember { mutableStateOf<GitActionResult?>(null) }

    val currentScope by runtime.scope.collectAsState()
    LaunchedEffect(currentScope) {
        if (modalState.capturedScope != null && !modalState.capturedScope!!.matches(currentScope)) {
            onDismiss()
        }
    }

    LaunchedEffect(modalState.actionErrorResult) {
        if (modalState.actionErrorResult != null) {
            pendingError = modalState.actionErrorResult
        }
    }

    val editTarget = modalState.editMessageTarget
    if (editTarget != null) {
        GitCommitMessageEditDialog(
            targetEntry = editTarget,
            viewedBranch = runtime.history.viewedBranch?.fullRef ?: runtime.history.viewedBranch?.name,
            rewriteController = runtime.rewrite,
            onDismiss = onDismiss,
            onSuccess = {
                onDismiss()
                runtime.refresh(GitRefreshReason.MUTATION)
            }
        )
    }
    val squashHashes = modalState.squashTargetHashes
    if (squashHashes != null) {
        GitSquashDialog(
            selectedHashes = squashHashes,
            viewedBranch = runtime.history.viewedBranch?.fullRef ?: runtime.history.viewedBranch?.name,
            rewriteController = runtime.rewrite,
            onDismiss = onDismiss,
            onSuccess = {
                onDismiss()
                runtime.refresh(GitRefreshReason.MUTATION)
            }
        )
    }
    if (modalState.showLeasedPushDialog) {
        LeasedPushDialog(
            leasedController = runtime.leased,
            onDismiss = onDismiss,
            onPublished = {
                runtime.rewrite.clearReceipt()
                onDismiss()
                runtime.refresh(GitRefreshReason.MUTATION)
            }
        )
    }
    val resetTarget = modalState.resetTarget
    if (resetTarget != null) {
        GitResetDialog(
            entry = resetTarget,
            onConfirm = { mode ->
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.actions.reset(resetTarget.hash, mode) { res ->
                        if (res.ok) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = res
                        }
                    }
                } else {
                    onDismiss()
                }
            },
            onDismiss = onDismiss
        )
    }
    val dropTarget = modalState.dropTarget
    if (dropTarget != null) {
        GitConfirmSimpleDialog(
            title = "Drop Commit",
            message = "Drop unpushed commit ${dropTarget.hash.take(7)}? This rewrites local history.",
            confirmLabel = "Drop",
            isDestructive = true,
            onConfirm = {
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.actions.drop(dropTarget.hash) { res ->
                        if (res.ok) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = res
                        }
                    }
                } else {
                    onDismiss()
                }
            },
            onDismiss = onDismiss
        )
    }
    val revertTarget = modalState.revertTarget
    if (revertTarget != null) {
        GitConfirmSimpleDialog(
            title = "Revert Commit",
            message = "Revert commit ${revertTarget.hash.take(7)} on the checked-out branch?",
            confirmLabel = "Revert",
            onConfirm = {
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.actions.revert(revertTarget.hash) { res ->
                        if (res.ok) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = res
                        }
                    }
                } else {
                    onDismiss()
                }
            },
            onDismiss = onDismiss
        )
    }
    if (modalState.showUndoCommitDialog) {
        GitConfirmSimpleDialog(
            title = "Undo Last Commit",
            message = "Undo the most recent commit with 'git reset --mixed HEAD~1'? Changes will remain unstaged.",
            confirmLabel = "Undo",
            isDestructive = true,
            onConfirm = {
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.actions.undoLastCommit { res ->
                        if (res.ok) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = res
                        }
                    }
                } else {
                    onDismiss()
                }
            },
            onDismiss = onDismiss
        )
    }
    if (modalState.showCreateBranchDialog) {
        CreateBranchDialog(
            onDismiss = onDismiss,
            onConfirm = { name, checkout ->
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.branches.createBranch(name = name, checkout = checkout) { res ->
                        if (res.ok) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = res
                        }
                    }
                } else {
                    onDismiss()
                }
            }
        )
    }
    if (modalState.showAddWorktreeDialog) {
        AddWorktreeDialog(
            onDismiss = onDismiss,
            onConfirm = { branch, path, createBranch ->
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.worktrees.addWorktree(branch, path, createBranch) { res ->
                        if (res.isSuccess) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = GitActionResult(ok = false, message = res.exceptionOrNull()?.message)
                        }
                    }
                } else {
                    onDismiss()
                }
            }
        )
    }
    val removeTarget = modalState.removeWorktreeTarget
    if (removeTarget != null) {
        val (wt, check) = removeTarget
        RemoveWorktreeDialog(
            worktree = wt,
            precheck = check,
            onDismiss = onDismiss,
            onConfirm = {
                val captured = modalState.capturedScope
                if (captured != null && captured.matches(currentScope)) {
                    runtime.worktrees.removeWorktree(wt) { res ->
                        if (res.isSuccess) {
                            onDismiss()
                            runtime.refresh(GitRefreshReason.MUTATION)
                        } else {
                            pendingError = GitActionResult(ok = false, message = res.exceptionOrNull()?.message)
                        }
                    }
                } else {
                    onDismiss()
                }
            }
        )
    }

    if (pendingError != null) {
        GitErrorDialog(error = pendingError!!, onDismiss = { pendingError = null })
    }
}
