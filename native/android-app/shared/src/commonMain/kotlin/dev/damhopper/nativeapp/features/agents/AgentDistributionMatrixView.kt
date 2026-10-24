package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Distribution Matrix table showing distribution state across projects and agents.
 */
@Composable
fun AgentDistributionMatrixView(
    items: List<AgentStoreItem>,
    projects: List<String>,
    matrix: Map<String, Map<String, DistributionStatus>>,
    onCellClick: (AgentStoreItem, String, AgentType) -> Unit,
    modifier: Modifier = Modifier
) {
    if (items.isEmpty() || projects.isEmpty()) {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text("No items or projects available for matrix view", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
        }
        return
    }

    val horizontalScroll = rememberScrollState()
    val verticalScroll = rememberScrollState()

    Box(modifier = modifier.padding(8.dp)) {
        Column(modifier = Modifier.verticalScroll(verticalScroll).horizontalScroll(horizontalScroll)) {
            // Header Row
            Row(
                modifier = Modifier
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border)
            ) {
                Box(
                    modifier = Modifier.width(160.dp).padding(8.dp),
                    contentAlignment = Alignment.CenterStart
                ) {
                    Text("Item", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }

                projects.forEach { proj ->
                    AgentType.entries.forEach { ag ->
                        Box(
                            modifier = Modifier.width(90.dp).padding(8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(proj, color = DamHopperColors.TextPrimary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                Text(ag.wireName, color = DamHopperColors.TextSecondary, fontSize = 9.sp)
                            }
                        }
                    }
                }
            }

            // Data Rows
            items.forEach { item ->
                val itemKey = AgentStoreHelpers.itemKey(item.category, item.name)
                val projectMap = matrix[itemKey] ?: emptyMap()

                Row(
                    modifier = Modifier
                        .background(DamHopperColors.Surface)
                        .border(1.dp, DamHopperColors.Border)
                ) {
                    Box(
                        modifier = Modifier.width(160.dp).padding(8.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        Column {
                            Text(item.name, color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                            Text(item.category.displayName, color = DamHopperColors.TextSecondary, fontSize = 9.sp)
                        }
                    }

                    projects.forEach { proj ->
                        AgentType.entries.forEach { ag ->
                            val projKey = AgentStoreHelpers.projectAgentKey(proj, ag)
                            val status = projectMap[projKey]
                            val isShipped = status?.shipped == true
                            val method = status?.method

                            Box(
                                modifier = Modifier
                                    .width(90.dp)
                                    .padding(4.dp)
                                    .clickable {
                                        onCellClick(item, proj, ag)
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isShipped) {
                                    val icon = if (method == DistributionMethod.COPY) "📄 Copy" else "🔗 Link"
                                    Box(
                                        modifier = Modifier
                                            .background(DamHopperColors.Secondary.copy(alpha = 0.2f), RoundedCornerShape(3.dp))
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(icon, color = DamHopperColors.Secondary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                                    }
                                } else {
                                    Text("○ Ship", color = DamHopperColors.TextSecondary.copy(alpha = 0.5f), fontSize = 10.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Reviewed mutation action dialog for a specific matrix cell.
 * Enforces reviewed mutation intents and exposes Ship, Unship, Force Unship, and Absorb.
 */
@Composable
fun CellActionDialog(
    data: CellActionModalData,
    isMutating: Boolean,
    errorMessage: String?,
    onShip: (DistributionMethod) -> Unit,
    onUnship: (Boolean) -> Unit,
    onAbsorb: () -> Unit,
    onDismiss: () -> Unit
) {
    val isShipped = data.status?.shipped == true
    val currentMethod = data.status?.method

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .background(DamHopperColors.Surface, RoundedCornerShape(8.dp))
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = data.item.name,
                color = DamHopperColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Target: ${data.projectName} • Agent: ${data.agent.wireName} • Category: ${data.item.category.displayName}",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.SurfaceVariant, RoundedCornerShape(4.dp))
                    .padding(8.dp)
            ) {
                Text(
                    text = if (isShipped) "Current Status: Shipped via ${currentMethod?.wireName ?: "symlink"}" else "Current Status: Not Shipped",
                    color = if (isShipped) DamHopperColors.Secondary else DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            errorMessage?.let { err ->
                Text(text = err, color = DamHopperColors.Error, fontSize = 11.sp)
            }

            HorizontalDivider(color = DamHopperColors.Border, modifier = Modifier.padding(vertical = 4.dp))

            if (!isShipped) {
                Text("Choose Shipping Method:", fontSize = 11.sp, color = DamHopperColors.TextPrimary, fontWeight = FontWeight.SemiBold)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { onShip(DistributionMethod.SYMLINK) },
                        enabled = !isMutating,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text("Ship (Symlink)", color = Color.Black, fontSize = 11.sp)
                    }
                    Button(
                        onClick = { onShip(DistributionMethod.COPY) },
                        enabled = !isMutating,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text("Ship (Copy)", color = DamHopperColors.TextPrimary, fontSize = 11.sp)
                    }
                }
            } else {
                Text("Available Actions:", fontSize = 11.sp, color = DamHopperColors.TextPrimary, fontWeight = FontWeight.SemiBold)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onUnship(false) },
                            enabled = !isMutating,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Warning.copy(alpha = 0.8f)),
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text("Unship", color = Color.Black, fontSize = 11.sp)
                        }
                        Button(
                            onClick = { onUnship(true) },
                            enabled = !isMutating,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error.copy(alpha = 0.8f)),
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text("Force Unship", color = Color.White, fontSize = 11.sp)
                        }
                    }
                    Button(
                        onClick = onAbsorb,
                        enabled = !isMutating,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(4.dp)
                    ) {
                        Text(
                            text = if (currentMethod == DistributionMethod.COPY) "Absorb (Convert to Central Store Symlink)" else "Absorb (Convert to Project-Local Copy)",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 11.sp
                        )
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) {
                    Text("Close", color = DamHopperColors.TextSecondary)
                }
            }
        }
    }
}
