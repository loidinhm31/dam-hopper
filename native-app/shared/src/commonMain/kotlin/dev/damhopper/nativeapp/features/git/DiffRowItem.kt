package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Single aligned diff row for side-by-side or inline layout rendering.
 */
@Composable
fun DiffRowItem(row: DiffRow, mode: DiffLayoutMode) {
    val bg = when {
        row.newType == DiffLineType.ADDED -> DamHopperColors.Success.copy(alpha = 0.15f)
        row.oldType == DiffLineType.DELETED -> DamHopperColors.Error.copy(alpha = 0.15f)
        row.oldType == DiffLineType.HEADER -> DamHopperColors.SurfaceVariant
        else -> DamHopperColors.Background
    }

    Row(modifier = Modifier.fillMaxWidth().background(bg).padding(vertical = 1.dp)) {
        if (mode == DiffLayoutMode.SIDE_BY_SIDE) {
            Text(
                text = row.oldLineNumber?.toString() ?: "",
                fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = DamHopperColors.TextSecondary,
                modifier = Modifier.width(36.dp).padding(horizontal = 2.dp)
            )
            Text(
                text = row.oldContent ?: "",
                fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextPrimary,
                modifier = Modifier.width(340.dp).padding(horizontal = 4.dp)
            )
            VerticalDivider(modifier = Modifier.width(1.dp).height(18.dp), color = DamHopperColors.Border)
            Text(
                text = row.newLineNumber?.toString() ?: "",
                fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = DamHopperColors.TextSecondary,
                modifier = Modifier.width(36.dp).padding(horizontal = 2.dp)
            )
            Text(
                text = row.newContent ?: "",
                fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextPrimary,
                modifier = Modifier.width(340.dp).padding(horizontal = 4.dp)
            )
        } else {
            val lineNum = (row.oldLineNumber?.toString() ?: "") + " " + (row.newLineNumber?.toString() ?: "")
            val sign = when (row.newType) {
                DiffLineType.ADDED -> "+"
                DiffLineType.DELETED -> "-"
                else -> " "
            }
            Text(
                text = lineNum,
                fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = DamHopperColors.TextSecondary,
                modifier = Modifier.width(60.dp).padding(horizontal = 2.dp)
            )
            Text(
                text = "$sign ${row.newContent ?: row.oldContent ?: ""}",
                fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = DamHopperColors.TextPrimary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)
            )
        }
    }
}
