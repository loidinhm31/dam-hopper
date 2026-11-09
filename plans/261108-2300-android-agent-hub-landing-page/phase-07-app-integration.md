# Phase 07 — Integration & Root Replacement

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 1.5h
- **Owner**: App Integration (`:shared`)
- **Dependencies**: Phase 06 (`implement-agent-hub-landing-screen`)

---

## Context & Objectives
Integrate `AgentHubLandingScreen` into `DamHopperMobileApp.kt`, completely replacing the legacy placeholder `AgentHubEmptyRoot` (lines 1118-1383).
To keep `DamHopperMobileApp.kt` maintainable and strictly under control:
1. Extract pure state mapping into `AgentHubLandingProjection.kt` (<200 lines).
   - Projects `AgentHubSnapshot`, `TerminalAgentsContext`, `ProfileData`, and active workspace into `AgentHubLandingUiState`.
   - Maps agent telemetry, urgency counts, and deduplicated project cards.
2. In `DamHopperMobileApp.kt`:
   - Replace lines 1118-1383 with `AgentHubLandingRoot` invoking `AgentHubLandingScreen`.
   - Wire `AgentHubLandingCallbacks` to existing navigation routes and `services.dispatchAction(...)`.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingProjection.kt` (NEW)
**Target Line Count**: ~150 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.settings.ProfileData
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsContext
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState

/**
 * Pure projection functions transforming domain and workspace state flows into [AgentHubLandingUiState].
 */
object AgentHubLandingProjection {

    fun project(
        currentProfile: ProfileData?,
        hubSnapshot: AgentHubSnapshot,
        agentsContext: TerminalAgentsContext?,
        activeWorkspaceState: ProjectWorkspaceState?,
        searchQuery: String,
        selectedProjectName: String?,
        isAgentsDrawerOpen: Boolean,
        isFilesDrawerOpen: Boolean,
        isRightFileTreePinned: Boolean,
    ): AgentHubLandingUiState {
        // 1. Project Urgency Counters & Agents Roster
        val projection = agentsContext?.service?.projection?.value
        val counts = projection?.counts
        val urgency = UrgencyCountersUiState(
            attentionCount = counts?.byStatus?.get(TerminalAgentsStatus.NEEDS_ATTENTION) ?: 0,
            workingCount = counts?.byStatus?.get(TerminalAgentsStatus.WORKING) ?: 0,
            idleCount = counts?.byStatus?.get(TerminalAgentsStatus.IDLE) ?: 0,
        )

        val agentItems = projection?.rows?.map { row ->
            AgentGroupItemUiState(
                key = "${row.target.instance.profileId}:${row.target.instance.terminalId}",
                agentName = row.agentKind.name,
                projectName = row.projectLabel,
                sessionDisplayId = "#${row.target.instance.terminalId.takeLast(4)}",
                status = when (row.presentation.status) {
                    TerminalAgentsStatus.NEEDS_ATTENTION -> AgentStatusKind.ATTENTION
                    TerminalAgentsStatus.WORKING -> AgentStatusKind.WORKING
                    else -> AgentStatusKind.IDLE
                },
                statusLabel = row.presentation.status.name.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() },
                lastEventSummary = row.presentation.coverageHint.orEmpty(),
                targetTerminalId = row.target.instance.terminalId,
                incarnationExact = row.target.instance.incarnation.toLong(),
            )
        }.orEmpty()

        // 2. Project Inventory & Project Cards
        val projectsMap = mutableMapOf<String, ProjectCardUiState>()

        // From active terminals in hub snapshot
        hubSnapshot.activeTerminals.forEach { term ->
            val pName = term.projectTarget?.project ?: "Workspace"
            val existing = projectsMap[pName]
            val count = (existing?.activeTerminalCount ?: 0) + 1
            val agentsList = if (term.agentSession != null) {
                (existing?.runningAgents.orEmpty() + term.agentSession.agentKind.name).distinct()
            } else {
                existing?.runningAgents.orEmpty()
            }
            val attentionMsg = if (term.hasPendingAttention || term.agentSession?.reason != null) {
                term.agentSession?.reason?.toString() ?: "Attention Required"
            } else existing?.attentionMessage

            projectsMap[pName] = ProjectCardUiState(
                id = pName,
                name = pName,
                profileTag = currentProfile?.name ?: "local-dev",
                path = term.projectTarget?.worktreePath ?: "",
                worktreeBranch = term.projectTarget?.worktreePath?.substringAfterLast('/'),
                activeTerminalCount = count,
                runningAgents = agentsList,
                attentionMessage = attentionMsg,
                isZeroSessionTarget = false,
                isDismissible = false,
                isSelectedForTree = (selectedProjectName ?: activeWorkspaceState?.target?.project) == pName,
            )
        }

        // From zero-session open targets
        hubSnapshot.zeroSessionOpenTargets.forEach { target ->
            if (!projectsMap.containsKey(target.project)) {
                projectsMap[target.project] = ProjectCardUiState(
                    id = target.project,
                    name = target.project,
                    profileTag = currentProfile?.name ?: "local-dev",
                    path = target.worktreePath ?: "",
                    worktreeBranch = target.worktreePath?.substringAfterLast('/'),
                    activeTerminalCount = 0,
                    isZeroSessionTarget = true,
                    isDismissible = true,
                    isSelectedForTree = (selectedProjectName ?: activeWorkspaceState?.target?.project) == target.project,
                )
            }
        }

        val filteredProjects = if (searchQuery.isBlank()) {
            projectsMap.values.toList()
        } else {
            projectsMap.values.filter { it.name.contains(searchQuery, ignoreCase = true) }
        }

        return AgentHubLandingUiState(
            profileName = currentProfile?.name ?: "Server",
            serverUrl = currentProfile?.baseUrl,
            isOnline = hubSnapshot.isConnected,
            isDevMode = currentProfile?.name?.contains("dev", ignoreCase = true) ?: false,
            urgencyCounters = urgency,
            agentRoster = AgentRosterUiState(
                totalEligible = counts?.all ?: 0,
                agents = agentItems,
            ),
            projectList = ProjectListCenterStageUiState(
                searchQuery = searchQuery,
                projects = filteredProjects,
                selectedProjectName = selectedProjectName ?: activeWorkspaceState?.target?.project,
            ),
            isAgentsDrawerOpen = isAgentsDrawerOpen,
            isFilesDrawerOpen = isFilesDrawerOpen,
            isRightFileTreePinned = isRightFileTreePinned,
        )
    }
}
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` (MODIFY)
**Location**: Replace lines 1118-1383 (`AgentHubEmptyRoot`) with `AgentHubLandingRoot`.

```kotlin
@Composable
private fun AgentHubLandingRoot(
    currentProfile: dev.damhopper.nativeapp.features.settings.ProfileData?,
    agents: TerminalAgentsContext?,
    hubSnapshot: dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot,
    activeWorkspaceState: dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState?,
    onAction: (dev.damhopper.nativeapp.features.workspace.AgentHubAction) -> Unit,
    navigation: dev.damhopper.nativeapp.ui.flow.AppFlowNavigation,
    openSettings: () -> Unit,
    openAgentSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var selectedProject by rememberSaveable { mutableStateOf<String?>(null) }
    var isAgentsDrawerOpen by rememberSaveable { mutableStateOf(false) }
    var isFilesDrawerOpen by rememberSaveable { mutableStateOf(false) }
    var isRightFileTreePinned by rememberSaveable { mutableStateOf(true) }

    val uiState = remember(
        currentProfile, hubSnapshot, agents, activeWorkspaceState,
        searchQuery, selectedProject, isAgentsDrawerOpen, isFilesDrawerOpen, isRightFileTreePinned,
    ) {
        AgentHubLandingProjection.project(
            currentProfile = currentProfile,
            hubSnapshot = hubSnapshot,
            agentsContext = agents,
            activeWorkspaceState = activeWorkspaceState,
            searchQuery = searchQuery,
            selectedProjectName = selectedProject,
            isAgentsDrawerOpen = isAgentsDrawerOpen,
            isFilesDrawerOpen = isFilesDrawerOpen,
            isRightFileTreePinned = isRightFileTreePinned,
        )
    }

    val callbacks = remember(navigation, onAction, openSettings, openAgentSettings) {
        object : AgentHubLandingCallbacks {
            override fun onToggleAgentsSidebar() { isAgentsDrawerOpen = !isAgentsDrawerOpen }
            override fun onToggleFilesSidebar() { isFilesDrawerOpen = !isFilesDrawerOpen }
            override fun onOpenNotifications() { navigation.toggleNotifications() }
            override fun onOpenSettings() { openSettings() }
            override fun onSwitchProfile() { navigation.navigateToProfiles() }

            override fun onAgentFilterChange(filter: dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection) {}
            override fun onJumpToAgentTerminal(terminalId: String, incarnationExact: Long) {
                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.SelectTerminal(
                    terminalId = terminalId,
                    incarnationExact = incarnationExact.toString(),
                ))
            }
            override fun onRefreshAgents() {
                agents?.refreshAll?.invoke(dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason.MANUAL_USER)
            }
            override fun onOpenAgentSettings() { openAgentSettings() }

            override fun onSearchQueryChange(query: String) { searchQuery = query }
            override fun onOpenProjectPicker() { navigation.openProjectPicker() }
            override fun onSelectProjectForTree(projectName: String) {
                selectedProject = projectName
                isFilesDrawerOpen = true
            }
            override fun onLaunchTerminalInProject(projectName: String) {
                val target = dev.damhopper.nativeapp.core.model.ProjectTargetRef(
                    profileId = currentProfile?.name ?: "",
                    project = projectName,
                )
                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.CreateTerminalIntent(target))
            }
            override fun onOpenGitForProject(projectName: String) {
                val target = dev.damhopper.nativeapp.core.model.ProjectTargetRef(
                    profileId = currentProfile?.name ?: "",
                    project = projectName,
                )
                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.OpenGit(target))
            }
            override fun onDismissZeroSessionProject(projectName: String) {
                val target = dev.damhopper.nativeapp.core.model.ProjectTargetRef(
                    profileId = currentProfile?.name ?: "",
                    project = projectName,
                )
                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.DismissZeroSessionProject(target))
            }

            override fun onToggleFolder(path: String) {}
            override fun onOpenFileInEditor(target: dev.damhopper.nativeapp.core.model.ProjectTargetRef, path: String) {
                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.OpenEditor(
                    fileRef = path,
                    target = dev.damhopper.nativeapp.core.model.FilesystemTargetRef.Project(
                        profileId = target.profileId,
                        project = target.project,
                        worktreePath = target.worktreePath,
                    ),
                ))
            }
            override fun onOpenChangesReview(projectName: String) {
                onOpenGitForProject(projectName)
            }
            override fun onCloseFilesSidebar() {
                isFilesDrawerOpen = false
                isRightFileTreePinned = false
            }
        }
    }

    AgentHubLandingScreen(
        state = uiState,
        callbacks = callbacks,
        modifier = modifier,
    )
}
```

And in lines 852-862 of `DamHopperMobileApp.kt`:
Replace the call to `AgentHubEmptyRoot(...)` with `AgentHubLandingRoot(...)`.

---

## Verification Commands
```bash
cmd.exe /c "cd /d G:\ws\sharing\dam-hopper\native\android-app && gradlew.bat :shared:compileKotlinJvm :androidApp:compileDebugKotlin"
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "implement-agent-hub-landing-projection",
    "title": "Implement AgentHubLandingProjection pure state mapper",
    "blocked_by": [
      "define-agent-hub-state-models"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingProjection.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Pure function with no android-specific dependencies.",
      "Safely handle null agentsContext, empty snapshots, and unselected projects."
    ],
    "acceptance": [
      "AgentHubLandingProjection.project accurately translates domain snapshots into AgentHubLandingUiState.",
      "Zero-session dismissible targets and attention messages are correctly derived."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "integrate-agent-hub-landing-screen",
    "title": "Integrate AgentHubLandingRoot into DamHopperMobileApp replacing AgentHubEmptyRoot",
    "blocked_by": [
      "implement-agent-hub-landing-screen",
      "implement-agent-hub-landing-projection"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt"
    ],
    "constraints": [
      "Replace lines 1118-1383 (AgentHubEmptyRoot) with AgentHubLandingRoot.",
      "Wire AppFlowStage.HUB and AppFlowStage.PROJECT_LIST routing to AgentHubLandingRoot.",
      "Ensure all callbacks safely delegate to navigation and services.dispatchAction."
    ],
    "acceptance": [
      "DamHopperMobileApp compiles cleanly and launches AgentHubLandingScreen on post-login landing.",
      "Legacy AgentHubEmptyRoot is completely retired."
    ],
    "verification": [
      ":androidApp:compileDebugKotlin passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-agent-hub-landing-projection --> Implement AgentHubLandingProjection pure state mapper
- [ ] <!-- evcrate-task:integrate-agent-hub-landing-screen --> Integrate AgentHubLandingRoot into DamHopperMobileApp replacing AgentHubEmptyRoot
