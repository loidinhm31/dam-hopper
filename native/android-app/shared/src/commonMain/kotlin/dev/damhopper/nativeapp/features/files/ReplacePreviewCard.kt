package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Renders the preview card with file breakdown and confirm action before batch replace.
 */
@Composable
fun ReplacePreviewCard(
    replaceSummary: ReplacePreviewSummary,
    onApplyReplace: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            Text(
                text = "Replace Preview: '${replaceSummary.searchQuery}' ➔ '${replaceSummary.replaceQuery}' (${replaceSummary.totalMatches} matches in ${replaceSummary.files.size} files)",
                style = DamHopperTypography.bodyMedium,
                color = DamHopperColors.TextPrimary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            replaceSummary.files.take(5).forEach { file ->
                val dirtyText = if (file.isDirtyBlocked) " [DIRTY - SKIPPED]" else ""
                Text(
                    text = "• ${file.path} (${file.matchCount} matches)$dirtyText",
                    style = DamHopperTypography.labelSmall,
                    color = if (file.isDirtyBlocked) DamHopperColors.Warning else DamHopperColors.TextSecondary,
                )
            }
            if (replaceSummary.files.size > 5) {
                Text("… and ${replaceSummary.files.size - 5} more file(s)", style = DamHopperTypography.labelSmall, color = DamHopperColors.TextSecondary)
            }
            Spacer(modifier = Modifier.height(6.dp))
            Button(
                onClick = onApplyReplace,
                enabled = !replaceSummary.isSearchTruncated,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Warning),
            ) {
                Text("Confirm Replace All")
            }
        }
    }
}
