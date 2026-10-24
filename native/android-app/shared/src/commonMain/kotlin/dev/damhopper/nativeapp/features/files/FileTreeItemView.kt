package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
    onHoldNode: (node: FileTreeNode) -> Unit = {},
    modifier: Modifier = Modifier,
    isUnresolved: Boolean = false,
) {
    val bgColor = if (isSelected) DamHopperColors.SurfaceVariant else DamHopperColors.Surface
    val indent = (depth * 16).dp

    @OptIn(ExperimentalFoundationApi::class)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 40.dp)
            .background(bgColor)
            .combinedClickable(
                onClick = {
                    onSelectNode(node.path)
                    if (node.isDirectory && isSelected) {
                        onToggleFolder(node.path)
                    }
                },
                onLongClick = {
                    onHoldNode(node)
                }
            )
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .padding(start = indent),
    ) {
        if (node.isDirectory) {
            val chevron = if (node.isExpanded) "▼" else "▶"
            Text(
                text = chevron,
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary,
                modifier = Modifier
                    .clickable { onToggleFolder(node.path) }
                    .padding(end = 4.dp),
            )
        }
        val icon = when {
            node.isDirectory && node.isLoading -> "⏳"
            node.isDirectory && node.isExpanded -> "📂"
            node.isDirectory -> "📁"
            node.isSymlink -> "🔗"
            else -> "📄"
        }

        Text(
            text = icon,
            style = DamHopperTypography.bodyMedium,
            modifier = Modifier.clickable {
                if (node.isDirectory) {
                    onToggleFolder(node.path)
                } else {
                    onSelectNode(node.path)
                }
            },
        )
        Spacer(modifier = Modifier.width(6.dp))

        Text(
            text = node.name.ifEmpty { "/" },
            style = DamHopperTypography.bodyMedium,
            color = if (node.isDirectory) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
            modifier = Modifier.weight(1f),
        )

        if (isUnresolved) {
            Text(
                text = "Unresolved",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.Warning,
            )
            Spacer(modifier = Modifier.width(6.dp))
        }

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
