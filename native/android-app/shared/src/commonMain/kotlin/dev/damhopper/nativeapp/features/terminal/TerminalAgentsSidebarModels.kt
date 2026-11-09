package dev.damhopper.nativeapp.features.terminal

enum class TerminalAgentsSidebarMode {
    PINNED,
    SHEET,
}

data class TerminalAgentsSidebarUiState(
    val projection: TerminalAgentsProjection,
    val selection: TerminalAgentsFilterSelection,
    val loading: Boolean,
    val notice: String?,
    val active: TerminalAgentsInstanceKey?,
    val activationPending: Boolean,
)

data class TerminalAgentsSidebarCallbacks(
    val onGroupClick: (TerminalAgentsGroupKey) -> Unit,
    val onFilterChange: (TerminalAgentsFilterSelection) -> Unit,
    val onRefresh: () -> Unit,
    val onOpenSettings: () -> Unit,
    val onDismiss: () -> Unit,
    val onPopupVisibilityChanged: (Boolean) -> Unit,
)

enum class AgentHubNavigatorMode {
    RAIL,
    MODAL;

    fun toSidebarMode(): TerminalAgentsSidebarMode = when (this) {
        RAIL -> TerminalAgentsSidebarMode.PINNED
        MODAL -> TerminalAgentsSidebarMode.SHEET
    }
}

/**
 * Controlled presentation state of a single project/worktree row in the Agent Hub navigator.
 * Composed from observed session groups and explicit zero-session open targets.
 */
data class AgentHubProjectRowState(
    val target: dev.damhopper.nativeapp.core.model.ProjectTargetRef,
    val projectLabel: String,
    val profileLabel: String,
    val worktreeLabel: String? = null,
    val sessionCount: Int = 0,
    val agentCount: Int = 0,
    val isSelected: Boolean = false,
    val isPinned: Boolean = false,
    val isAvailable: Boolean = true,
    val isUnsupported: Boolean = false,
    val canDismiss: Boolean = false,
    val statusLabel: String? = null,
    val agentGroups: List<TerminalAgentsGroup> = emptyList(),
    val owner: dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner? = null,
)

/**
 * Controlled UI state for AgentHubNavigator.
 */
data class AgentHubNavigatorUiState(
    val projects: List<AgentHubProjectRowState> = emptyList(),
    val selectedTarget: dev.damhopper.nativeapp.core.model.ProjectTargetRef? = null,
    val agentsUiState: TerminalAgentsSidebarUiState,
    val showProfileBadges: Boolean = false,
    val notice: String? = null,
    val loading: Boolean = false,
)

/**
 * Controlled callbacks from AgentHubNavigator.
 * Every action carries an exact owner-qualified target; Settings triggers target B.
 */
data class AgentHubNavigatorCallbacks(
    val onSelectProject: (dev.damhopper.nativeapp.core.model.ProjectTargetRef) -> Unit,
    val onCreateSession: (dev.damhopper.nativeapp.core.model.ProjectTargetRef) -> Unit,
    val onDismissProject: (dev.damhopper.nativeapp.core.model.ProjectTargetRef) -> Unit,
    val onSelectOwner: ((dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner) -> Unit)? = null,
    val onCreateSessionForOwner: ((dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner) -> Unit)? = null,
    val onDismissOwner: ((dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner) -> Unit)? = null,
    val onOpenProjectPicker: () -> Unit,
    val onAgentGroupClick: (TerminalAgentsGroupKey) -> Unit,
    val onFilterChange: (TerminalAgentsFilterSelection) -> Unit,
    val onRefresh: () -> Unit,
    val onOpenSettings: () -> Unit,
    val onDismissNavigator: () -> Unit,
    val onPopupVisibilityChanged: (Boolean) -> Unit = {},
) {
    fun toSidebarCallbacks(): TerminalAgentsSidebarCallbacks = TerminalAgentsSidebarCallbacks(
        onGroupClick = onAgentGroupClick,
        onFilterChange = onFilterChange,
        onRefresh = onRefresh,
        onOpenSettings = onOpenSettings,
        onDismiss = onDismissNavigator,
        onPopupVisibilityChanged = onPopupVisibilityChanged,
    )
}
