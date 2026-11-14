# Phase 06 — Responsive Container & Drawers

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 2.0h
- **Owner**: UI Screens (`:shared`)
- **Dependencies**: Phase 02, Phase 03, Phase 04, Phase 05
  - `implement-agent-hub-header`
  - `implement-agent-hub-agents-sidebar`
  - `implement-project-list-center-stage`
  - `implement-workspace-file-tree-sidebar`

---

## Context & Objectives
Implement the top-level container composable `AgentHubLandingScreen` and its responsive drawer overlays.
Requirements:
1. Viewport measurement using `BoxWithConstraints`:
   - **Compact Phone (<600dp)**: Single active Center Stage with modal Left Drawer (Agents) and modal Right Drawer/Sheet (File Tree & Changes).
   - **Foldable / Landscape (600–839dp)**: Pinned left rail (240–280dp) + flex-1 center project stage.
   - **Expanded Tablet (>=840dp)**: Full 3-column layout (Left Agents 240dp | Center Stage flex 1 | Right File Tree 280–320dp).
2. Drawer presentation:
   - Scrim handling (`Color.Black.copy(alpha = 0.5f)`).
   - Dismiss on scrim click or system Back navigation.
3. Strict modularization (<200 lines per file):
   - `AgentHubDrawers.kt`: Modal Left Drawer and Modal Right Drawer composables.
   - `AgentHubLandingScreen.kt`: Viewport breakpoint dispatch, pinned columns layout, and header hosting.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/AgentHubDrawers.kt` (NEW)
**Target Line Count**: ~130 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

const val TAG_MODAL_AGENTS_DRAWER: String = "agent-hub-landing:modal-agents-drawer"
const val TAG_MODAL_FILES_DRAWER: String = "agent-hub-landing:modal-files-drawer"

@Composable
fun ModalAgentsDrawer(
    isOpen: Boolean,
    onDismiss: () -> Unit,
    drawerWidth: Dp = 300.dp,
    content: @Composable () -> Unit,
) {
    if (isOpen) {
        Box(
            modifier = Modifier
                .testTag(TAG_MODAL_AGENTS_DRAWER)
                .fillMaxSize(),
        ) {
            // Dark scrim overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismiss,
                    ),
            )
            // Slide-in drawer from left
            AnimatedVisibility(
                visible = isOpen,
                enter = slideInHorizontally(initialOffsetX = { -it }) + fadeIn(),
                exit = slideOutHorizontally(targetOffsetX = { -it }) + fadeOut(),
                modifier = Modifier.align(Alignment.CenterStart),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(drawerWidth),
                ) {
                    content()
                }
            }
        }
    }
}

@Composable
fun ModalFilesDrawer(
    isOpen: Boolean,
    onDismiss: () -> Unit,
    drawerWidth: Dp = 320.dp,
    content: @Composable () -> Unit,
) {
    if (isOpen) {
        Box(
            modifier = Modifier
                .testTag(TAG_MODAL_FILES_DRAWER)
                .fillMaxSize(),
        ) {
            // Dark scrim overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismiss,
                    ),
            )
            // Slide-in drawer from right
            AnimatedVisibility(
                visible = isOpen,
                enter = slideInHorizontally(initialOffsetX = { it }) + fadeIn(),
                exit = slideOutHorizontally(targetOffsetX = { it }) + fadeOut(),
                modifier = Modifier.align(Alignment.CenterEnd),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(drawerWidth),
                ) {
                    content()
                }
            }
        }
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/AgentHubLandingScreen.kt` (NEW)
**Target Line Count**: ~180 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.components.AgentHubAgentsSidebar
import dev.damhopper.nativeapp.ui.components.AgentHubLandingHeader
import dev.damhopper.nativeapp.ui.components.ProjectListCenterStage
import dev.damhopper.nativeapp.ui.components.WorkspaceFileTreeSidebar
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_LANDING_SCREEN_ROOT: String = "agent-hub-landing-screen"

@Composable
fun AgentHubLandingScreen(
    state: AgentHubLandingUiState,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier = modifier
            .testTag(TAG_LANDING_SCREEN_ROOT)
            .fillMaxSize()
            .background(DamHopperColors.Background),
    ) {
        val isCompact = maxWidth < 600.dp
        val isFoldable = maxWidth in 600.dp..839.dp
        val isExpanded = maxWidth >= 840.dp

        Column(modifier = Modifier.fillMaxSize()) {
            // 1. Top Chrome Header
            AgentHubLandingHeader(
                state = state,
                callbacks = callbacks,
                isCompact = isCompact,
            )

            // 2. Main 3-Zone Stage Container
            Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                // Column 1: Left Agents Rail (Pinned on >= 600dp)
                if (!isCompact) {
                    val railWidth = if (isExpanded) 240.dp else 260.dp
                    Box(modifier = Modifier.width(railWidth)) {
                        AgentHubAgentsSidebar(
                            roster = state.agentRoster,
                            onFilterChange = callbacks::onAgentFilterChange,
                            onJumpToTerminal = callbacks::onJumpToAgentTerminal,
                            onRefreshAgents = callbacks::onRefreshAgents,
                            onOpenAgentSettings = callbacks::onOpenAgentSettings,
                        )
                    }
                }

                // Column 2: Center Projects Stage (Always visible)
                Box(modifier = Modifier.weight(1f)) {
                    ProjectListCenterStage(
                        uiState = state.projectList,
                        onSearchChange = callbacks::onSearchQueryChange,
                        onOpenProjectPicker = callbacks::onOpenProjectPicker,
                        onSelectProjectForTree = callbacks::onSelectProjectForTree,
                        onLaunchTerminal = callbacks::onLaunchTerminalInProject,
                        onOpenGit = callbacks::onOpenGitForProject,
                        onDismissZeroSession = callbacks::onDismissZeroSessionProject,
                    )
                }

                // Column 3: Right File Tree Sidebar (Pinned on >= 840dp when enabled)
                if (isExpanded && state.isRightFileTreePinned) {
                    Box(modifier = Modifier.width(300.dp)) {
                        WorkspaceFileTreeSidebar(
                            treeState = state.workspaceFileTree,
                            onToggleFolder = callbacks::onToggleFolder,
                            onOpenFile = callbacks::onOpenFileInEditor,
                            onOpenChangesReview = callbacks::onOpenChangesReview,
                            onCloseSidebar = callbacks::onCloseFilesSidebar,
                        )
                    }
                }
            }
        }

        // Modal Left Drawer for Compact Phone screens (< 600dp)
        if (isCompact) {
            ModalAgentsDrawer(
                isOpen = state.isAgentsDrawerOpen,
                onDismiss = callbacks::onToggleAgentsSidebar,
            ) {
                AgentHubAgentsSidebar(
                    roster = state.agentRoster,
                    onFilterChange = callbacks::onAgentFilterChange,
                    onJumpToTerminal = { termId, inc ->
                        callbacks.onJumpToAgentTerminal(termId, inc)
                        callbacks.onToggleAgentsSidebar()
                    },
                    onRefreshAgents = callbacks::onRefreshAgents,
                    onOpenAgentSettings = callbacks::onOpenAgentSettings,
                )
            }

            ModalFilesDrawer(
                isOpen = state.isFilesDrawerOpen,
                onDismiss = callbacks::onToggleFilesSidebar,
            ) {
                WorkspaceFileTreeSidebar(
                    treeState = state.workspaceFileTree,
                    onToggleFolder = callbacks::onToggleFolder,
                    onOpenFile = { target, path ->
                        callbacks.onOpenFileInEditor(target, path)
                        callbacks.onToggleFilesSidebar()
                    },
                    onOpenChangesReview = { proj ->
                        callbacks.onOpenChangesReview(proj)
                        callbacks.onToggleFilesSidebar()
                    },
                    onCloseSidebar = callbacks::onToggleFilesSidebar,
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
    "id": "implement-agent-hub-drawers",
    "title": "Implement ModalAgentsDrawer and ModalFilesDrawer with animated transitions and scrim",
    "blocked_by": [
      "define-agent-hub-state-models",
      "define-agent-hub-callbacks"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/AgentHubDrawers.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Animate sliding transitions horizontally with 50% opacity scrim.",
      "Dismiss drawer when scrim is tapped."
    ],
    "acceptance": [
      "ModalAgentsDrawer slides from left; ModalFilesDrawer slides from right.",
      "Scrim click triggers onDismiss callback."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "implement-agent-hub-landing-screen",
    "title": "Implement AgentHubLandingScreen responsive container with BoxWithConstraints",
    "blocked_by": [
      "implement-agent-hub-header",
      "implement-agent-hub-agents-sidebar",
      "implement-project-list-center-stage",
      "implement-workspace-file-tree-sidebar",
      "implement-agent-hub-drawers"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/AgentHubLandingScreen.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Handle <600dp, 600-839dp, and >=840dp responsive modes cleanly.",
      "Maintain fixed top chrome height and prevent layout thrashing."
    ],
    "acceptance": [
      "AgentHubLandingScreen hosts header and switches between 1-column with drawers, 2-column hybrid, and 3-column bento layout.",
      "All callbacks wire cleanly to child components."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-agent-hub-drawers --> Implement ModalAgentsDrawer and ModalFilesDrawer with animated transitions and scrim
- [ ] <!-- evcrate-task:implement-agent-hub-landing-screen --> Implement AgentHubLandingScreen responsive container with BoxWithConstraints
