package dev.damhopper.nativeapp.features.workspace

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Modal dialog for selecting active project and root/worktree target.
 */
@Composable
fun ProjectTargetPickerModal(
    projects: List<ProjectSummary>,
    currentProject: String,
    worktrees: List<ProjectWorktree>,
    selectedWorktreePath: String?,
    isLoading: Boolean = false,
    onSelectProject: ((String) -> Unit)? = null,
    onSelectTarget: (project: String, worktreePath: String?) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var activeProj by remember { mutableStateOf(currentProject) }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        shape = RoundedCornerShape(8.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Select Project & Worktree Target",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = onDismiss) {
                    Text(text = "Close", color = DamHopperColors.Accent)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Project Selector Chips
            Text(
                text = "Projects",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                projects.forEach { proj ->
                    val isSelected = proj.name == activeProj
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isSelected) DamHopperColors.Accent else DamHopperColors.SurfaceVariant)
                            .clickable {
                                activeProj = proj.name
                                onSelectProject?.invoke(proj.name)
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = proj.name,
                            color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Targets for Selected Project
            Text(
                text = "Targets for '$activeProj'",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(6.dp))

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // 1. Configured Project Root Target
                item {
                    val isRootSelected = activeProj == currentProject && selectedWorktreePath == null
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isRootSelected) DamHopperColors.NavButtonActive else DamHopperColors.SurfaceVariant)
                            .border(
                                width = 1.dp,
                                color = if (isRootSelected) DamHopperColors.Accent else DamHopperColors.Border,
                                shape = RoundedCornerShape(4.dp)
                            )
                            .clickable {
                                onSelectTarget(activeProj, null)
                                onDismiss()
                            }
                            .padding(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Project root (configured)",
                                    color = DamHopperColors.TextPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = "Default repository root directory",
                                    color = DamHopperColors.TextSecondary,
                                    fontSize = 11.sp
                                )
                            }
                            Text(
                                text = "ROOT",
                                color = DamHopperColors.Success,
                                fontSize = 10.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                // 2. Git Worktrees (only rendered for matching active project when not loading)
                if (!isLoading && activeProj == currentProject) {
                    items(worktrees) { wt ->
                        val isWtSelected = activeProj == currentProject && selectedWorktreePath == wt.path
                    val isClickable = wt.isSelectable
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isWtSelected) DamHopperColors.NavButtonActive else DamHopperColors.SurfaceVariant)
                            .border(
                                width = 1.dp,
                                color = if (isWtSelected) DamHopperColors.Accent else DamHopperColors.Border,
                                shape = RoundedCornerShape(4.dp)
                            )
                            .clickable(enabled = isClickable) {
                                onSelectTarget(activeProj, wt.path)
                                onDismiss()
                            }
                            .padding(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = wt.branch.ifBlank { wt.path },
                                    color = if (isClickable) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = wt.path,
                                    color = DamHopperColors.TextSecondary,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(
                                        when {
                                            wt.isPrunable -> DamHopperColors.Error.copy(alpha = 0.2f)
                                            !wt.isAvailable -> DamHopperColors.Warning.copy(alpha = 0.2f)
                                            else -> DamHopperColors.Success.copy(alpha = 0.2f)
                                        }
                                    )
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = wt.statusLabel,
                                    color = when {
                                        wt.isPrunable -> DamHopperColors.Error
                                        !wt.isAvailable -> DamHopperColors.Warning
                                        else -> DamHopperColors.Success
                                    },
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }
                } else {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "Loading targets for '$activeProj'...",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Modal dialog for listing known workspaces, adding new, and triggering switch.
 */
@Composable
fun WorkspaceSwitcherModal(
    status: WorkspaceStatus?,
    knownWorkspaces: List<KnownWorkspace>,
    onRequestSwitch: (path: String) -> Unit,
    onAddWorkspace: (path: String, name: String?) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var newPath by remember { mutableStateOf("") }
    var newName by remember { mutableStateOf("") }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        shape = RoundedCornerShape(8.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Workspaces",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = onDismiss) {
                    Text(text = "Close", color = DamHopperColors.Accent)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Current Active Workspace
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(8.dp)
            ) {
                Column {
                    Text(
                        text = "Active Workspace: ${status?.name ?: "Unknown"}",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Config: ${status?.configPath ?: "None"}",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = "Projects: ${status?.projectCount ?: 0}",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 11.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = "Known Workspaces",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(6.dp))

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(150.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(knownWorkspaces) { kw ->
                    val isCurrent = status?.path == kw.path || status?.configPath == kw.path ||
                        (status?.configPath != null && status.configPath.startsWith("${kw.path.trimEnd('/')}/"))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isCurrent) DamHopperColors.NavButtonActive else DamHopperColors.SurfaceVariant)
                            .clickable {
                                if (!isCurrent) onRequestSwitch(kw.path)
                            }
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = kw.name,
                                color = DamHopperColors.TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = kw.path,
                                color = DamHopperColors.TextSecondary,
                                fontSize = 10.sp,
                                fontFamily = FontFamily.Monospace
                            )
                        }
                        if (isCurrent) {
                            Text(
                                text = "ACTIVE",
                                color = DamHopperColors.Success,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                        } else {
                            Text(
                                text = "Switch",
                                color = DamHopperColors.Accent,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Add Workspace
            OutlinedTextField(
                value = newPath,
                onValueChange = { newPath = it },
                label = { Text("Workspace Directory or dam-hopper.toml Path") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(6.dp))
            OutlinedTextField(
                value = newName,
                onValueChange = { newName = it },
                label = { Text("Friendly Name (optional)") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = {
                    if (newPath.isNotBlank()) {
                        onAddWorkspace(newPath.trim(), newName.trim().ifBlank { null })
                        newPath = ""
                        newName = ""
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Accent)
            ) {
                Text(text = "Add Known Workspace")
            }
        }
    }
}

/**
 * Destructive workspace switch confirmation dialog.
 * Explicitly warns that server-side PTY sessions will be disposed and sandbox reinitialized.
 */
@Composable
fun WorkspaceSwitchWarningDialog(
    targetPath: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = {
            Text(
                text = "Switch Remote Workspace?",
                color = DamHopperColors.Warning,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column {
                Text(
                    text = "You are about to switch active workspace to:",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 13.sp
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = targetPath,
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "WARNING: Switching workspace reloads remote configuration and DISPOSES ALL active terminal sessions on the server. Running processes may terminate.",
                    color = DamHopperColors.Error,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
            ) {
                Text("Confirm Switch")
            }
        },
        dismissButton = {
            OutlinedButton(onClick = onCancel) {
                Text("Cancel")
            }
        },
        containerColor = DamHopperColors.Surface
    )
}
