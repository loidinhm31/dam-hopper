# Phase 05 — Right File Tree & Changes

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 2.0h
- **Owner**: UI Components (`:shared`)
- **Dependencies**: Phase 01 (`define-agent-hub-state-models`, `define-agent-hub-callbacks`)

---

## Context & Objectives
Implement the Right Workspace File Tree and File Changes Sidebar bound to the active or selected project.
Requirements:
1. Pinned width: `280–320dp` on expanded tablet viewports (`>=840dp`), or modal right drawer / bottom sheet on phone & foldable screens (`<840dp`).
2. Titlebar:
   - Project name + active branch (`dam-hopper · ⎇ main`).
   - Close/collapse button `[✕]` (`>=48x48dp` touch target) executing `callbacks.onCloseFilesSidebar()`.
3. Workspace File Tree Section:
   - Section header: `"WORKSPACE FILE TREE"`.
   - Hierarchical node rows with expand/collapse folder chevrons (`▾`, `▸`), file icons (`📄`), and Git status indicators (`[M]` green, `[U]` amber).
   - Tapping any file node triggers `callbacks.onOpenFileInEditor(targetRef, path)`.
4. File Changes Section:
   - Section header: `"FILE CHANGES (X staged, Y unstaged)"`.
   - Categorized lists: `● Staged (N)` and `○ Unstaged (N)`.
   - Direct launch CTAs: `[Open in Editor ↗]` (`#1F6FEB`) and `[Review Diff ⎇]` (`#21262D`) with `>=48x48dp` touch targets.

Modularized into two files under 200 lines:
- `WorkspaceFileChangesSection.kt`: Staged/unstaged Git file changes overview and launch CTAs.
- `WorkspaceFileTreeSidebar.kt`: Titlebar, hierarchical tree rows, and sidebar layout container.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkspaceFileChangesSection.kt` (NEW)
**Target Line Count**: ~140 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.FileChangeSummaryUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_FILE_CHANGES_ROOT: String = "agent-hub-file-changes-section"
const val TAG_OPEN_EDITOR_BUTTON: String = "agent-hub-files:open-editor-button"
const val TAG_REVIEW_DIFF_BUTTON: String = "agent-hub-files:review-diff-button"

@Composable
fun WorkspaceFileChangesSection(
    changes: FileChangeSummaryUiState,
    projectName: String,
    onOpenEditor: () -> Unit,
    onReviewDiff: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val totalChanges = changes.stagedCount + changes.unstagedCount
    val shape = RoundedCornerShape(4.dp)

    Column(
        modifier = modifier
            .testTag(TAG_FILE_CHANGES_ROOT)
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .border(1.dp, DamHopperColors.Border, shape)
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Section Header
        Text(
            text = "FILE CHANGES ($totalChanges)",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        // Staged Files
        if (changes.stagedCount > 0) {
            Text("● Staged (${changes.stagedCount})", color = Color(0xFF3FB950), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            changes.stagedFiles.take(4).forEach { file ->
                FileChangeRow(file = file, isStaged = true)
            }
        }

        // Unstaged Files
        if (changes.unstagedCount > 0) {
            Text("○ Unstaged (${changes.unstagedCount})", color = Color(0xFFD29922), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            changes.unstagedFiles.take(4).forEach { file ->
                FileChangeRow(file = file, isStaged = false)
            }
        }

        // Action Buttons Row
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .testTag(TAG_OPEN_EDITOR_BUTTON)
                    .weight(1f)
                    .sizeIn(minHeight = 48.dp)
                    .clip(shape)
                    .background(DamHopperColors.PrimaryVariant)
                    .clickable(role = Role.Button, onClick = onOpenEditor)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Open Editor ↗", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
            Box(
                modifier = Modifier
                    .testTag(TAG_REVIEW_DIFF_BUTTON)
                    .weight(1f)
                    .sizeIn(minHeight = 48.dp)
                    .clip(shape)
                    .background(DamHopperColors.SurfaceVariant)
                    .border(1.dp, DamHopperColors.Border, shape)
                    .clickable(role = Role.Button, onClick = onReviewDiff)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Review Diff ⎇", color = DamHopperColors.TextPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun FileChangeRow(file: String, isStaged: Boolean, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = if (isStaged) "+ M" else "• M",
            color = if (isStaged) Color(0xFF3FB950) else Color(0xFFD29922),
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = file,
            color = DamHopperColors.TextPrimary,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkspaceFileTreeSidebar.kt` (NEW)
**Target Line Count**: ~170 lines (< 200 lines)

```kotlin
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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.ui.flow.FileTreeNodeUiState
import dev.damhopper.nativeapp.ui.flow.GitFileStatusKind
import dev.damhopper.nativeapp.ui.flow.WorkspaceFileTreeUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_FILE_TREE_SIDEBAR_ROOT: String = "agent-hub-file-tree-sidebar"
const val TAG_FILE_TREE_CLOSE: String = "agent-hub-file-tree:close-button"
const val TAG_FILE_TREE_NODE_PREFIX: String = "agent-hub-file-tree-node:"

@Composable
fun WorkspaceFileTreeSidebar(
    treeState: WorkspaceFileTreeUiState?,
    onToggleFolder: (String) -> Unit,
    onOpenFile: (target: ProjectTargetRef, path: String) -> Unit,
    onOpenChangesReview: (String) -> Unit,
    onCloseSidebar: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_FILE_TREE_SIDEBAR_ROOT)
            .fillMaxHeight()
            .background(DamHopperColors.Surface)
            .border(width = 1.dp, color = DamHopperColors.Border)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Sidebar Titlebar
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("📁", fontSize = 14.sp)
            Spacer(Modifier.width(6.dp))
            Text(
                text = treeState?.projectName ?: "No Project Selected",
                color = DamHopperColors.TextPrimary,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            treeState?.branchName?.let { branch ->
                Text("⎇ $branch", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
            }
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .testTag(TAG_FILE_TREE_CLOSE)
                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                    .clickable(role = Role.Button, onClick = onCloseSidebar)
                    .semantics { contentDescription = "Close file tree sidebar" },
                contentAlignment = Alignment.Center,
            ) {
                Text("✕", color = DamHopperColors.TextSecondary, fontSize = 14.sp)
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

        // 3. Tree Content
        if (treeState == null || treeState.rootNodes.isEmpty()) {
            Box(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (treeState?.isLoading == true) "Loading files..." else "Select a project to explore files",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 12.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(treeState.rootNodes, key = { it.path }) { node ->
                    FileTreeNodeItem(
                        node = node,
                        depth = 0,
                        onToggleFolder = onToggleFolder,
                        onOpenFile = { onOpenFile(treeState.targetRef, node.path) },
                    )
                }
            }
        }

        // 4. File Changes Section
        if (treeState != null) {
            WorkspaceFileChangesSection(
                changes = treeState.fileChanges,
                projectName = treeState.projectName,
                onOpenEditor = {
                    treeState.selectedFilePath?.let { onOpenFile(treeState.targetRef, it) }
                        ?: onOpenFile(treeState.targetRef, "")
                },
                onReviewDiff = { onOpenChangesReview(treeState.projectName) },
            )
        }
    }
}

@Composable
private fun FileTreeNodeItem(
    node: FileTreeNodeUiState,
    depth: Int,
    onToggleFolder: (String) -> Unit,
    onOpenFile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .testTag(TAG_FILE_TREE_NODE_PREFIX + node.path)
                .fillMaxWidth()
                .sizeIn(minHeight = 36.dp)
                .clickable(role = Role.Button) {
                    if (node.isDirectory) onToggleFolder(node.path) else onOpenFile()
                }
                .padding(start = (depth * 14).dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (node.isDirectory) {
                Text(if (node.isExpanded) "▾ 📁" else "▸ 📁", fontSize = 12.sp)
            } else {
                Text("📄", fontSize = 12.sp)
            }
            Text(
                text = node.name,
                color = DamHopperColors.TextPrimary,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            node.gitStatus?.let { status ->
                val (badge, color) = when (status) {
                    GitFileStatusKind.MODIFIED -> "M" to Color(0xFF3FB950)
                    GitFileStatusKind.UNTRACKED -> "U" to Color(0xFFD29922)
                    GitFileStatusKind.ADDED -> "A" to Color(0xFF58A6FF)
                    GitFileStatusKind.DELETED -> "D" to Color(0xFFF85149)
                }
                Text("[$badge]", color = color, fontSize = 10.sp, fontWeight = FontWeight.Bold)
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
```

---

## Verification Commands
```bash
cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:compileKotlinJvm"
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "implement-workspace-file-changes-section",
    "title": "Implement WorkspaceFileChangesSection with staged/unstaged groups and editor CTAs",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkspaceFileChangesSection.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Enforce >=48x48dp touch targets on Open Editor and Review Diff buttons.",
      "Support truncated lists (up to 4 items) for staged and unstaged items."
    ],
    "acceptance": [
      "WorkspaceFileChangesSection renders staged and unstaged change rows.",
      "Clicking Open Editor and Review Diff triggers corresponding callbacks."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "implement-workspace-file-tree-sidebar",
    "title": "Implement WorkspaceFileTreeSidebar with tree node hierarchy and close trigger",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks",
      "implement-workspace-file-changes-section"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkspaceFileTreeSidebar.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Close button must provide >=48x48dp touch target.",
      "Recursive file node rendering must indent based on tree depth."
    ],
    "acceptance": [
      "WorkspaceFileTreeSidebar renders titlebar, expand/collapse file nodes, and embedded file changes.",
      "Clicking a file node dispatches onOpenFile callback with targetRef and path."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-workspace-file-changes-section --> Implement WorkspaceFileChangesSection with staged/unstaged groups and editor CTAs
- [ ] <!-- evcrate-task:implement-workspace-file-tree-sidebar --> Implement WorkspaceFileTreeSidebar with tree node hierarchy and close trigger
