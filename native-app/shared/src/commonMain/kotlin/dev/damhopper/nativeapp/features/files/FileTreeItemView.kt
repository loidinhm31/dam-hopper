package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Renders a single row in the file explorer tree for a virtualized list.
 */
@Composable
fun FileTreeNodeRow(
    node: FileTreeNode,
    depth: Int,
    isSelected: Boolean,
    onToggleFolder: (path: String) -> Unit,
    onSelectNode: (path: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val bgColor = if (isSelected) DamHopperColors.SurfaceVariant else DamHopperColors.Surface
    val indent = (depth * 16).dp

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .background(bgColor)
            .clickable {
                onSelectNode(node.path)
                if (node.isDirectory) {
                    onToggleFolder(node.path)
                }
            }
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .padding(start = indent),
    ) {
        val icon = when {
            node.isDirectory && node.isLoading -> "⏳"
            node.isDirectory && node.isExpanded -> "📂"
            node.isDirectory -> "📁"
            node.isSymlink -> "🔗"
            else -> "📄"
        }

        Text(icon, style = DamHopperTypography.bodyMedium)
        Spacer(modifier = Modifier.width(6.dp))

        Text(
            text = node.name.ifEmpty { "/" },
            style = DamHopperTypography.bodyMedium,
            color = if (node.isDirectory) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            modifier = Modifier.weight(1f),
        )

        if (node.error != null) {
            Text("⚠️", style = DamHopperTypography.labelSmall)
        } else if (!node.isDirectory && node.size > 0uL) {
            Text(
                text = formatFileSize(node.size),
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary,
            )
        }
    }
}

private fun formatFileSize(bytes: ULong): String {
    val b = bytes.toLong()
    return when {
        b < 1024 -> "$b B"
        b < 1024 * 1024 -> "${b / 1024} KB"
        else -> "${b / (1024 * 1024)} MB"
    }
}
