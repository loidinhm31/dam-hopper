package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection

/**
 * Event dispatch contract for the Agent Hub Landing Screen.
 */
interface AgentHubLandingCallbacks {
    // Header & Navigation
    fun onToggleAgentsSidebar()
    fun onToggleFilesSidebar()
    fun onTogglePinFileTree()
    fun onOpenNotifications()
    fun onOpenSettings()
    fun onSwitchProfile()

    // Agents
    fun onAgentFilterChange(filter: TerminalAgentsFilterSelection)
    fun onJumpToAgentTerminal(agent: AgentGroupItemUiState)
    fun onRefreshAgents()
    fun onOpenAgentSettings()

    // Projects
    fun onSearchQueryChange(query: String)
    fun onOpenProjectPicker()
    fun onSelectProjectForTree(target: ProjectTargetRef)
    fun onLaunchTerminalInProject(target: ProjectTargetRef)
    fun onOpenGitForProject(target: ProjectTargetRef)
    fun onDismissZeroSessionProject(target: ProjectTargetRef)

    // Workspace Capability Fallbacks (Projectless)
    fun onOpenWorkspaceFiles()
    fun onOpenWorkspaceEditor()

    // Workspace File Tree & Editor
    fun onToggleFolder(path: String)
    fun onOpenFileInEditor(target: ProjectTargetRef?, path: String)
    fun onOpenChangesReview(target: ProjectTargetRef)
    fun onCloseFilesSidebar()
}

/**
 * No-op implementation for Compose previews and safe defaults.
 */
object EmptyAgentHubLandingCallbacks : AgentHubLandingCallbacks {
    override fun onToggleAgentsSidebar() {}
    override fun onToggleFilesSidebar() {}
    override fun onTogglePinFileTree() {}
    override fun onOpenNotifications() {}
    override fun onOpenSettings() {}
    override fun onSwitchProfile() {}
    override fun onAgentFilterChange(filter: TerminalAgentsFilterSelection) {}
    override fun onJumpToAgentTerminal(agent: AgentGroupItemUiState) {}
    override fun onRefreshAgents() {}
    override fun onOpenAgentSettings() {}
    override fun onSearchQueryChange(query: String) {}
    override fun onOpenProjectPicker() {}
    override fun onSelectProjectForTree(target: ProjectTargetRef) {}
    override fun onLaunchTerminalInProject(target: ProjectTargetRef) {}
    override fun onOpenGitForProject(target: ProjectTargetRef) {}
    override fun onDismissZeroSessionProject(target: ProjectTargetRef) {}
    override fun onOpenWorkspaceFiles() {}
    override fun onOpenWorkspaceEditor() {}
    override fun onToggleFolder(path: String) {}
    override fun onOpenFileInEditor(target: ProjectTargetRef?, path: String) {}
    override fun onOpenChangesReview(target: ProjectTargetRef) {}
    override fun onCloseFilesSidebar() {}
}
