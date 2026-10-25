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
