package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun MediaPreviewCard(
    tab: EditorTab,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().background(DamHopperColors.Background).padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier.fillMaxWidth().padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = if (tab.tier == FileTier.IMAGE) "🖼 Image File" else "🎬 Video File",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.Primary
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "${tab.name} • ${tab.size} bytes",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Media files are previewed via ticketed sessions (Phase 11). Direct editing disabled.",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary
                )
            }
        }
    }
}
