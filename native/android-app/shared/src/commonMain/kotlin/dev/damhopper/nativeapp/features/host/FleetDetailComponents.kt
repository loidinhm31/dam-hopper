package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun MetricGaugeCard(
    title: String,
    value: String,
    subtitle: String? = null,
    statusColor: Color = DamHopperColors.Primary,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.SurfaceVariant)
            .padding(10.dp)
    ) {
        Text(title, fontSize = 11.sp, color = DamHopperColors.TextSecondary, fontWeight = FontWeight.Medium)
        Spacer(modifier = Modifier.height(4.dp))
        Text(value, fontSize = 16.sp, color = statusColor, fontWeight = FontWeight.Bold)
        if (!subtitle.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(2.dp))
            Text(subtitle, fontSize = 10.sp, color = DamHopperColors.TextSecondary)
        }
    }
}

@Composable
fun AlertIncidentRow(
    alert: AlertIncident,
    modifier: Modifier = Modifier,
) {
    val sevColor = when (alert.severity) {
        AlertSeverity.CRITICAL -> Color(0xFFEF4444)
        AlertSeverity.WARNING -> Color(0xFFF59E0B)
        AlertSeverity.INFO -> Color(0xFF3B82F6)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.SurfaceVariant)
            .padding(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(sevColor.copy(alpha = 0.2f))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(alert.severity.name, fontSize = 10.sp, color = sevColor, fontWeight = FontWeight.Bold)
                }
                Text(alert.state.name, fontSize = 12.sp, color = Color.White, fontWeight = FontWeight.SemiBold)
            }
            Text(
                text = "${alert.durationSeconds}s",
                fontSize = 11.sp,
                color = DamHopperColors.TextSecondary
            )
        }
        if (alert.nextAction.isNotBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Text("Action: ${alert.nextAction}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
        }
    }
}

@Composable
fun StatusChip(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.2f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
    ) {
        Text(text, fontSize = 10.sp, color = color, fontWeight = FontWeight.Bold)
    }
}
