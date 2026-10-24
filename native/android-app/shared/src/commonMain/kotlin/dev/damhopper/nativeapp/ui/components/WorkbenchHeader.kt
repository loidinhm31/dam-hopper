package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily

@Composable
fun WorkbenchHeader(
    state: WorkbenchState,
    targetLabel: String? = null,
    onOpenProfiles: (() -> Unit)? = null,
    onOpenTargetPicker: (() -> Unit)? = null,
    onOpenWorkspaceSwitcher: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = if (onOpenProfiles != null) {
                Modifier.clickable { onOpenProfiles() }
            } else Modifier
        ) {
            Text(
                text = "DamHopper — ${state.serverName}",
                color = DamHopperColors.TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = state.activeProject,
                    color = if (onOpenTargetPicker != null) DamHopperColors.Accent else DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = if (onOpenTargetPicker != null) Modifier.clickable { onOpenTargetPicker() } else Modifier
                )
                if (targetLabel != null) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .clickable(enabled = onOpenTargetPicker != null) { onOpenTargetPicker?.invoke() }
                            .padding(horizontal = 4.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = targetLabel,
                            color = DamHopperColors.TextPrimary,
                            fontSize = 10.sp,
                            fontFamily = JetBrainsMonoFontFamily
                        )
                    }
                }
                if (onOpenWorkspaceSwitcher != null) {
                    Text(
                        text = "· [WS]",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 11.sp,
                        fontFamily = JetBrainsMonoFontFamily,
                        modifier = Modifier.clickable { onOpenWorkspaceSwitcher() }
                    )
                }
            }
        }
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(DamHopperColors.SurfaceVariant)
                .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
            Text(
                text = state.connectionStatus,
                color = DamHopperColors.Warning,
                fontSize = 10.sp,
                fontFamily = JetBrainsMonoFontFamily
            )
        }
    }
}
