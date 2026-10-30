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
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

@Composable
fun GitPanelScreen(
    runtime: GitWorkspaceRuntime,
    state: GitWorkspaceState,
    modifier: Modifier = Modifier,
) {
    val coroutineScope = rememberCoroutineScope()
    val activeSection by state.section.collectAsState()
    val activeRoute by state.route.collectAsState()
    val currentScope by runtime.scope.collectAsState()
    val roots by runtime.roots.collectAsState()
    val viewedRef by state.viewedRef.collectAsState()
    val checkedOutBranch by state.checkedOutBranch.collectAsState()
    val lastRewriteReceipt by runtime.rewrite.lastRewriteReceipt.collectAsState()
    val syncResults by runtime.sync.lastOpResults.collectAsState()
    val syncError by runtime.sync.error.collectAsState()

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Top Toolbar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            GitSectionButton("Changes", activeSection == GitPanelSection.CHANGES) {
                state.selectSection(GitPanelSection.CHANGES)
                if (activeRoute != GitRoute.Overview) state.navigate(GitRoute.Overview)
            }
            GitSectionButton("History", activeSection == GitPanelSection.HISTORY) {
                state.selectSection(GitPanelSection.HISTORY)
                if (activeRoute != GitRoute.Overview) state.navigate(GitRoute.Overview)
            }
            GitSectionButton("Branches", activeSection == GitPanelSection.BRANCHES_WORKTREES) {
                state.selectSection(GitPanelSection.BRANCHES_WORKTREES)
                if (activeRoute != GitRoute.Overview) state.navigate(GitRoute.Overview)
            }
            Spacer(modifier = Modifier.width(4.dp))

            // Roots dropdown / selector if multiple roots exist
            if (roots.size > 1) {
                var rootsMenuOpen by remember { mutableStateOf(false) }
                val currentRoot = currentScope?.root ?: "."
                Box {
                    Button(
                        onClick = { rootsMenuOpen = true },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text("Root: $currentRoot", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                    DropdownMenu(
                        expanded = rootsMenuOpen,
                        onDismissRequest = { rootsMenuOpen = false }
                    ) {
                        roots.forEach { root ->
                            DropdownMenuItem(
                                text = { Text("${root.path} (${root.kind})") },
                                onClick = {
                                    runtime.selectRoot(root.rootId)
                                    rootsMenuOpen = false
                                }
                            )
                        }
                    }
                }
            }

            Button(
                onClick = { runtime.sync.fetch() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Fetch", fontSize = 11.sp) }
            Button(
                onClick = { runtime.sync.pull() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Pull", fontSize = 11.sp) }
            Button(
                onClick = { runtime.sync.push() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Push", fontSize = 11.sp) }
        }

        // Context details row: distinct target / root / checked-out / viewed
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.5f))
                .padding(horizontal = 8.dp, vertical = 2.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            val targetLabel = if (runtime.owner.worktreePath != null) {
                "${runtime.owner.project} [wt: ${runtime.owner.worktreePath}]"
            } else {
                runtime.owner.project
            }
            Text("Target: $targetLabel", style = DamHopperTypography.bodySmall, color = DamHopperColors.TextSecondary)
            Text("Root: ${currentScope?.root ?: "."}", style = DamHopperTypography.bodySmall, color = DamHopperColors.TextSecondary)
            Text("Checked-out: ${checkedOutBranch ?: "HEAD"}", style = DamHopperTypography.bodySmall, color = DamHopperColors.TextSecondary)
            if (viewedRef != null && viewedRef != checkedOutBranch) {
                Text("Viewed: $viewedRef", style = DamHopperTypography.bodySmall, color = DamHopperColors.Warning)
            }
        }

        if (syncError != null) {
            Text(
                syncError!!,
                color = DamHopperColors.Error,
                style = DamHopperTypography.bodySmall,
                modifier = Modifier.padding(6.dp)
            )
        }

        // Per-target Sync Outcomes Banner
        if (syncResults != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Sync Outcomes (${syncResults!!.size} targets)", style = DamHopperTypography.labelSmall)
                    TextButton(onClick = { runtime.sync.clearOpResults() }) { Text("Dismiss", fontSize = 10.sp) }
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

        // Content switching based on activeRoute
        Box(modifier = Modifier.weight(1f)) {
            when (val route = activeRoute) {
                is GitRoute.Overview -> {
                    when (activeSection) {
                        GitPanelSection.CHANGES -> GitChangesView(
                            controller = runtime.changes,
                            onOpenFileDiff = { path -> state.navigate(GitRoute.Diff(path, null)) },
                            onUndoLastCommit = {
                                state.updateModal(GitModalState(showUndoCommitDialog = true, capturedScope = currentScope))
                            },
                            onMutationSuccess = { runtime.refresh(GitRefreshReason.MUTATION) },
                        )
                        GitPanelSection.HISTORY -> GitHistoryView(
                            historyController = runtime.history,
                            actionController = runtime.actions,
                            onEditMessage = { state.updateModal(GitModalState(editMessageTarget = it, capturedScope = currentScope)) },
                            onSquash = { state.updateModal(GitModalState(squashTargetHashes = it, capturedScope = currentScope)) },
                            onLeasedPush = {
                                runtime.leased.prepareWithReceipt(it)
                                state.updateModal(GitModalState(showLeasedPushDialog = true, capturedScope = currentScope))
                            },
                            onCherryPick = { entry ->
                                runtime.actions.cherryPick(entry.hash) { res ->
                                    if (res.ok) {
                                        runtime.refresh(GitRefreshReason.MUTATION)
                                    } else {
                                        state.updateModal(GitModalState(actionErrorResult = res, capturedScope = currentScope))
                                    }
                                }
                            },
                            onRevert = { state.updateModal(GitModalState(revertTarget = it, capturedScope = currentScope)) },
                            onReset = { state.updateModal(GitModalState(resetTarget = it, capturedScope = currentScope)) },
                            onDrop = { state.updateModal(GitModalState(dropTarget = it, capturedScope = currentScope)) },
                            lastRewriteReceipt = lastRewriteReceipt,
                            onMutationSuccess = { runtime.refresh(GitRefreshReason.MUTATION) },
                            onError = { res -> state.updateModal(GitModalState(actionErrorResult = res, capturedScope = currentScope)) },
                        )
                        GitPanelSection.BRANCHES_WORKTREES -> GitBranchesWorktreesView(
                            branchController = runtime.branches,
                            worktreeController = runtime.worktrees,
                            onSelectViewedBranch = { branch ->
                                runtime.history.selectViewedBranch(branch)
                                state.setViewedRef(branch.name)
                                state.selectSection(GitPanelSection.HISTORY)
                            },
                            onCreateBranch = { state.updateModal(GitModalState(showCreateBranchDialog = true, capturedScope = currentScope)) },
                            onAddWorktree = { state.updateModal(GitModalState(showAddWorktreeDialog = true, capturedScope = currentScope)) },
                            onRemoveWorktree = { wt ->
                                coroutineScope.launch {
                                    val check = runtime.worktrees.validateRemovalPrecheck(wt)
                                    state.updateModal(GitModalState(removeWorktreeTarget = Pair(wt, check), capturedScope = currentScope))
                                }
                            },
                            onError = { res -> state.updateModal(GitModalState(actionErrorResult = res, capturedScope = currentScope)) },
                            onMutationSuccess = { runtime.refresh(GitRefreshReason.MUTATION) }
                        )
                    }
                }
                is GitRoute.Diff -> {
                    LaunchedEffect(route.path, route.commitOid, currentScope) {
                        val sc = currentScope
                        if (sc != null) {
                            runtime.diff.loadDiff(sc, route.path, route.commitOid)
                        }
                    }
                    Column(modifier = Modifier.fillMaxSize()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(DamHopperColors.Surface)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Button(
                                onClick = { state.back() },
                                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                            ) {
                                Text("← Back", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                "Diff: ${route.path}",
                                style = DamHopperTypography.labelSmall,
                                color = DamHopperColors.TextPrimary
                            )
                        }
                        DiffReviewScreen(
                            controller = runtime.diff,
                            onOpenInEditor = { p ->
                                coroutineScope.launch {
                                    val sc = currentScope
                                    if (sc != null) {
                                        runtime.openWorkspaceFile(sc, p)
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
                is GitRoute.Details -> {
                    // Commit details route: inspect details via history controller
                    LaunchedEffect(route.oid) {
                        runtime.history.inspectCommit(route.oid)
                    }
                    val details by runtime.history.selectedCommitDetails.collectAsState()
                    if (details != null) {
                        GitCommitDetailsDialog(
                            details = details!!,
                            repository = runtime.repository,
                            actionController = runtime.actions,
                            isLocal = runtime.history.isViewingLocalBranch,
                            isActive = runtime.history.isViewingActiveBranch,
                            onDismiss = {
                                runtime.history.dismissCommitDetails()
                                state.back()
                            },
                            onOpenFileDiff = { path -> state.navigate(GitRoute.Diff(path, details!!.hash)) },
                            onMutationSuccess = {
                                runtime.refresh(GitRefreshReason.MUTATION)
                                state.back()
                            },
                            onError = { res -> state.updateModal(GitModalState(actionErrorResult = res, capturedScope = currentScope)) }
                        )
                    }
                }
            }
        }
    }

    GitModalsHost(
        runtime = runtime,
        state = state,
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
