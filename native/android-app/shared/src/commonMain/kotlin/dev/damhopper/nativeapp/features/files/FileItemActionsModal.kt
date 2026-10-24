package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Context action modal displayed on hold / long-press of a file tree item.
 * Mirrors Web App TreeContextMenu: Edit/Rename, Delete, New File/Folder, Upload, Download, Copy Path.
 */
@Composable
fun FileItemActionsModal(
    node: FileTreeNode,
    onDismiss: () -> Unit,
    onRename: (path: String) -> Unit,
    onDelete: (path: String) -> Unit,
    onNewFile: (parentDir: String) -> Unit,
    onNewFolder: (parentDir: String) -> Unit,
    onUploadFile: ((targetDir: String) -> Unit)?,
    onDownloadFile: ((path: String, filename: String) -> Unit)?,
    onCopyRelativePath: (path: String) -> Unit,
    onCopyRemotePath: (path: String) -> Unit,
) {
    val parentDir = if (node.isDirectory) node.path else FileTreeHelpers.resolveParentPath(node.path)
    val icon = if (node.isDirectory) "📁" else "📄"

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = DamHopperColors.Surface,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(text = icon, fontSize = 20.sp)
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = node.name.ifEmpty { "/" },
                        style = DamHopperTypography.titleMedium,
                        color = DamHopperColors.TextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = node.path.ifEmpty { "." },
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                // New File
                ActionRow(
                    icon = "📄+",
                    label = if (node.isDirectory) "New File in folder" else "New File in same folder",
                    onClick = {
                        onDismiss()
                        onNewFile(parentDir)
                    }
                )

                // New Folder
                ActionRow(
                    icon = "📁+",
                    label = if (node.isDirectory) "New Folder in folder" else "New Folder in same folder",
                    onClick = {
                        onDismiss()
                        onNewFolder(parentDir)
                    }
                )

                // Upload
                if (onUploadFile != null) {
                    ActionRow(
                        icon = "⬆",
                        label = if (node.isDirectory) "Upload File here" else "Upload File to same folder",
                        onClick = {
                            onDismiss()
                            onUploadFile(parentDir)
                        }
                    )
                }

                // Download (files only)
                if (!node.isDirectory && onDownloadFile != null) {
                    ActionRow(
                        icon = "⬇",
                        label = "Download File to device",
                        onClick = {
                            onDismiss()
                            onDownloadFile(node.path, node.name)
                        }
                    )
                }

                // Rename
                ActionRow(
                    icon = "✏",
                    label = "Rename / Edit Name",
                    onClick = {
                        onDismiss()
                        onRename(node.path)
                    }
                )

                // Copy Relative Path
                ActionRow(
                    icon = "📋",
                    label = "Copy Relative Path",
                    onClick = {
                        onDismiss()
                        onCopyRelativePath(node.path)
                    }
                )

                // Copy Remote Absolute Path
                ActionRow(
                    icon = "🌐",
                    label = "Copy Remote Absolute Path",
                    onClick = {
                        onDismiss()
                        onCopyRemotePath(node.path)
                    }
                )

                Spacer(modifier = Modifier.height(4.dp))

                // Delete
                ActionRow(
                    icon = "🗑",
                    label = if (node.isDirectory) "Delete Folder" else "Delete File",
                    isDanger = true,
                    onClick = {
                        onDismiss()
                        onDelete(node.path)
                    }
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close", color = DamHopperColors.TextSecondary)
            }
        }
    )
}

@Composable
private fun ActionRow(
    icon: String,
    label: String,
    isDanger: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp)
    ) {
        Text(
            text = icon,
            fontSize = 16.sp,
            modifier = Modifier.width(28.dp)
        )
        Text(
            text = label,
            style = DamHopperTypography.bodyMedium,
            color = if (isDanger) DamHopperColors.Error else DamHopperColors.TextPrimary,
            fontWeight = if (isDanger) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f)
        )
    }
}
