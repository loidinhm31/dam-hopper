package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun CreateItemDialog(
    isDirectory: Boolean,
    parentPath: String,
    errorMessage: String? = null,
    onConfirm: (name: String) -> Unit,
    onDismiss: () -> Unit,
    draftName: String? = null,
    onDraftChange: ((String) -> Unit)? = null,
    isSubmitting: Boolean = false,
    isUnresolved: Boolean = false,
) {
    var localName by remember(parentPath, isDirectory) { mutableStateOf(draftName ?: "") }
    val effectiveName = draftName ?: localName
    val title = if (isDirectory) "Create Directory" else "Create File"

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(title, style = DamHopperTypography.titleMedium, color = DamHopperColors.TextPrimary)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "In: ${parentPath.ifBlank { "Project Root" }}",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = effectiveName,
                    onValueChange = { updated ->
                        localName = updated
                        onDraftChange?.invoke(updated)
                    },
                    enabled = !isSubmitting && !isUnresolved,
                    label = { Text("Name") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = errorMessage,
                        style = DamHopperTypography.labelSmall,
                        color = if (isUnresolved) DamHopperColors.Warning else DamHopperColors.Error,
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                    ) {
                        Text(if (isUnresolved) "Close" else "Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { if (effectiveName.isNotBlank() && !isSubmitting && !isUnresolved) onConfirm(effectiveName.trim()) },
                        enabled = effectiveName.isNotBlank() && !isSubmitting && !isUnresolved,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    ) {
                        Text(if (isSubmitting) "Creating..." else "Create")
                    }
                }
            }
        }
    }
}

@Composable
fun RenameItemDialog(
    currentName: String,
    errorMessage: String? = null,
    onConfirm: (newName: String) -> Unit,
    onDismiss: () -> Unit,
    sourcePath: String? = null,
    draftNewName: String? = null,
    onDraftChange: ((String) -> Unit)? = null,
    isSubmitting: Boolean = false,
    isUnresolved: Boolean = false,
) {
    var localName by remember(currentName, sourcePath) { mutableStateOf(draftNewName ?: currentName) }
    val effectiveName = draftNewName ?: localName

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Rename Item", style = DamHopperTypography.titleMedium, color = DamHopperColors.TextPrimary)
                if (!sourcePath.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Path: $sourcePath",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = effectiveName,
                    onValueChange = { updated ->
                        localName = updated
                        onDraftChange?.invoke(updated)
                    },
                    enabled = !isSubmitting && !isUnresolved,
                    label = { Text("New Name") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = errorMessage,
                        style = DamHopperTypography.labelSmall,
                        color = if (isUnresolved) DamHopperColors.Warning else DamHopperColors.Error,
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                    ) {
                        Text(if (isUnresolved) "Close" else "Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = {
                            if (effectiveName.isNotBlank() && !isSubmitting && !isUnresolved) {
                                onConfirm(effectiveName.trim())
                            }
                        },
                        enabled = effectiveName.isNotBlank() && effectiveName.trim() != currentName && !isSubmitting && !isUnresolved,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    ) {
                        Text(if (isSubmitting) "Renaming..." else "Rename")
                    }
                }
            }
        }
    }
}

@Composable
fun MoveItemDialog(
    sourcePath: String,
    draftDestDirPath: String = "",
    availableDirectories: List<String> = emptyList(),
    errorMessage: String? = null,
    isSubmitting: Boolean = false,
    isUnresolved: Boolean = false,
    onDraftChange: ((String) -> Unit)? = null,
    onConfirm: (destDirPath: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var localDest by remember(sourcePath) { mutableStateOf(draftDestDirPath) }
    val effectiveDest = if (onDraftChange != null) draftDestDirPath else localDest
    val selectableDirs = remember(availableDirectories, sourcePath) {
        availableDirectories.filter { dir ->
            dir != sourcePath && !FileOperationArbiter.isPathAncestorOrEqual(sourcePath, dir)
        }
    }

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Move Item", style = DamHopperTypography.titleMedium, color = DamHopperColors.TextPrimary)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Source: $sourcePath",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = effectiveDest,
                    onValueChange = { updated ->
                        localDest = updated
                        onDraftChange?.invoke(updated)
                    },
                    enabled = !isSubmitting && !isUnresolved,
                    label = { Text("Destination Directory (blank for Root)") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (selectableDirs.isNotEmpty() && !isUnresolved) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Quick Select Folder:",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        selectableDirs.forEach { dir ->
                            val label = if (dir.isEmpty()) "/ (Root)" else dir
                            val isSelected = effectiveDest.trim().trim('/') == dir
                            TextButton(
                                onClick = {
                                    localDest = dir
                                    onDraftChange?.invoke(dir)
                                },
                                enabled = !isSubmitting,
                                colors = ButtonDefaults.textButtonColors(
                                    containerColor = if (isSelected) DamHopperColors.Primary else DamHopperColors.Surface,
                                ),
                            ) {
                                Text(
                                    text = label,
                                    style = DamHopperTypography.labelSmall,
                                    color = DamHopperColors.TextPrimary,
                                )
                            }
                        }
                    }
                }
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = errorMessage,
                        style = DamHopperTypography.labelSmall,
                        color = if (isUnresolved) DamHopperColors.Warning else DamHopperColors.Error,
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                    ) {
                        Text(if (isUnresolved) "Close" else "Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { if (!isSubmitting && !isUnresolved) onConfirm(effectiveDest.trim()) },
                        enabled = !isSubmitting && !isUnresolved,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    ) {
                        Text(if (isSubmitting) "Moving..." else "Move")
                    }
                }
            }
        }
    }
}

@Composable
fun DeleteConfirmDialog(
    path: String,
    isDirectory: Boolean,
    errorMessage: String? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    isSubmitting: Boolean = false,
    isUnresolved: Boolean = false,
) {
    val title = if (isDirectory) "Delete Directory" else "Delete File"

    Dialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(title, style = DamHopperTypography.titleMedium, color = DamHopperColors.Error)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Are you sure you want to permanently delete '$path'?",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = errorMessage,
                        style = DamHopperTypography.labelSmall,
                        color = if (isUnresolved) DamHopperColors.Warning else DamHopperColors.Error,
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                    ) {
                        Text(if (isUnresolved) "Close" else "Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { if (!isSubmitting && !isUnresolved) onConfirm() },
                        enabled = !isSubmitting && !isUnresolved,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                    ) {
                        Text(if (isSubmitting) "Deleting..." else "Delete")
                    }
                }
            }
        }
    }
}
