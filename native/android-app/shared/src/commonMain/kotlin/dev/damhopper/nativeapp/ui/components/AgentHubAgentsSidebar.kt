package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.AgentRosterUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_AGENTS_SIDEBAR: String = "agent-hub-agents-sidebar"
const val TAG_AGENTS_REFRESH: String = "agent-hub-agents-sidebar:refresh"
const val TAG_AGENTS_SETTINGS: String = "agent-hub-agents-sidebar:settings"

@Composable
fun AgentHubAgentsSidebar(
    roster: AgentRosterUiState,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_AGENTS_SIDEBAR)
            .fillMaxHeight()
            .background(DamHopperColors.Surface)
            .border(1.dp, DamHopperColors.Border)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 1. Header Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "AGENTS",
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(10.dp))
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            ) {
                Text("${roster.totalEligible} eligible", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
            }
        }

        // 2. Status Filter Chips Row
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SidebarFilterChip("All", roster.activeFilter is TerminalAgentsFilterSelection.All) {
                callbacks.onAgentFilterChange(TerminalAgentsFilterSelection.All)
            }
            SidebarFilterChip("! Attn", hasStatus(roster.activeFilter, TerminalAgentsStatus.NEEDS_ATTENTION)) {
                callbacks.onAgentFilterChange(TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.NEEDS_ATTENTION)))
            }
            SidebarFilterChip("● Work", hasStatus(roster.activeFilter, TerminalAgentsStatus.WORKING)) {
                callbacks.onAgentFilterChange(TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.WORKING)))
            }
            SidebarFilterChip("○ Idle", hasStatus(roster.activeFilter, TerminalAgentsStatus.IDLE)) {
                callbacks.onAgentFilterChange(TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.IDLE)))
            }
        }

        // 3. Observed Agents List
        if (roster.isLoading) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
        } else if (roster.agents.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("No agents matching filter", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
            }
        } else {
            LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(roster.agents, key = { it.key }) { agent ->
                    AgentHubAgentCard(agent = agent, onJumpToTerminal = callbacks::onJumpToAgentTerminal)
                }
            }
        }

        // 4. Footer Actions
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SidebarFooterBtn(TAG_AGENTS_REFRESH, "🔄 Refresh", DamHopperColors.TextPrimary, callbacks::onRefreshAgents, Modifier.weight(1f))
            SidebarFooterBtn(TAG_AGENTS_SETTINGS, "Agent ⚙ Host", DamHopperColors.TextSecondary, callbacks::onOpenAgentSettings, Modifier.weight(1f))
        }
    }
}

@Composable
private fun SidebarFilterChip(label: String, isSelected: Boolean, onClick: () -> Unit) {
    val bg = if (isSelected) DamHopperColors.Primary.copy(alpha = 0.2f) else DamHopperColors.SurfaceVariant
    val txt = if (isSelected) DamHopperColors.Primary else DamHopperColors.TextSecondary
    val brd = if (isSelected) DamHopperColors.Primary else DamHopperColors.Border

    Box(
        modifier = Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .border(1.dp, brd, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = label, color = txt, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun SidebarFooterBtn(tag: String, text: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit, modifier: Modifier) {
    Box(
        modifier = modifier
            .testTag(tag)
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun hasStatus(filter: TerminalAgentsFilterSelection, status: TerminalAgentsStatus): Boolean =
    filter is TerminalAgentsFilterSelection.Selected && filter.statuses.contains(status)
