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
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitHistoryView(
    historyController: GitHistoryController,
    actionController: GitHistoryActionController,
    onEditMessage: (GitLogEntry) -> Unit,
    onSquash: (List<String>) -> Unit,
    onLeasedPush: (SquashReceipt) -> Unit,
    onCherryPick: (GitLogEntry) -> Unit,
    onRevert: (GitLogEntry) -> Unit,
    onReset: (GitLogEntry) -> Unit,
    onDrop: (GitLogEntry) -> Unit,
    lastSquashReceipt: SquashReceipt? = null,
    modifier: Modifier = Modifier,
) {
    val entries by historyController.entries.collectAsState()
    val isLoading by historyController.isLoading.collectAsState()
    val error by historyController.error.collectAsState()
    val searchQuery by historyController.searchQuery.collectAsState()
    val selectedHashes by historyController.selectedCommitHashes.collectAsState()
    val commitDetails by historyController.selectedCommitDetails.collectAsState()

    val isLocal = historyController.isViewingLocalBranch
    val isActive = historyController.isViewingActiveBranch
    val viewedName = historyController.viewedBranch?.name ?: "HEAD"
    val activeName = historyController.activeBranch?.name ?: "HEAD"

    val oldestFirstCommits = historyController.getSelectedCommitsOldestFirst()

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Search Toolbar
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { historyController.setSearchQuery(it) },
                placeholder = { Text("Search commit messages (literal)...", fontSize = 12.sp) },
                modifier = Modifier.weight(1f),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = DamHopperColors.TextPrimary,
                    unfocusedTextColor = DamHopperColors.TextPrimary,
                    focusedBorderColor = DamHopperColors.Primary,
                    unfocusedBorderColor = DamHopperColors.Border,
                )
            )
        }

        // Branch Inactive Banner
        if (!isActive && isLocal) {
            Box(
                modifier = Modifier.fillMaxWidth().background(DamHopperColors.Warning.copy(alpha = 0.15f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Viewing inactive branch $viewedName. Cherry-pick and revert apply to checked-out branch $activeName.",
                    style = DamHopperTypography.bodySmall,
                    color = DamHopperColors.Warning,
                )
            }
        } else if (!isLocal) {
            Box(
                modifier = Modifier.fillMaxWidth().background(DamHopperColors.Error.copy(alpha = 0.12f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Viewing remote or detached ref $viewedName. Local commit rewrites disabled.",
                    style = DamHopperTypography.bodySmall,
                    color = DamHopperColors.TextSecondary,
                )
            }
        }

        // Multi-select / Leased push banner
        if (selectedHashes.size >= 2 && isLocal) {
            Row(
                modifier = Modifier.fillMaxWidth().background(DamHopperColors.SurfaceVariant).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("${selectedHashes.size} commits selected", style = DamHopperTypography.labelSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Button(
                        onClick = { oldestFirstCommits?.let { onSquash(it) } },
                        enabled = oldestFirstCommits != null,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                    ) {
                        Text(if (oldestFirstCommits != null) "Squash" else "Non-contiguous", fontSize = 11.sp)
                    }
                    TextButton(onClick = { historyController.clearSelection() }) {
                        Text("Clear", fontSize = 11.sp)
                    }
                }
            }
        }

        if (lastSquashReceipt != null) {
            Row(
                modifier = Modifier.fillMaxWidth().background(DamHopperColors.Success.copy(alpha = 0.2f)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Squash ready: ${lastSquashReceipt.count} commits rewritten on ${lastSquashReceipt.branch}", style = DamHopperTypography.bodySmall)
                Button(onClick = { onLeasedPush(lastSquashReceipt) }, colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success)) {
                    Text("Leased Push", fontSize = 11.sp)
                }
            }
        }

        if (error != null) {
            Text(text = error!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(8.dp))
        }

        // Commit Log List
        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
            items(entries, key = { it.hash }) { entry ->
                GitCommitRow(
                    entry = entry,
                    isSelected = selectedHashes.contains(entry.hash),
                    canSelect = isLocal,
                    onToggleSelect = { historyController.toggleCommitSelection(entry.hash) },
                    onInspect = { historyController.inspectCommit(entry.hash) },
                    onEditMessage = { onEditMessage(entry) },
                    onCherryPick = { onCherryPick(entry) },
                    onRevert = { onRevert(entry) },
                    onReset = { onReset(entry) },
                    onDrop = { onDrop(entry) },
                    isLocal = isLocal,
                    isActive = isActive,
                )
            }
            if (entries.isNotEmpty()) {
                item {
                    Box(modifier = Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                        Button(
                            onClick = { historyController.loadHistory(resetOffset = false) },
                            enabled = !isLoading,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
                        ) {
                            Text("Load More Commits", fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }

    if (commitDetails != null) {
        GitCommitDetailsDialog(
            details = commitDetails!!,
            repository = historyController.repository,
            actionController = actionController,
            isLocal = isLocal,
            isActive = isActive,
            onDismiss = { historyController.dismissCommitDetails() }
        )
    }
}
