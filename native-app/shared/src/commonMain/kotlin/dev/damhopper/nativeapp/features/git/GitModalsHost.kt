package dev.damhopper.nativeapp.features.git

import androidx.compose.runtime.*

@Composable
fun GitModalsHost(
    modalState: GitModalState,
    historyController: GitHistoryController,
    changesController: GitChangesController,
    branchController: GitBranchController,
    worktreeController: WorktreeMutationController,
    rewriteController: GitRewriteActionController,
    actionController: GitHistoryActionController,
    leasedController: LeasedPublishController,
    onDismiss: () -> Unit,
    onMutationSuccess: () -> Unit = {},
) {
    var pendingError by remember { mutableStateOf<GitActionResult?>(null) }

    LaunchedEffect(modalState.actionErrorResult) {
        if (modalState.actionErrorResult != null) {
            pendingError = modalState.actionErrorResult
        }
    }

    if (modalState.editMessageTarget != null) {
        GitCommitMessageEditDialog(
            targetEntry = modalState.editMessageTarget,
            viewedBranch = historyController.viewedBranch?.name,
            rewriteController = rewriteController,
            onDismiss = onDismiss,
            onSuccess = {
                historyController.loadHistory(resetOffset = true)
                onMutationSuccess()
            }
        )
    }
    if (modalState.squashTargetHashes != null) {
        GitSquashDialog(
            selectedHashes = modalState.squashTargetHashes,
            viewedBranch = historyController.viewedBranch?.name,
            rewriteController = rewriteController,
            onDismiss = onDismiss,
            onSuccess = {
                historyController.loadHistory(resetOffset = true)
                onMutationSuccess()
            }
        )
    }
    if (modalState.showLeasedPushDialog) {
        LeasedPushDialog(
            leasedController = leasedController,
            onDismiss = onDismiss,
            onPublished = {
                historyController.loadHistory(resetOffset = true)
                onMutationSuccess()
            }
        )
    }
    if (modalState.resetTarget != null) {
        GitResetDialog(
            entry = modalState.resetTarget,
            onConfirm = { mode ->
                actionController.reset(modalState.resetTarget.hash, mode) { res ->
                    if (res.ok) {
                        onDismiss()
                        historyController.loadHistory(resetOffset = true)
                        changesController.refreshChanges()
                        onMutationSuccess()
                    } else {
                        pendingError = res
                    }
                }
            },
            onDismiss = onDismiss
        )
    }
    if (modalState.dropTarget != null) {
        GitConfirmSimpleDialog(
            title = "Drop Commit",
            message = "Drop unpushed commit ${modalState.dropTarget.hash.take(7)}? This rewrites local history.",
            confirmLabel = "Drop",
            isDestructive = true,
            onConfirm = {
                actionController.drop(modalState.dropTarget.hash) { res ->
                    if (res.ok) {
                        onDismiss()
                        historyController.loadHistory(resetOffset = true)
                        onMutationSuccess()
                    } else {
                        pendingError = res
                    }
                }
            },
            onDismiss = onDismiss
        )
    }
    if (modalState.revertTarget != null) {
        GitConfirmSimpleDialog(
            title = "Revert Commit",
            message = "Revert commit ${modalState.revertTarget.hash.take(7)} on the checked-out branch?",
            confirmLabel = "Revert",
            onConfirm = {
                actionController.revert(modalState.revertTarget.hash) { res ->
                    if (res.ok) {
                        onDismiss()
                        historyController.loadHistory(resetOffset = true)
                        onMutationSuccess()
                    } else {
                        pendingError = res
                    }
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
                actionController.undoLastCommit { res ->
                    if (res.ok) {
                        onDismiss()
                        changesController.refreshChanges()
                        historyController.loadHistory(resetOffset = true)
                        onMutationSuccess()
                    } else {
                        pendingError = res
                    }
                }
            },
            onDismiss = onDismiss
        )
    }
    if (modalState.showCreateBranchDialog) {
        CreateBranchDialog(
            onDismiss = onDismiss,
            onConfirm = { name, checkout ->
                branchController.createBranch(name = name, checkout = checkout) { res ->
                    if (res.ok) {
                        onDismiss()
                        onMutationSuccess()
                    } else {
                        pendingError = res
                    }
                }
            }
        )
    }
    if (modalState.showAddWorktreeDialog) {
        AddWorktreeDialog(
            onDismiss = onDismiss,
            onConfirm = { branch, path, createBranch ->
                worktreeController.addWorktree(branch, path, createBranch) { res ->
                    if (res.isSuccess) {
                        onDismiss()
                        onMutationSuccess()
                    } else {
                        pendingError = GitActionResult(ok = false, message = res.exceptionOrNull()?.message)
                    }
                }
            }
        )
    }
    if (modalState.removeWorktreeTarget != null) {
        val (wt, check) = modalState.removeWorktreeTarget
        RemoveWorktreeDialog(
            worktree = wt,
            precheck = check,
            onDismiss = onDismiss,
            onConfirm = {
                worktreeController.removeWorktree(wt) { res ->
                    if (res.isSuccess) {
                        onDismiss()
                        onMutationSuccess()
                    } else {
                        pendingError = GitActionResult(ok = false, message = res.exceptionOrNull()?.message)
                    }
                }
            }
        )
    }

    if (pendingError != null) {
        GitErrorDialog(error = pendingError!!, onDismiss = { pendingError = null })
    }
}
