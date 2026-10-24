package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun TerminalPanelPlaceholder(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(4.dp))
            .background(DamHopperColors.Surface)
            .border(width = 1.dp, color = DamHopperColors.Border, shape = RoundedCornerShape(4.dp))
            .padding(12.dp)
    ) {
        Column {
            Text(
                text = "TRADITIONAL TERMINAL (Phase 02 Foundation)",
                color = DamHopperColors.Primary,
                fontFamily = FontFamily.Monospace,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "System: damhopper-native-android (minSdk 29, API 35)\nMode: TERMINAL-only workbench\nZero floating buttons invariant verified.\nSingle top navigation row docked and active.\nLive PTY and WebSocket transport scheduled for Phase 03/07.",
                color = DamHopperColors.TextSecondary,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 18.sp
            )
        }
    }
}

@Composable
fun GenericPanelPlaceholder(
    panel: WorkbenchPanel,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .clip(RoundedCornerShape(4.dp))
            .background(DamHopperColors.Surface)
            .border(width = 1.dp, color = DamHopperColors.Border, shape = RoundedCornerShape(4.dp))
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "${panel.label} Panel",
                color = DamHopperColors.TextPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Module '${panel.name}' foundation ready.\nController will integrate via native KMP store in subsequent phase.",
                color = DamHopperColors.TextSecondary,
                fontSize = 13.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}
