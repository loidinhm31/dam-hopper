# Phase 04 — Center Stage & Project Cards

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 2.0h
- **Owner**: UI Components (`:shared`)
- **Dependencies**: Phase 01 (`define-agent-hub-state-models`, `define-agent-hub-callbacks`)

---

## Context & Objectives
Implement the Center Stage displaying configured projects, live terminal counts, zero-session open targets, and direct action triggers.
Requirements:
1. Search & Action Bar:
   - Search input field (`46dp` height) with magnifying glass and debounced filter (`callbacks.onSearchQueryChange`).
   - Primary `[+ Open Project ▾]` button (`#1F6FEB` background, `>=48x48dp` touch target) opening project inventory picker.
2. Section header: `"CONFIGURED & ACTIVE PROJECTS (N)"`.
3. Three project card variants:
   - **Active Selected Card**: Highlighting border (`1.5dp` solid `#58A6FF`), `● SELECTED` status chip, worktree branch/hash, active terminal session count, running agents summary, and quick action bar (`[📁 Files (Right➔)]`, `[>_ Term]`, `[⎇ Git]`).
   - **Attention Required Card**: Warning border (`1.2dp` solid `#D29922`), prominent `! Codex: Approval Req` banner, and direct jump CTA.
   - **Zero-Session Open Target Card**: Dashed border, `○ 0 active sessions` subtitle, quick action `[📁 Browse Files]` + `[+ Launch Term]`, and sibling `[✕]` dismiss button with `>=8dp` safety margin and `>=48x48dp` touch target.

Modularized into two files under 200 lines:
- `ProjectCardItem.kt`: Individual project card variants and action buttons.
- `ProjectListCenterStage.kt`: Search bar, `+ Open Project` trigger, section header, and LazyColumn inventory.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/ProjectCardItem.kt` (NEW)
**Target Line Count**: ~180 lines (< 200 lines)

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.ProjectCardUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_PROJECT_CARD_PREFIX: String = "agent-hub-project-card:"
const val TAG_ACTION_FILES_PREFIX: String = "agent-hub-project:action-files:"
const val TAG_ACTION_TERM_PREFIX: String = "agent-hub-project:action-term:"
const val TAG_ACTION_GIT_PREFIX: String = "agent-hub-project:action-git:"
const val TAG_ACTION_DISMISS_PREFIX: String = "agent-hub-project:action-dismiss:"

@Composable
fun ProjectCardItem(
    project: ProjectCardUiState,
    onSelectForTree: (String) -> Unit,
    onLaunchTerminal: (String) -> Unit,
    onOpenGit: (String) -> Unit,
    onDismissZeroSession: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isSelected = project.isSelectedForTree
    val hasAttention = project.attentionMessage != null
    val borderColor = when {
        isSelected -> DamHopperColors.Primary
        hasAttention -> Color(0xFFD29922)
        else -> DamHopperColors.Border
    }
    val shape = RoundedCornerShape(8.dp)

    Column(
        modifier = modifier
            .testTag(TAG_PROJECT_CARD_PREFIX + project.name)
            .fillMaxWidth()
            .clip(shape)
            .background(DamHopperColors.Surface)
            .border(if (isSelected) 1.5.dp else 1.dp, borderColor, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Row 1: Project Name + Profile Tag + Selection Chip / Dismiss [X]
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = project.name,
                color = DamHopperColors.TextPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            ) {
                Text(project.profileTag, color = DamHopperColors.TextSecondary, fontSize = 10.sp)
            }
            Spacer(Modifier.weight(1f))
            if (isSelected) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text("● ACTIVE TREE", color = DamHopperColors.Primary, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            } else if (project.isZeroSessionTarget && project.isDismissible) {
                // Sibling >=48x48dp touch target with >=8dp safety margin
                Box(
                    modifier = Modifier
                        .testTag(TAG_ACTION_DISMISS_PREFIX + project.name)
                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        .clickable(role = Role.Button) { onDismissZeroSession(project.name) }
                        .semantics { contentDescription = "Dismiss zero-session project ${project.name}" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✕", color = DamHopperColors.TextSecondary, fontSize = 14.sp)
                }
            }
        }

        // Row 2: Worktree branch & commit hash or 0-session label
        if (project.isZeroSessionTarget) {
            Text("○ 0 active sessions · registered workspace target", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                project.worktreeBranch?.let {
                    Text("⎇ wt: $it", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
                }
                project.commitHash?.let {
                    Text("#$it", color = DamHopperColors.TextSecondary, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
                Text(">_ ${project.activeTerminalCount} Term", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
            }
        }

        // Row 3: Attention message (if present)
        project.attentionMessage?.let {
            Text("! $it", color = Color(0xFFD29922), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }

        // Row 4: Quick Action Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProjectActionButton(
                label = "📁 Files",
                testTag = TAG_ACTION_FILES_PREFIX + project.name,
                onClick = { onSelectForTree(project.name) },
                modifier = Modifier.weight(1f),
            )
            ProjectActionButton(
                label = if (project.isZeroSessionTarget) "+ Launch Term" else ">_ Term (${project.activeTerminalCount})",
                testTag = TAG_ACTION_TERM_PREFIX + project.name,
                onClick = { onLaunchTerminal(project.name) },
                modifier = Modifier.weight(1f),
            )
            if (!project.isZeroSessionTarget) {
                ProjectActionButton(
                    label = "⎇ Git",
                    testTag = TAG_ACTION_GIT_PREFIX + project.name,
                    onClick = { onOpenGit(project.name) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun ProjectActionButton(
    label: String,
    testTag: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(4.dp)
    Box(
        modifier = modifier
            .testTag(testTag)
            .sizeIn(minHeight = 48.dp)
            .clip(shape)
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, DamHopperColors.Border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = DamHopperColors.TextPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/ProjectListCenterStage.kt` (NEW)
**Target Line Count**: ~160 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.ProjectListCenterStageUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_CENTER_STAGE_ROOT: String = "agent-hub-center-stage"
const val TAG_SEARCH_INPUT: String = "agent-hub-projects:search-input"
const val TAG_OPEN_PROJECT_BUTTON: String = "agent-hub-projects:open-project-button"

@Composable
fun ProjectListCenterStage(
    uiState: ProjectListCenterStageUiState,
    onSearchChange: (String) -> Unit,
    onOpenProjectPicker: () -> Unit,
    onSelectProjectForTree: (String) -> Unit,
    onLaunchTerminal: (String) -> Unit,
    onOpenGit: (String) -> Unit,
    onDismissZeroSession: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .testTag(TAG_CENTER_STAGE_ROOT)
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 1. Search Bar & + Open Project Trigger
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Search Input Field
            Box(
                modifier = Modifier
                    .weight(1f)
                    .sizeIn(minHeight = 46.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.Surface)
                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (uiState.searchQuery.isEmpty()) {
                    Text("🔍 Filter projects...", color = DamHopperColors.TextSecondary, fontSize = 13.sp)
                }
                BasicTextField(
                    value = uiState.searchQuery,
                    onValueChange = onSearchChange,
                    textStyle = TextStyle(color = DamHopperColors.TextPrimary, fontSize = 13.sp),
                    cursorBrush = SolidColor(DamHopperColors.Primary),
                    modifier = Modifier.fillMaxWidth().testTag(TAG_SEARCH_INPUT),
                    singleLine = true,
                )
            }

            // + Open Project Button
            Box(
                modifier = Modifier
                    .testTag(TAG_OPEN_PROJECT_BUTTON)
                    .sizeIn(minWidth = 48.dp, minHeight = 46.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(DamHopperColors.PrimaryVariant)
                    .clickable(role = Role.Button, onClick = onOpenProjectPicker)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("+ Open Project ▾", color = DamHopperColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // 2. Section Header
        Text(
            text = "CONFIGURED & ACTIVE PROJECTS (${uiState.projects.size})",
            color = DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )

        // 3. Projects List
        if (uiState.projects.isEmpty()) {
            Box(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (uiState.isLoading) "Loading projects..." else "No matching projects found",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 13.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 16.dp),
            ) {
                items(uiState.projects, key = { it.id }) { project ->
                    ProjectCardItem(
                        project = project,
                        onSelectForTree = onSelectProjectForTree,
                        onLaunchTerminal = onLaunchTerminal,
                        onOpenGit = onOpenGit,
                        onDismissZeroSession = onDismissZeroSession,
                    )
                }
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
    "id": "implement-project-card-item",
    "title": "Implement ProjectCardItem with active, attention, and zero-session variants",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/ProjectCardItem.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Enforce >=48x48dp touch targets on all action buttons and dismiss icon.",
      "Preserve >=8dp safety margin between row click and dismiss button."
    ],
    "acceptance": [
      "ProjectCardItem renders active selected border, attention message, or zero-session badge.",
      "Dismiss button triggers onDismissZeroSession."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "implement-project-list-center-stage",
    "title": "Implement ProjectListCenterStage container with search bar and + Open Project button",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks",
      "implement-project-card-item"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/ProjectListCenterStage.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Debounce search input and handle empty/loading states gracefully."
    ],
    "acceptance": [
      "ProjectListCenterStage renders search input, Open Project trigger, and LazyColumn of ProjectCardItems.",
      "Typing in search updates search query callback."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-project-card-item --> Implement ProjectCardItem with active, attention, and zero-session variants
- [ ] <!-- evcrate-task:implement-project-list-center-stage --> Implement ProjectListCenterStage container with search bar and + Open Project button
