package dev.damhopper.nativeapp.features.agents

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentsPanelScreen as TerminalAgentsScreen
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Sub-products available within WorkbenchPanel.AGENTS.
 */
enum class AgentsSubProduct(val label: String) {
    STORE("Agent Store"),
    MEMORY("Memory"),
    IMPORT("Import"),
    OBSERVATION("Observation")
}

/**
 * Authoritative panel host for WorkbenchPanel.AGENTS.
 * Integrates central Agent Store distribution, agent memory editing/templates,
 * remote git / server directory imports, and live terminal agent observation.
 * Strictly adheres to 0 FABs and dark workbench theme.
 */
@Composable
fun AgentsUnifiedPanelScreen(
    storeController: AgentStoreController,
    memoryController: AgentMemoryController,
    importController: AgentImportController,
    agentReducer: AgentStatusReducer?,
    availableProjects: List<String>,
    onJumpToTerminalSession: (terminalId: String, incarnation: ULong) -> Unit,
    onRefreshObservation: () -> Unit,
    onInstallOmp: () -> Unit,
    onUninstallOmp: () -> Unit,
    onInstallNative: (AgentKind) -> Unit,
    onUninstallNative: (AgentKind) -> Unit,
    onActiveSubProductChanged: (AgentsSubProduct) -> Unit = {},
    modifier: Modifier = Modifier
) {
    var activeSubProduct by remember { mutableStateOf(AgentsSubProduct.STORE) }

    LaunchedEffect(activeSubProduct) {
        onActiveSubProductChanged(activeSubProduct)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // Sub-product segmented switcher row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AgentsSubProduct.entries.forEach { subProd ->
                val isSelected = activeSubProduct == subProd
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                        )
                        .clickable { activeSubProduct = subProd }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = subProd.label,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                        color = if (isSelected) Color.Black else DamHopperColors.TextSecondary
                    )
                }
            }
        }

        // Active Sub-Product Content Host
        Box(modifier = Modifier.fillMaxSize().weight(1f)) {
            when (activeSubProduct) {
                AgentsSubProduct.STORE -> {
                    AgentStoreView(
                        controller = storeController,
                        availableProjects = availableProjects,
                        modifier = Modifier.fillMaxSize()
                    )
                }
                AgentsSubProduct.MEMORY -> {
                    AgentMemoryView(
                        controller = memoryController,
                        modifier = Modifier.fillMaxSize()
                    )
                }
                AgentsSubProduct.IMPORT -> {
                    AgentImportView(
                        controller = importController,
                        onImportComplete = { storeController.loadStore() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
                AgentsSubProduct.OBSERVATION -> {
                    if (agentReducer != null) {
                        TerminalAgentsScreen(
                            reducer = agentReducer,
                            onJumpToTerminalSession = onJumpToTerminalSession,
                            onRefresh = onRefreshObservation,
                            onInstallOmp = onInstallOmp,
                            onUninstallOmp = onUninstallOmp,
                            onInstallNative = onInstallNative,
                            onUninstallNative = onUninstallNative,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = androidx.compose.ui.Alignment.Center
                        ) {
                            Text(
                                text = "Agent Observation Engine not available",
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
