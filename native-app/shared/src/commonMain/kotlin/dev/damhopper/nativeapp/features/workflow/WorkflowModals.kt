package dev.damhopper.nativeapp.features.workflow

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun CreateItemDialog(
    defaultProject: String,
    onDismiss: () -> Unit,
    onCreate: (WorkflowTargetDto, ItemKind, String, String?, String?, ItemStatus?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var summary by remember { mutableStateOf("") }
    var selectedKind by remember { mutableStateOf(ItemKind.PLAN) }
    var project by remember { mutableStateOf(defaultProject) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Workflow Item", color = DamHopperColors.TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = summary,
                    onValueChange = { summary = it },
                    label = { Text("Summary (optional)") },
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ItemKind.entries.forEach { kind ->
                        val isSelected = selectedKind == kind
                        Box(
                            modifier = Modifier
                                .background(
                                    if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                                    RoundedCornerShape(4.dp)
                                )
                                .clickable { selectedKind = kind }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = kind.wireName.uppercase(),
                                fontSize = 11.sp,
                                color = if (isSelected) Color.Black else DamHopperColors.TextPrimary
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (title.isNotBlank()) {
                        onCreate(
                            WorkflowTargetDto(project = project),
                            selectedKind,
                            title.trim(),
                            null,
                            summary.trim().ifEmpty { null },
                            ItemStatus.BACKLOG
                        )
                    }
                },
                enabled = title.isNotBlank()
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun StartSessionDialog(
    defaultProject: String,
    onDismiss: () -> Unit,
    onStart: (WorkflowTargetDto, String?, String) -> Unit
) {
    var project by remember { mutableStateOf(defaultProject) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Start Workflow Session", color = DamHopperColors.TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = project,
                    onValueChange = { project = it },
                    label = { Text("Project Target") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val now = WorkflowDomainHelpers.formatIsoNow()
                    onStart(WorkflowTargetDto(project = project), null, now)
                }
            ) {
                Text("Start")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun PurgeHistoryDialog(
    onDismiss: () -> Unit,
    onPurge: (String) -> Unit
) {
    var beforeDate by remember { mutableStateOf("2026-09-01T00:00:00.000Z") }
    var inputError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Purge All Workspace History", color = DamHopperColors.Error) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "This is a workspace-wide operation. It permanently deletes ALL activity events across all projects in the workspace and all soft-deleted notes before the specified cutoff date.",
                    fontSize = 12.sp,
                    color = DamHopperColors.TextSecondary
                )
                inputError?.let { err ->
                    Text(err, color = DamHopperColors.Error, fontSize = 11.sp)
                }
                OutlinedTextField(
                    value = beforeDate,
                    onValueChange = {
                        beforeDate = it
                        inputError = null
                    },
                    label = { Text("Cutoff Date (RFC3339)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val trimmed = beforeDate.trim()
                    val parsed = try {
                        kotlinx.datetime.Instant.parse(trimmed)
                    } catch (_: Exception) {
                        null
                    }
                    if (parsed == null) {
                        inputError = "Must be a valid RFC3339 timestamp (e.g. 2026-09-01T00:00:00.000Z)"
                    } else {
                        onPurge(trimmed)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
            ) {
                Text("Confirm Purge")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun LinkTerminalDialog(
    sessionId: String,
    onDismiss: () -> Unit,
    onLink: (String, Long?) -> Unit
) {
    var terminalId by remember { mutableStateOf("") }
    var incarnationText by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Link Terminal to Session", color = DamHopperColors.TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = terminalId,
                    onValueChange = { terminalId = it },
                    label = { Text("Terminal Session ID") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = incarnationText,
                    onValueChange = { incarnationText = it },
                    label = { Text("Incarnation (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (terminalId.isNotBlank()) {
                        val inc = incarnationText.trim().toLongOrNull()
                        onLink(terminalId.trim(), inc)
                    }
                },
                enabled = terminalId.isNotBlank()
            ) {
                Text("Link")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun LinkAgentDialog(
    sessionId: String,
    onDismiss: () -> Unit,
    onLink: (String, String?, String?) -> Unit
) {
    var agentId by remember { mutableStateOf("") }
    var harnessLabel by remember { mutableStateOf("") }
    var runId by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Link Agent to Session", color = DamHopperColors.TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = agentId,
                    onValueChange = { agentId = it },
                    label = { Text("Agent ID (required)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = harnessLabel,
                    onValueChange = { harnessLabel = it },
                    label = { Text("Harness Label (optional, max 64 chars)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = runId,
                    onValueChange = { runId = it },
                    label = { Text("Run ID (optional, max 128 chars)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (agentId.isNotBlank()) {
                        onLink(
                            agentId.trim(),
                            harnessLabel.trim().ifEmpty { null },
                            runId.trim().ifEmpty { null }
                        )
                    }
                },
                enabled = agentId.isNotBlank()
            ) {
                Text("Link")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun ConfirmDeleteDialog(
    title: String,
    message: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, color = DamHopperColors.Error) },
        text = { Text(message, color = DamHopperColors.TextPrimary, fontSize = 12.sp) },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
            ) {
                Text("Confirm Delete")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun ItemDetailDialog(
    item: ItemDto,
    notes: List<NoteDto> = emptyList(),
    conflictWarning: String? = null,
    onDismiss: () -> Unit,
    onUpdate: (String?, String?, Boolean, ItemStatus?) -> Unit,
    onDelete: () -> Unit,
    onAddNote: (String) -> Unit,
    onDeleteNote: (String, String) -> Unit
) {
    var editingTitle by remember { mutableStateOf(item.title) }
    var editingSummary by remember { mutableStateOf(item.summary ?: "") }
    var noteBody by remember { mutableStateOf("") }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    if (showDeleteConfirm) {
        ConfirmDeleteDialog(
            title = "Delete ${item.kind.wireName.uppercase()} '${item.title}'",
            message = "Are you sure you want to delete this item? Descendant phases and tasks will be cascaded.",
            onDismiss = { showDeleteConfirm = false },
            onConfirm = {
                showDeleteConfirm = false
                onDelete()
                onDismiss()
            }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("${item.kind.wireName.uppercase()} Detail", color = DamHopperColors.TextPrimary)
                StatusBadge(status = item.status)
            }
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                conflictWarning?.let { warn ->
                    Text(text = warn, color = DamHopperColors.Warning, fontSize = 11.sp)
                }

                OutlinedTextField(
                    value = editingTitle,
                    onValueChange = { editingTitle = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = editingSummary,
                    onValueChange = { editingSummary = it },
                    label = { Text("Summary") },
                    modifier = Modifier.fillMaxWidth()
                )

                Text("Status Transitions:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    ItemStatus.entries.filter { WorkflowDomainHelpers.isValidStatusTransition(item.status, it) && it != item.status }.forEach { targetStatus ->
                        Button(
                            onClick = {
                                onUpdate(null, null, false, targetStatus)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                            modifier = Modifier.height(26.dp)
                        ) {
                            Text("-> ${targetStatus.wireName}", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                        }
                    }
                }

                // Notes list
                if (notes.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Notes (${notes.size}):", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                    notes.forEach { note ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                                .padding(6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = note.body,
                                fontSize = 11.sp,
                                color = DamHopperColors.TextPrimary,
                                modifier = Modifier.weight(1f)
                            )
                            Button(
                                onClick = { onDeleteNote(note.id, note.updatedAt) },
                                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface),
                                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                modifier = Modifier.height(22.dp)
                            ) {
                                Text("×", fontSize = 11.sp, color = DamHopperColors.Error)
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))
                Text("Add Note:", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedTextField(
                        value = noteBody,
                        onValueChange = { noteBody = it },
                        placeholder = { Text("Note body...") },
                        modifier = Modifier.weight(1f)
                    )
                    Button(
                        onClick = {
                            if (noteBody.isNotBlank()) {
                                onAddNote(noteBody.trim())
                                noteBody = ""
                            }
                        },
                        enabled = noteBody.isNotBlank()
                    ) {
                        Text("Add")
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onUpdate(
                        editingTitle.takeIf { it != item.title },
                        editingSummary.ifEmpty { null },
                        editingSummary != (item.summary ?: ""),
                        null
                    )
                }
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showDeleteConfirm = true },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Delete")
                }
                TextButton(onClick = onDismiss) { Text("Close") }
            }
        }
    )
}
