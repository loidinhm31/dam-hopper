package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
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

const val TAG_LANDING_SCREEN: String = "agent-hub-landing-screen"

@Composable
fun AgentHubLandingScreen(
    state: AgentHubLandingUiState,
    callbacks: AgentHubLandingCallbacks,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier = modifier
            .testTag(TAG_LANDING_SCREEN)
            .fillMaxSize()
            .background(DamHopperColors.Background),
    ) {
        val screenWidth = maxWidth
        val isCompact = screenWidth < 600.dp
        val isExpanded = screenWidth >= 840.dp

        Column(modifier = Modifier.fillMaxSize()) {
            // 1. Pinned Top Chrome Header
            AgentHubLandingHeader(
                state = state,
                callbacks = callbacks,
                isCompact = isCompact,
            )

            // 2. Main 3-Zone Content Row
            Row(modifier = Modifier.fillMaxSize().weight(1f)) {
                // Left Column: Agents (pinned on >= 600dp)
                if (!isCompact) {
                    AgentHubAgentsSidebar(
                        roster = state.agentRoster,
                        callbacks = callbacks,
                        modifier = Modifier.width(240.dp),
                    )
                }

                // Center Column: Projects Stage (always visible, flex 1)
                ProjectListCenterStage(
                    state = state.projectList,
                    callbacks = callbacks,
                    modifier = Modifier.weight(1f),
                )

                // Right Column: File Tree (pinned on >= 840dp when pinned)
                if (isExpanded && state.isRightFileTreePinned) {
                    WorkspaceFileTreeSidebar(
                        state = state.workspaceFileTree,
                        callbacks = callbacks,
                        modifier = Modifier.width(280.dp),
                    )
                }
            }
        }

        // 3. Modal Overlays for Small/Medium Form Factors
        if (isCompact && state.isAgentsDrawerOpen) {
            ModalAgentsDrawer(
                isOpen = state.isAgentsDrawerOpen,
                onClose = callbacks::onToggleAgentsSidebar,
                drawerWidth = 280.dp.coerceAtMost(screenWidth - 32.dp),
            ) {
                AgentHubAgentsSidebar(
                    roster = state.agentRoster,
                    callbacks = callbacks,
                )
            }
        }

        if (state.isFilesDrawerOpen && (!isExpanded || !state.isRightFileTreePinned)) {
            ModalFilesDrawer(
                isOpen = state.isFilesDrawerOpen,
                onClose = callbacks::onCloseFilesSidebar,
                drawerWidth = 300.dp.coerceAtMost(screenWidth - 32.dp),
            ) {
                WorkspaceFileTreeSidebar(
                    state = state.workspaceFileTree,
                    callbacks = callbacks,
                )
            }
        }
    }
}
