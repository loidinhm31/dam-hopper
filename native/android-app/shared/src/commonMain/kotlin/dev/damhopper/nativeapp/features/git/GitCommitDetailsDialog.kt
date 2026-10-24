package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.clickable
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
import kotlinx.coroutines.launch

@Composable
fun GitCommitDetailsDialog(
    details: GitCommitDetails,
    repository: GitRepository,
    actionController: GitHistoryActionController,
    isLocal: Boolean,
    isActive: Boolean,
    onDismiss: () -> Unit,
    onOpenFileDiff: ((path: String) -> Unit)? = null,
) {
    val coroutineScope = rememberCoroutineScope()
    var files by remember { mutableStateOf<List<DiffFileEntry>>(emptyList()) }
    var selectedFiles by remember { mutableStateOf<Set<String>>(emptySet()) }
    var fileDiffContent by remember { mutableStateOf<FileDiffContent?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    val scope = actionController.activeScope

    LaunchedEffect(details.hash) {
        if (scope != null) {
            try {
                files = repository.query.getCommitFiles(scope.project, details.hash, scope.worktreePath, scope.root)
            } catch (_: Exception) {}
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(details.subject, style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
                Text("Hash: ${details.hash}", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                Text("Author: ${details.authorName} <${details.authorEmail}>", style = DamHopperTypography.bodySmall)
                Spacer(modifier = Modifier.height(4.dp))
                Text(details.fullMessage, style = DamHopperTypography.bodySmall, maxLines = 4)
                Spacer(modifier = Modifier.height(8.dp))

                if (files.isNotEmpty()) {
                    Text("Changed Files (${files.size}):", style = DamHopperTypography.labelSmall)
                    LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        items(files) { file ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth().clickable {
                                    scope?.let {
                                        coroutineScope.launch {
                                            try {
                                                fileDiffContent = repository.query.getCommitFileDiff(it.project, details.hash, file.path, it.worktreePath, it.root)
                                            } catch (_: Exception) {}
                                        }
                                    }
                                }
                            ) {
                                Checkbox(
                                    checked = selectedFiles.contains(file.path),
                                    onCheckedChange = {
                                        selectedFiles = if (selectedFiles.contains(file.path)) selectedFiles - file.path else selectedFiles + file.path
                                    },
                                    modifier = Modifier.size(24.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(file.path, style = DamHopperTypography.bodySmall, modifier = Modifier.weight(1f))
                                Text(file.status, fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                            }
                        }
                    }

                    if (selectedFiles.isNotEmpty()) {
                        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Button(
                                onClick = {
                                    actionController.cherryPickFiles(details.hash, selectedFiles.toList()) { res ->
                                        statusMessage = res.message ?: if (res.ok) "Files cherry-picked" else "Cherry-pick failed"
                                    }
                                },
                                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text("Pick Files", fontSize = 10.sp)
                            }
                            Button(
                                onClick = {
                                    actionController.revertFiles(details.hash, selectedFiles.toList()) { res ->
                                        statusMessage = res.message ?: if (res.ok) "Files reverted" else "Revert failed"
                                    }
                                },
                                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text("Revert Files", fontSize = 10.sp)
                            }
                            if (isActive) {
                                Button(
                                    onClick = {
                                        actionController.dropFiles(details.hash, selectedFiles.toList()) { res ->
                                            statusMessage = res.message ?: if (res.ok) "Files dropped" else "Drop failed"
                                        }
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text("Drop Files", fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }

                if (fileDiffContent != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Diff: ${fileDiffContent!!.path}", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                    Text(fileDiffContent!!.modified ?: "no content", style = DamHopperTypography.bodySmall, maxLines = 6)
                }

                if (statusMessage != null) {
                    Text(statusMessage!!, style = DamHopperTypography.bodySmall, color = DamHopperColors.Primary, modifier = Modifier.padding(top = 4.dp))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    )
}
