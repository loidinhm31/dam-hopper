package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Dialog for shipping an item to projects and agents.
 */
@Composable
fun ShipItemDialog(
    item: AgentStoreItem,
    availableProjects: List<String>,
    isMutating: Boolean,
    errorMessage: String?,
    onShip: (List<Pair<String, AgentType>>, DistributionMethod) -> Unit,
    onDismiss: () -> Unit
) {
    val selectedTargets = remember { mutableStateListOf<Pair<String, AgentType>>() }
    var selectedMethod by remember { mutableStateOf(DistributionMethod.SYMLINK) }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                .padding(16.dp)
        ) {
            Text(
                text = "Ship ${item.name}",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
            Text(
                text = "Category: ${item.category.displayName}",
                fontSize = 11.sp,
                color = DamHopperColors.TextSecondary,
                modifier = Modifier.padding(bottom = 12.dp)
            )

            // Method selector
            Text("Distribution Method", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
            Row(modifier = Modifier.padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DistributionMethod.entries.forEach { method ->
                    val isSel = selectedMethod == method
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isSel) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                            .clickable { selectedMethod = method }
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = if (method == DistributionMethod.SYMLINK) "Symlink (Recommended)" else "Copy",
                            fontSize = 11.sp,
                            color = if (isSel) Color.Black else DamHopperColors.TextPrimary
                        )
                    }
                }
            }

            Text(
                text = "Select Projects & Agents",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary,
                modifier = Modifier.padding(top = 8.dp)
            )

            // Targets Checklist
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 200.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = 4.dp)
            ) {
                availableProjects.forEach { proj ->
                    Text(proj, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DamHopperColors.Primary, modifier = Modifier.padding(top = 4.dp))
                    Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        AgentType.entries.forEach { ag ->
                            val target = Pair(proj, ag)
                            val isChecked = selectedTargets.contains(target)
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.clickable {
                                    if (isChecked) selectedTargets.remove(target) else selectedTargets.add(target)
                                }
                            ) {
                                Checkbox(
                                    checked = isChecked,
                                    onCheckedChange = { check ->
                                        if (check) selectedTargets.add(target) else selectedTargets.remove(target)
                                    },
                                    colors = CheckboxDefaults.colors(checkedColor = DamHopperColors.Primary)
                                )
                                Text(ag.wireName, fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                            }
                        }
                    }
                }
            }

            errorMessage?.let { err ->
                Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp, modifier = Modifier.padding(vertical = 4.dp))
            }

            // Actions
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onDismiss) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = { onShip(selectedTargets.toList(), selectedMethod) },
                    enabled = selectedTargets.isNotEmpty() && !isMutating,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    if (isMutating) {
                        CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(16.dp))
                    } else {
                        Text("Ship (${selectedTargets.size})", color = Color.Black, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

/**
 * Confirmation dialog for removing an item from the central store.
 */
@Composable
fun DeleteConfirmDialog(
    item: AgentStoreItem,
    isMutating: Boolean,
    errorMessage: String? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete Store Item", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Are you sure you want to permanently delete \"${item.name}\" (${item.category.displayName}) from the central Agent Store?\nThis does not automatically unship existing copies from projects.",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp
                )
                errorMessage?.let { err ->
                    Text("Error: $err", color = DamHopperColors.Error, fontSize = 11.sp)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = !isMutating,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
            ) {
                if (isMutating) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(16.dp))
                } else {
                    Text("Delete", color = Color.White)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = DamHopperColors.TextSecondary)
            }
        },
        containerColor = DamHopperColors.Surface
    )
}

/**
 * Dialog displaying granular bulk ship outcomes per item and target.
 */
@Composable
fun BulkShipResultsDialog(
    results: List<ShipResult>,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Ship Results", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 250.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                results.forEach { res ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                            .padding(6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${res.item} -> ${res.project}:${res.agent.wireName}", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                            res.error?.let { err ->
                                Text(err, fontSize = 10.sp, color = DamHopperColors.Error)
                            }
                        }
                        Text(
                            text = if (res.success) "✓ Success" else "✗ Failed",
                            color = if (res.success) DamHopperColors.Secondary else DamHopperColors.Error,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)) {
                Text("Close", color = Color.Black)
            }
        },
        containerColor = DamHopperColors.Surface
    )
}

/**
 * Dialog displaying the results of scanning workspace projects for existing agent presence.
 */
@Composable
fun ProjectScanResultsDialog(
    scanResults: List<ProjectAgentScanResult>,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Project Agent Presence", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 300.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                scanResults.forEach { proj ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(proj.projectName, color = DamHopperColors.Primary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        proj.agents.forEach { (agentName, presence) ->
                            Text(
                                text = "• $agentName: ${presence.skills.size} skill(s), ${presence.commands.size} command(s), config: ${if (presence.hasConfig) "yes" else "no"}",
                                fontSize = 10.sp,
                                color = DamHopperColors.TextSecondary
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onDismiss, colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)) {
                Text("Close", color = Color.Black)
            }
        },
        containerColor = DamHopperColors.Surface
    )
}
