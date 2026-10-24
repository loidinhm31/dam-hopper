package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitBranchesWorktreesView(
    branchController: GitBranchController,
    worktreeController: WorktreeMutationController,
    onSelectViewedBranch: (GitBranch) -> Unit,
    onCreateBranch: () -> Unit,
    onAddWorktree: () -> Unit,
    onRemoveWorktree: (ProjectWorktree) -> Unit,
    onError: (GitActionResult) -> Unit = {},
    onMutationSuccess: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val branches by branchController.branches.collectAsState()
    val worktrees by worktreeController.worktrees.collectAsState()
    val branchError by branchController.error.collectAsState()
    val worktreeError by worktreeController.error.collectAsState()

    var showWorktreesTab by remember { mutableStateOf(false) }
    var branchToDelete by remember { mutableStateOf<GitBranch?>(null) }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showWorktreesTab = false },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (!showWorktreesTab) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                ) { Text("Branches (${branches.size})", fontSize = 12.sp) }
                Button(
                    onClick = { showWorktreesTab = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (showWorktreesTab) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                ) { Text("Worktrees (${worktrees.size})", fontSize = 12.sp) }
            }
            if (!showWorktreesTab) {
                Button(onClick = onCreateBranch, colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                    Text("+ Branch", fontSize = 12.sp)
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Button(onClick = onAddWorktree, colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                        Text("+ Worktree", fontSize = 12.sp)
                    }
                    Button(
                        onClick = {
                            worktreeController.pruneWorktrees { res ->
                                if (res.isSuccess) onMutationSuccess() else onError(GitActionResult(ok = false, message = res.exceptionOrNull()?.message))
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text("Prune", fontSize = 12.sp)
                    }
                }
            }
        }

        if (branchError != null && !showWorktreesTab) {
            Text(branchError!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(8.dp))
        }
        if (worktreeError != null && showWorktreesTab) {
            Text(worktreeError!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(8.dp))
        }

        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
            if (!showWorktreesTab) {
                items(branches, key = { it.name }) { branch ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).background(DamHopperColors.Surface).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = branch.name,
                                    style = DamHopperTypography.labelSmall,
                                    color = if (branch.isCurrent) DamHopperColors.Primary else DamHopperColors.TextPrimary
                                )
                                if (branch.isCurrent) {
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("(current)", fontSize = 10.sp, color = DamHopperColors.Primary)
                                }
                            }
                            if (branch.trackingBranch != null) {
                                Text("Tracking: ${branch.trackingBranch}", fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { onSelectViewedBranch(branch) }) {
                                Text("View", fontSize = 11.sp, color = DamHopperColors.Primary)
                            }
                            if (!branch.isCurrent && branch.isLocal) {
                                TextButton(onClick = {
                                    branchController.checkoutBranch(branch.name) { res ->
                                        if (res.ok) onMutationSuccess() else onError(res)
                                    }
                                }) {
                                    Text("Checkout", fontSize = 11.sp, color = DamHopperColors.Primary)
                                }
                                TextButton(onClick = { branchToDelete = branch }) {
                                    Text("Delete", fontSize = 11.sp, color = DamHopperColors.Error)
                                }
                            } else if (branch.isCurrent && branch.trackingBranch != null) {
                                TextButton(onClick = {
                                    branchController.updateBranch(branch.name) { res ->
                                        if (res.success) onMutationSuccess() else onError(GitActionResult(ok = false, message = res.reason))
                                    }
                                }) {
                                    Text("Update", fontSize = 11.sp, color = DamHopperColors.Success)
                                }
                            }
                        }
                    }
                }
            } else {
                items(worktrees, key = { it.path }) { wt ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).background(DamHopperColors.Surface).padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(wt.branch.ifBlank { "detached" }, style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                                if (wt.isMain) {
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("(main)", fontSize = 10.sp, color = DamHopperColors.Success)
                                }
                                if (!wt.isAvailable) {
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("(${wt.statusLabel})", fontSize = 10.sp, color = DamHopperColors.Error)
                                }
                            }
                            Text(wt.path, fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                        }
                        if (!wt.isMain) {
                            TextButton(onClick = { onRemoveWorktree(wt) }) {
                                Text("Remove", fontSize = 11.sp, color = DamHopperColors.Error)
                            }
                        }
                    }
                }
            }
        }
    }

    if (branchToDelete != null) {
        GitConfirmSimpleDialog(
            title = "Delete Branch",
            message = "Delete local branch '${branchToDelete!!.name}'? Unmerged changes will be lost.",
            confirmLabel = "Delete",
            isDestructive = true,
            onConfirm = {
                val b = branchToDelete!!
                branchToDelete = null
                branchController.deleteBranch(b.name) { res ->
                    if (res.ok) onMutationSuccess() else onError(res)
                }
            },
            onDismiss = { branchToDelete = null }
        )
    }
}
