package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsTarget

/**
 * Authoritative UI state for the Agent Hub First Page / Landing Screen.
 */
data class AgentHubLandingUiState(
    val profileName: String = "Server",
    val serverUrl: String? = null,
    val isOnline: Boolean = true,
    val isDevMode: Boolean = false,
    val hasMfa: Boolean = false,
    val isInventoryLoaded: Boolean = false,
    val urgencyCounters: UrgencyCountersUiState = UrgencyCountersUiState(),
    val agentRoster: AgentRosterUiState = AgentRosterUiState(),
    val projectList: ProjectListCenterStageUiState = ProjectListCenterStageUiState(),
    val workspaceFileTree: WorkspaceFileTreeUiState? = null,
    val isAgentsDrawerOpen: Boolean = false,
    val isFilesDrawerOpen: Boolean = false,
    val isRightFileTreePinned: Boolean = true,
)

data class UrgencyCountersUiState(
    val attentionCount: Int = 0,
    val workingCount: Int = 0,
    val idleCount: Int = 0,
)

data class AgentRosterUiState(
    val totalEligible: Int = 0,
    val activeFilter: TerminalAgentsFilterSelection = TerminalAgentsFilterSelection.All,
    val agents: List<AgentGroupItemUiState> = emptyList(),
    val isLoading: Boolean = false,
)

data class AgentGroupItemUiState(
    val key: String,
    val agentName: String,
    val projectName: String,
    val sessionDisplayId: String,
    val status: AgentStatusKind = AgentStatusKind.IDLE,
    val statusLabel: String = "Idle",
    val elapsedDuration: String = "",
    val lastEventSummary: String = "",
    val targetTerminalId: String,
    val incarnationExact: ULong = 0u,
    val target: TerminalAgentsTarget? = null,
)

enum class AgentStatusKind {
    ATTENTION,
    WORKING,
    IDLE,
}

data class ProjectListCenterStageUiState(
    val searchQuery: String = "",
    val projects: List<ProjectCardUiState> = emptyList(),
    val selectedTarget: ProjectTargetRef? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

data class ProjectCardUiState(
    val id: String,
    val target: ProjectTargetRef,
    val name: String,
    val profileTag: String = "local-dev",
    val path: String = "",
    val worktreeBranch: String? = null,
    val commitHash: String? = null,
    val activeTerminalCount: Int = 0,
    val runningAgents: List<String> = emptyList(),
    val attentionMessage: String? = null,
    val isZeroSessionTarget: Boolean = false,
    val isDismissible: Boolean = false,
    val isSelectedForTree: Boolean = false,
)

data class WorkspaceFileTreeUiState(
    val projectName: String,
    val branchName: String = "main",
    val targetRef: ProjectTargetRef? = null,
    val rootNodes: List<FileTreeNodeUiState> = emptyList(),
    val fileChanges: FileChangeSummaryUiState = FileChangeSummaryUiState(),
    val selectedFilePath: String? = null,
    val isLoading: Boolean = false,
)

data class FileTreeNodeUiState(
    val path: String,
    val name: String,
    val isDirectory: Boolean,
    val isExpanded: Boolean = false,
    val gitStatus: GitFileStatusKind? = null,
    val children: List<FileTreeNodeUiState> = emptyList(),
)

enum class GitFileStatusKind {
    MODIFIED,
    UNTRACKED,
    ADDED,
    DELETED,
}

data class FileChangeSummaryUiState(
    val stagedCount: Int = 0,
    val unstagedCount: Int = 0,
    val stagedFiles: List<String> = emptyList(),
    val unstagedFiles: List<String> = emptyList(),
)
