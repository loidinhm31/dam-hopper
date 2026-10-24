package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitChangesView(
    controller: GitChangesController,
    onOpenFileDiff: (String) -> Unit = {},
    onUndoLastCommit: (() -> Unit)? = null,
    onMutationSuccess: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val staged by controller.stagedFiles.collectAsState()
    val unstaged by controller.unstagedFiles.collectAsState()
    val untracked by controller.untrackedFiles.collectAsState()
    val commitMsg by controller.commitMessage.collectAsState()
    val amend by controller.amend.collectAsState()
    val isLoading by controller.isLoading.collectAsState()
    val error by controller.error.collectAsState()

    var discardTarget by remember { mutableStateOf<String?>(null) }

    Column(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        // Toolbar with batch actions
        Row(
            modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = { controller.stageAll() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Stage All", fontSize = 12.sp, color = DamHopperColors.TextPrimary) }
            Button(
                onClick = { controller.unstageAll() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Unstage All", fontSize = 12.sp, color = DamHopperColors.TextPrimary) }
            Button(
                onClick = { controller.refreshChanges() },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
            ) { Text("Refresh", fontSize = 12.sp, color = DamHopperColors.TextPrimary) }
        }

        if (error != null) {
            Text(text = error!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(8.dp))
        }

        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
            item {
                Text("Staged Changes (${staged.size})", style = DamHopperTypography.labelSmall, color = DamHopperColors.Success, modifier = Modifier.padding(vertical = 4.dp))
            }
            items(staged) { item ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).clickable { onOpenFileDiff(item.path) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(item.path, style = DamHopperTypography.bodySmall, color = DamHopperColors.TextPrimary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { controller.unstageFile(item.path) }) {
                        Text("Unstage", fontSize = 11.sp, color = DamHopperColors.Primary)
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text("Unstaged Changes (${unstaged.size})", style = DamHopperTypography.labelSmall, color = DamHopperColors.Warning, modifier = Modifier.padding(vertical = 4.dp))
            }
            items(unstaged) { item ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).clickable { onOpenFileDiff(item.path) },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(item.path, style = DamHopperTypography.bodySmall, color = DamHopperColors.TextPrimary, modifier = Modifier.weight(1f))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { controller.stageFile(item.path) }) {
                            Text("Stage", fontSize = 11.sp, color = DamHopperColors.Success)
                        }
                        TextButton(onClick = { discardTarget = item.path }) {
                            Text("Discard", fontSize = 11.sp, color = DamHopperColors.Error)
                        }
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text("Untracked Files (${untracked.size})", style = DamHopperTypography.labelSmall, color = DamHopperColors.TextSecondary, modifier = Modifier.padding(vertical = 4.dp))
            }
            items(untracked) { item ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(item.path, style = DamHopperTypography.bodySmall, color = DamHopperColors.TextSecondary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { controller.stageFile(item.path) }) {
                        Text("Stage", fontSize = 11.sp, color = DamHopperColors.Success)
                    }
                }
            }
        }

        // Commit Box at bottom
        Column(modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(8.dp)) {
            OutlinedTextField(
                value = commitMsg,
                onValueChange = { controller.setCommitMessage(it) },
                label = { Text("Commit message") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = false,
                maxLines = 3,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = DamHopperColors.TextPrimary,
                    unfocusedTextColor = DamHopperColors.TextPrimary,
                    focusedBorderColor = DamHopperColors.Primary,
                    unfocusedBorderColor = DamHopperColors.Border,
                )
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = amend, onCheckedChange = { controller.setAmend(it) }, colors = CheckboxDefaults.colors(checkedColor = DamHopperColors.Primary))
                    Text("Amend HEAD", style = DamHopperTypography.bodySmall, color = DamHopperColors.TextSecondary)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (onUndoLastCommit != null) {
                        TextButton(onClick = onUndoLastCommit) {
                            Text("Undo Commit", fontSize = 11.sp, color = DamHopperColors.Warning)
                        }
                    }
                    Button(
                        onClick = { controller.commit { if (it.ok) onMutationSuccess() } },
                        enabled = !isLoading && commitMsg.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success)
                    ) {
                        Text("Commit", fontSize = 12.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }
    }

    if (discardTarget != null) {
        AlertDialog(
            onDismissRequest = { discardTarget = null },
            title = { Text("Discard Changes") },
            text = { Text("Discard all working-tree changes in ${discardTarget}? This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    val p = discardTarget
                    discardTarget = null
                    p?.let {
                        controller.discardFile(it)
                        onMutationSuccess()
                    }
                }) { Text("Discard", color = DamHopperColors.Error) }
            },
            dismissButton = { TextButton(onClick = { discardTarget = null }) { Text("Cancel") } }
        )
    }
}
