package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentGroupItemUiState
import dev.damhopper.nativeapp.ui.flow.AgentStatusKind
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_AGENT_CARD_PREFIX: String = "agent-hub-agent-card:"

@Composable
fun AgentHubAgentCard(
    agent: AgentGroupItemUiState,
    onJumpToTerminal: (agent: AgentGroupItemUiState) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isAttention = agent.status == AgentStatusKind.ATTENTION
    val borderColor = if (isAttention) Color(0xFFD29922) else DamHopperColors.Border

    Column(
        modifier = modifier
            .testTag("$TAG_AGENT_CARD_PREFIX${agent.key}")
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, borderColor, RoundedCornerShape(8.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // 1. Identity Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AgentKindBadge(agent.agentName)
            Text(
                text = "${agent.projectName} ${agent.sessionDisplayId}",
                color = DamHopperColors.TextPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (agent.elapsedDuration.isNotBlank()) {
                Text(
                    text = agent.elapsedDuration,
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }

        // 2. Status Label
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            val statusColor = when (agent.status) {
                AgentStatusKind.ATTENTION -> Color(0xFFE3B341)
                AgentStatusKind.WORKING -> Color(0xFF3FB950)
                AgentStatusKind.IDLE -> DamHopperColors.TextSecondary
            }
            Text(
                text = if (isAttention) "! ${agent.statusLabel}" else agent.statusLabel,
                color = statusColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }

        // 3. Telemetry Event Summary
        if (agent.lastEventSummary.isNotBlank()) {
            Text(
                text = "\"${agent.lastEventSummary}\"",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // 4. Jump CTA Button (>=48dp touch target)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (isAttention) Color(0xFFD29922).copy(alpha = 0.2f) else DamHopperColors.Surface)
                .border(1.dp, if (isAttention) Color(0xFFD29922) else DamHopperColors.Border, RoundedCornerShape(6.dp))
                .clickable { onJumpToTerminal(agent) }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = ">_ Jump to Terminal",
                color = if (isAttention) Color(0xFFE3B341) else DamHopperColors.Primary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun AgentKindBadge(kind: String) {
    val (bgColor, textColor) = when (kind.uppercase()) {
        "CODEX" -> Color(0xFFD29922).copy(alpha = 0.25f) to Color(0xFFE3B341)
        "OMP" -> Color(0xFF1F6FEB).copy(alpha = 0.25f) to Color(0xFF58A6FF)
        "CLAUDE" -> Color(0xFFA371F7).copy(alpha = 0.25f) to Color(0xFFBC8CFF)
        else -> DamHopperColors.Surface to DamHopperColors.TextSecondary
    }
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bgColor)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(text = kind, color = textColor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}
