package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun AddWorktreeDialog(
    onDismiss: () -> Unit,
    onConfirm: (branch: String, path: String?, createBranch: Boolean) -> Unit,
) {
    var branch by remember { mutableStateOf("") }
    var path by remember { mutableStateOf("") }
    var createBranch by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Git Worktree", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    label = { Text("Branch name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text("Path (optional relative or absolute)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Checkbox(checked = createBranch, onCheckedChange = { createBranch = it })
                    Text("Create branch if absent", style = DamHopperTypography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(branch.trim(), path.trim().ifBlank { null }, createBranch) },
                enabled = branch.isNotBlank()
            ) {
                Text("Add")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun RemoveWorktreeDialog(
    worktree: ProjectWorktree,
    precheck: WorktreeRemovalPrecheck,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Remove Worktree", style = DamHopperTypography.titleMedium) },
        text = {
            when (precheck) {
                is WorktreeRemovalPrecheck.Allowed -> {
                    Text(
                        "Are you sure you want to remove worktree '${worktree.path}' for branch '${worktree.branch}'?",
                        style = DamHopperTypography.bodySmall
                    )
                }
                is WorktreeRemovalPrecheck.Blocked -> {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text("Removal Blocked:", style = DamHopperTypography.labelSmall, color = DamHopperColors.Error)
                        precheck.reasons.forEach { reason ->
                            Text("• $reason", style = DamHopperTypography.bodySmall, color = DamHopperColors.Error)
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (precheck is WorktreeRemovalPrecheck.Allowed) {
                Button(
                    onClick = onConfirm,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    Text("Remove")
                }
            } else {
                Button(onClick = onDismiss) { Text("Close") }
            }
        },
        dismissButton = {
            if (precheck is WorktreeRemovalPrecheck.Allowed) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        }
    )
}

@Composable
fun CreateBranchDialog(
    onDismiss: () -> Unit,
    onConfirm: (name: String, checkout: Boolean) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var checkout by remember { mutableStateOf(true) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Branch", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Branch name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Checkbox(checked = checkout, onCheckedChange = { checkout = it })
                    Text("Checkout immediately", style = DamHopperTypography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(name.trim(), checkout) }, enabled = name.isNotBlank()) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
