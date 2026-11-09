package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.FileTreeNodeUiState
import dev.damhopper.nativeapp.ui.flow.GitFileStatusKind
import dev.damhopper.nativeapp.ui.flow.WorkspaceFileTreeUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_FILE_TREE_SIDEBAR: String = "workspace-file-tree:sidebar"
const val TAG_FILE_TREE_CLOSE: String = "workspace-file-tree:close-btn"

@Composable
fun WorkspaceFileTreeSidebar(
    state: WorkspaceFileTreeUiState?,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_FILE_TREE_SIDEBAR)
            .fillMaxHeight()
            .background(DamHopperColors.Surface)
            .border(1.dp, DamHopperColors.Border)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (state == null) {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Text("Select a project to inspect files", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
            }
            return@Column
        }

        // 1. Header Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "📁 ${state.projectName} · ⎇ ${state.branchName}",
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .testTag(TAG_FILE_TREE_CLOSE)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .clickable { callbacks.onCloseFilesSidebar() },
                contentAlignment = Alignment.Center,
            ) {
                Text("✕", color = DamHopperColors.TextSecondary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
        }

        // 2. Tree Section Header
        Text(
            text = "WORKSPACE FILE TREE",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        // 3. Tree List
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(state.rootNodes, key = { it.path }) { node ->
                FileTreeNodeItem(
                    node = node,
                    depth = 0,
                    onToggleFolder = callbacks::onToggleFolder,
                    onOpenFile = { path -> callbacks.onOpenFileInEditor(state.targetRef, path) },
                )
            }
        }

        // 4. File Changes Section
        val target = state.targetRef
        WorkspaceFileChangesSection(
            changes = state.fileChanges,
            projectName = state.projectName,
            onOpenEditor = { callbacks.onOpenFileInEditor(target, state.selectedFilePath ?: "") },
            onReviewDiff = { if (target != null) callbacks.onOpenChangesReview(target) },
        )
    }
}

@Composable
private fun FileTreeNodeItem(
    node: FileTreeNodeUiState,
    depth: Int,
    onToggleFolder: (String) -> Unit,
    onOpenFile: (String) -> Unit,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(4.dp))
                .clickable {
                    if (node.isDirectory) onToggleFolder(node.path) else onOpenFile(node.path)
                }
                .padding(start = (depth * 12).dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = if (node.isDirectory) (if (node.isExpanded) "▾ 📁" else "▸ 📁") else "📄",
                fontSize = 11.sp,
            )
            Text(
                text = node.name,
                color = DamHopperColors.TextPrimary,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (node.gitStatus != null) {
                val statusText = when (node.gitStatus) {
                    GitFileStatusKind.MODIFIED -> "M"
                    GitFileStatusKind.UNTRACKED -> "U"
                    GitFileStatusKind.ADDED -> "A"
                    GitFileStatusKind.DELETED -> "D"
                }
                val statusColor = when (node.gitStatus) {
                    GitFileStatusKind.MODIFIED, GitFileStatusKind.ADDED -> Color(0xFF3FB950)
                    GitFileStatusKind.UNTRACKED -> Color(0xFFD29922)
                    GitFileStatusKind.DELETED -> Color(0xFFF85149)
                }
                Text(statusText, color = statusColor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }

        if (node.isDirectory && node.isExpanded) {
            node.children.forEach { child ->
                FileTreeNodeItem(
                    node = child,
                    depth = depth + 1,
                    onToggleFolder = onToggleFolder,
                    onOpenFile = onOpenFile,
                )
            }
        }
    }
}
