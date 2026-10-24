package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
fun UsageSettingsSection(
    uiState: UsageUiState,
    onTogglePause: () -> Unit,
    onUpdateSettings: (SettingsPatchRequest) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val s = uiState.settings
    val h = uiState.health

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.Surface)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("SETTINGS & HEALTH", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
            val isPaused = s?.paused ?: h?.paused ?: false
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (isPaused) Color(0xFFF59E0B).copy(alpha = 0.2f) else DamHopperColors.Primary.copy(alpha = 0.2f))
                    .clickable { onTogglePause() }
                    .padding(horizontal = 8.dp, vertical = 3.dp)
            ) {
                Text(
                    text = if (isPaused) "Resume Collection" else "Pause Collection",
                    fontSize = 11.sp,
                    color = if (isPaused) Color(0xFFF59E0B) else DamHopperColors.Primary,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            val isCollectorActive = s?.collectorEnabled ?: false
            Text("Collector: ${if (isCollectorActive) "Active" else "Inactive"}", fontSize = 11.sp, color = Color.White)
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .clickable { onUpdateSettings(SettingsPatchRequest(enabled = !isCollectorActive)) }
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(if (isCollectorActive) "Disable" else "Enable", fontSize = 10.sp, color = DamHopperColors.Primary)
            }
            Text("Exporter: ${s?.collectorSetup?.codexExporter?.name ?: "--"}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
        }

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Retention: ${s?.detailRetentionDays?.let { "${it}d" } ?: "--"}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(7, 30, 90, 180).forEach { days ->
                    val isCur = s?.detailRetentionDays == days
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(if (isCur) DamHopperColors.Primary.copy(alpha = 0.3f) else DamHopperColors.SurfaceVariant)
                            .clickable { onUpdateSettings(SettingsPatchRequest(detailRetentionDays = days)) }
                            .padding(horizontal = 5.dp, vertical = 2.dp)
                    ) {
                        Text("${days}d", fontSize = 9.sp, color = if (isCur) DamHopperColors.Primary else Color.White)
                    }
                }
            }
            Text("Dropped: ${h?.collector?.dropped?.toString() ?: "--"}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
        }

        if ((h?.collector?.dropped ?: 0uL) > 0uL) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFFF59E0B).copy(alpha = 0.2f))
                        .clickable { onUpdateSettings(SettingsPatchRequest(retryCollector = true)) }
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text("Retry Collector", fontSize = 10.sp, color = Color(0xFFF59E0B))
                }
            }
        }
    }
}
