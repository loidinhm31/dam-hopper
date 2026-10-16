package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

enum class GitPanelSection {
    CHANGES,
    HISTORY,
    BRANCHES_WORKTREES,
}

@Composable
fun GitPanelScreen(
    historyController: GitHistoryController,
    changesController: GitChangesController,
    branchController: GitBranchController,
    worktreeController: WorktreeMutationController,
    rewriteController: GitRewriteActionController,
    actionController: GitHistoryActionController,
    leasedController: LeasedPublishController,
    syncController: GitSyncController,
    onOpenFileDiff: (String) -> Unit = {},
    onMutationSuccess: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var activeSection by remember { mutableStateOf(GitPanelSection.CHANGES) }
    var modalState by remember { mutableStateOf(GitModalState()) }

    val lastSquashReceipt by rewriteController.lastSquashReceipt.collectAsState()
    val syncResults by syncController.lastOpResults.collectAsState()
    val syncError by syncController.error.collectAsState()

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Top Toolbar
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            GitSectionButton("Changes", activeSection == GitPanelSection.CHANGES) { activeSection = GitPanelSection.CHANGES }
            GitSectionButton("History", activeSection == GitPanelSection.HISTORY) { activeSection = GitPanelSection.HISTORY }
            GitSectionButton("Branches", activeSection == GitPanelSection.BRANCHES_WORKTREES) { activeSection = GitPanelSection.BRANCHES_WORKTREES }
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = { syncController.fetch { changesController.refreshChanges() } },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Fetch", fontSize = 11.sp) }
            Button(
                onClick = { syncController.pull {
                    changesController.refreshChanges()
                    onMutationSuccess()
                } },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Pull", fontSize = 11.sp) }
            Button(
                onClick = { syncController.push { changesController.refreshChanges() } },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Push", fontSize = 11.sp) }
        }

        if (syncError != null) {
            Text(syncError!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(6.dp))
        }

        // Per-target Sync Outcomes Banner
        if (syncResults != null) {
            Column(modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(6.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Sync Outcomes (${syncResults!!.size} targets)", style = DamHopperTypography.labelSmall)
                    TextButton(onClick = { syncController.clearOpResults() }) { Text("Dismiss", fontSize = 10.sp) }
                }
                syncResults!!.forEach { res ->
                    val color = if (res.success) DamHopperColors.Success else DamHopperColors.Error
                    val targetDesc = if (res.worktreePath != null) "${res.projectName}:${res.worktreePath}" else res.projectName
                    val unavailable = if (res.targetUnavailable) " [target unavailable]" else ""
                    Text(
                        "$targetDesc: ${if (res.success) "OK" else (res.message ?: "Failed")}$unavailable",
                        style = DamHopperTypography.bodySmall,
                        color = color
                    )
                }
            }
        }

        // Content
        Box(modifier = Modifier.weight(1f)) {
            when (activeSection) {
                GitPanelSection.CHANGES -> GitChangesView(
                    controller = changesController,
                    onOpenFileDiff = onOpenFileDiff,
                    onUndoLastCommit = { modalState = modalState.copy(showUndoCommitDialog = true) },
                    onMutationSuccess = onMutationSuccess,
                )
                GitPanelSection.HISTORY -> GitHistoryView(
                    historyController = historyController,
                    actionController = actionController,
                    onEditMessage = { modalState = modalState.copy(editMessageTarget = it) },
                    onSquash = { modalState = modalState.copy(squashTargetHashes = it) },
                    onLeasedPush = {
                        leasedController.prepareWithReceipt(it)
                        modalState = modalState.copy(showLeasedPushDialog = true)
                    },
                    onCherryPick = {
                        actionController.cherryPick(it.hash) { res ->
                            if (res.ok) {
                                historyController.loadHistory(resetOffset = true)
                                onMutationSuccess()
                            } else {
                                modalState = modalState.copy(actionErrorResult = res)
                            }
                        }
                    },
                    onRevert = { modalState = modalState.copy(revertTarget = it) },
                    onReset = { modalState = modalState.copy(resetTarget = it) },
                    onDrop = { modalState = modalState.copy(dropTarget = it) },
                    lastSquashReceipt = lastSquashReceipt,
                )
                GitPanelSection.BRANCHES_WORKTREES -> GitBranchesWorktreesView(
                    branchController = branchController,
                    worktreeController = worktreeController,
                    onSelectViewedBranch = { branch ->
                        historyController.selectViewedBranch(branch)
                        activeSection = GitPanelSection.HISTORY
                    },
                    onCreateBranch = { modalState = modalState.copy(showCreateBranchDialog = true) },
                    onAddWorktree = { modalState = modalState.copy(showAddWorktreeDialog = true) },
                    onRemoveWorktree = { wt ->
                        val check = worktreeController.validateRemovalPrecheck(wt)
                        modalState = modalState.copy(removeWorktreeTarget = Pair(wt, check))
                    },
                    onError = { res -> modalState = modalState.copy(actionErrorResult = res) },
                    onMutationSuccess = {
                        branchController.refreshBranches { branches ->
                            val active = branches.firstOrNull { it.isCurrent }
                            historyController.activeScope?.let { sc ->
                                historyController.updateScope(sc, active, active)
                            }
                        }
                        onMutationSuccess()
                    }
                )
            }
        }
    }

    GitModalsHost(
        modalState = modalState,
        historyController = historyController,
        changesController = changesController,
        branchController = branchController,
        worktreeController = worktreeController,
        rewriteController = rewriteController,
        actionController = actionController,
        leasedController = leasedController,
        onDismiss = { modalState = GitModalState() },
        onMutationSuccess = onMutationSuccess,
    )
}

@Composable
private fun GitSectionButton(label: String, isActive: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isActive) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
        ),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
    ) { Text(label, fontSize = 11.sp, color = DamHopperColors.TextPrimary) }
}
