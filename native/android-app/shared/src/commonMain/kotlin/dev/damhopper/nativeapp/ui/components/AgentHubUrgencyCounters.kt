package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.UrgencyCountersUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_URGENCY_ATTENTION: String = "agent-hub-header:urgency-attention"
const val TAG_URGENCY_WORKING: String = "agent-hub-header:urgency-working"
const val TAG_URGENCY_IDLE: String = "agent-hub-header:urgency-idle"

@Composable
fun AgentHubUrgencyCountersBar(
    counters: UrgencyCountersUiState,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        UrgencyCounterChip(
            label = "! ${counters.attentionCount} Attn",
            description = "${counters.attentionCount} agents requiring attention",
            backgroundColor = if (counters.attentionCount > 0) Color(0xFFD29922).copy(alpha = 0.25f) else DamHopperColors.SurfaceVariant,
            textColor = if (counters.attentionCount > 0) Color(0xFFE3B341) else DamHopperColors.TextSecondary,
            borderColor = if (counters.attentionCount > 0) Color(0xFFD29922) else DamHopperColors.Border,
            testTag = TAG_URGENCY_ATTENTION,
        )
        UrgencyCounterChip(
            label = "● ${counters.workingCount} Work",
            description = "${counters.workingCount} agents working",
            backgroundColor = if (counters.workingCount > 0) Color(0xFF238636).copy(alpha = 0.25f) else DamHopperColors.SurfaceVariant,
            textColor = if (counters.workingCount > 0) Color(0xFF3FB950) else DamHopperColors.TextSecondary,
            borderColor = if (counters.workingCount > 0) Color(0xFF238636) else DamHopperColors.Border,
            testTag = TAG_URGENCY_WORKING,
        )
        UrgencyCounterChip(
            label = "○ ${counters.idleCount} Idle",
            description = "${counters.idleCount} agents idle",
            backgroundColor = DamHopperColors.SurfaceVariant,
            textColor = DamHopperColors.TextSecondary,
            borderColor = DamHopperColors.Border,
            testTag = TAG_URGENCY_IDLE,
        )
    }
}

@Composable
private fun UrgencyCounterChip(
    label: String,
    description: String,
    backgroundColor: Color,
    textColor: Color,
    borderColor: Color,
    testTag: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .testTag(testTag)
            .semantics { contentDescription = description }
            .clip(RoundedCornerShape(6.dp))
            .background(backgroundColor)
            .border(1.dp, borderColor, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
