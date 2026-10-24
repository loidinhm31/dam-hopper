package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Gutter decoration rendering line-level Git blame attribution.
 */
@Composable
fun EditorBlameGutter(
    lineAttributions: Map<Int, BlameLineAttribution>,
    totalLines: Int,
    onInspectCommit: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.width(110.dp).background(DamHopperColors.SurfaceVariant).padding(vertical = 4.dp, horizontal = 2.dp)
    ) {
        for (line in 1..totalLines) {
            val attr = lineAttributions[line]
            val text = when {
                attr == null -> "—"
                attr.isUncommitted -> "Not Committed"
                attr.commit != null -> {
                    val author = attr.commit.authorName.take(8)
                    val hash = attr.commit.hash.take(6)
                    "$hash $author"
                }
                else -> "—"
            }
            val commitHash = attr?.commit?.hash

            Text(
                text = text,
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (attr?.isUncommitted == true) DamHopperColors.Warning else DamHopperColors.TextSecondary,
                modifier = Modifier.fillMaxWidth().height(18.dp)
                    .clickable(enabled = commitHash != null) {
                        commitHash?.let { onInspectCommit(it) }
                    }
            )
        }
    }
}
