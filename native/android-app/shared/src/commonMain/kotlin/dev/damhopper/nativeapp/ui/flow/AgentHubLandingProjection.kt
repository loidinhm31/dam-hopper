package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRow
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsState
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot
import dev.damhopper.nativeapp.features.workspace.ProjectSummary
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState

/**
 * Pure projection functions transforming domain and workspace state into [AgentHubLandingUiState].
 */
object AgentHubLandingProjection {

    fun project(
        currentProfile: ServerProfile?,
        hubSnapshot: AgentHubSnapshot,
        agentsState: TerminalAgentsState?,
        activeWorkspaceState: ProjectWorkspaceState?,
        serverProjects: List<ProjectSummary> = emptyList(),
        fileNodes: List<FileTreeNodeUiState> = emptyList(),
        fileChanges: FileChangeSummaryUiState = FileChangeSummaryUiState(),
        isLoadingFiles: Boolean = false,
        searchQuery: String = "",
        selectedTarget: ProjectTargetRef? = null,
        isAgentsDrawerOpen: Boolean = false,
        isFilesDrawerOpen: Boolean = false,
        isRightFileTreePinned: Boolean = true,
    ): AgentHubLandingUiState {
        val projection = agentsState?.projection
        val counts = projection?.counts

        val urgency = UrgencyCountersUiState(
            attentionCount = counts?.byStatus?.get(TerminalAgentsStatus.NEEDS_ATTENTION) ?: 0,
            workingCount = counts?.byStatus?.get(TerminalAgentsStatus.WORKING) ?: 0,
            idleCount = counts?.byStatus?.get(TerminalAgentsStatus.IDLE) ?: 0,
        )

        val activeFilter = agentsState?.filter ?: TerminalAgentsFilterSelection.All
        val allRows = projection?.rows.orEmpty()
        val filteredRows = when (activeFilter) {
            is TerminalAgentsFilterSelection.All -> allRows
            is TerminalAgentsFilterSelection.Selected -> allRows.filter { activeFilter.statuses.contains(it.presentation.status) }
        }

        val agentItems = filteredRows.map { row: TerminalAgentsRow ->
            val inst = row.target.instance
            AgentGroupItemUiState(
                key = "${inst.profileId}:${inst.terminalId}:${inst.incarnation}",
                agentName = row.agentKind.name,
                projectName = row.projectLabel,
                sessionDisplayId = "#${inst.terminalId.takeLast(4)}",
                status = when (row.presentation.status) {
                    TerminalAgentsStatus.NEEDS_ATTENTION -> AgentStatusKind.ATTENTION
                    TerminalAgentsStatus.WORKING -> AgentStatusKind.WORKING
                    else -> AgentStatusKind.IDLE
                },
                statusLabel = row.presentation.status.name.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() },
                lastEventSummary = row.presentation.coverageHint.orEmpty(),
                targetTerminalId = inst.terminalId,
                incarnationExact = inst.incarnation,
                target = row.target,
            )
        }

        val agentRoster = AgentRosterUiState(
            totalEligible = counts?.all ?: 0,
            activeFilter = activeFilter,
            agents = agentItems,
            isLoading = agentsState?.loading ?: false,
        )

        val effectiveSelected = selectedTarget ?: serverProjects.firstOrNull()?.let {
            ProjectTargetRef(profileId = currentProfile?.id, project = it.name)
        } ?: activeWorkspaceState?.target ?: hubSnapshot.selectedProjectTarget
        val projectMap = LinkedHashMap<String, ProjectCardUiState>()

        serverProjects.forEach { summary ->
            val target = ProjectTargetRef(profileId = currentProfile?.id, project = summary.name)
            val activeTerms = hubSnapshot.terminalRows.count { it.projectTarget?.project == summary.name }
            val runningInProj = allRows.filter { it.projectLabel == summary.name }.map { it.agentKind.name }.distinct()
            val attnInProj = allRows.firstOrNull { it.projectLabel == summary.name && it.presentation.status == TerminalAgentsStatus.NEEDS_ATTENTION }
            projectMap[target.key] = ProjectCardUiState(
                id = target.key,
                target = target,
                name = summary.name,
                profileTag = currentProfile?.name ?: "local-dev",
                path = summary.path,
                activeTerminalCount = activeTerms,
                runningAgents = runningInProj,
                attentionMessage = attnInProj?.presentation?.status?.name,
                isZeroSessionTarget = activeTerms == 0,
                isSelectedForTree = target.key == effectiveSelected?.key,
            )
        }

        hubSnapshot.terminalRows.forEach { row ->
            val target = row.projectTarget ?: ProjectTargetRef(profileId = currentProfile?.id, project = "workspace")
            if (!projectMap.containsKey(target.key)) {
                val existing = projectMap[target.key]
                val runningInProj = allRows.filter { it.projectLabel == target.project }.map { it.agentKind.name }.distinct()
                projectMap[target.key] = ProjectCardUiState(
                    id = target.key,
                    target = target,
                    name = target.project,
                    profileTag = currentProfile?.name ?: "local-dev",
                    path = target.worktreePath.orEmpty(),
                    activeTerminalCount = (existing?.activeTerminalCount ?: 0) + 1,
                    runningAgents = runningInProj,
                    isZeroSessionTarget = false,
                    isSelectedForTree = target.key == effectiveSelected?.key,
                )
            }
        }

        hubSnapshot.zeroSessionOpenTargets.forEach { target ->
            if (!projectMap.containsKey(target.key)) {
                projectMap[target.key] = ProjectCardUiState(
                    id = target.key,
                    target = target,
                    name = target.project,
                    profileTag = currentProfile?.name ?: "local-dev",
                    path = target.worktreePath.orEmpty(),
                    activeTerminalCount = 0,
                    isZeroSessionTarget = true,
                    isDismissible = true,
                    isSelectedForTree = target.key == effectiveSelected?.key,
                )
            }
        }

        val projectList = ProjectListCenterStageUiState(
            searchQuery = searchQuery,
            projects = projectMap.values.toList(),
            selectedTarget = effectiveSelected,
            isLoading = !hubSnapshot.isInventoryLoaded && serverProjects.isEmpty(),
            errorMessage = hubSnapshot.unsupportedNotice,
        )

        val workspaceFileTree = if (effectiveSelected != null) {
            WorkspaceFileTreeUiState(
                projectName = effectiveSelected.project,
                branchName = effectiveSelected.worktreePath ?: "main",
                targetRef = effectiveSelected,
                rootNodes = fileNodes,
                fileChanges = fileChanges,
                selectedFilePath = null,
                isLoading = isLoadingFiles,
            )
        } else null

        return AgentHubLandingUiState(
            profileName = currentProfile?.name ?: "Server",
            serverUrl = currentProfile?.baseUrl,
            isOnline = hubSnapshot.isConnected,
            isInventoryLoaded = hubSnapshot.isInventoryLoaded,
            urgencyCounters = urgency,
            agentRoster = agentRoster,
            projectList = projectList,
            workspaceFileTree = workspaceFileTree,
            isAgentsDrawerOpen = isAgentsDrawerOpen,
            isFilesDrawerOpen = isFilesDrawerOpen,
            isRightFileTreePinned = isRightFileTreePinned,
        )
    }
}
