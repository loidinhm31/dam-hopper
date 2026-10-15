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

@Composable
fun WorkbenchHeader(
    state: WorkbenchState,
    onOpenProfiles: (() -> Unit)? = null,
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
            Text(
                text = state.activeProject,
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )
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
                fontFamily = FontFamily.Monospace
            )
        }
    }
}
