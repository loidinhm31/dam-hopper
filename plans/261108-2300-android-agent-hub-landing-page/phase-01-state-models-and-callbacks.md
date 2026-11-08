# Phase 01 — State Models & Callback Contract

## Overview
- **Priority**: P1
- **Status**: pending
- **Effort**: 1.5h
- **Owner**: UI Flow Architecture (`:shared`)
- **Dependencies**: None (foundational phase)

---

## Context & Objectives
Define the authoritative, immutable state models and event dispatch contract for the Agent Hub First Page / Landing Screen in `dev.damhopper.nativeapp.ui.flow`.
These models encapsulate:
1. Workspace and server connection identity (profile, reachability, Dev/MFA flags).
2. Urgency counters (attention, working, idle).
3. Cross-project agent roster projection.
4. Center stage project inventory, active terminal sessions, and zero-session dismissible targets.
5. Contextual workspace file tree and Git file change summaries.
6. Drawer and sheet presentation states for responsive layout adaptation.

To honor the **modularization rule (<200 lines per file)**, state models and callbacks are isolated into separate files:
- `AgentHubLandingUiState.kt`
- `AgentHubLandingCallbacks.kt`

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingUiState.kt` (NEW)
**Target Line Count**: ~130 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection

/**
 * Authoritative UI state for the Agent Hub First Page / Landing Screen.
 */
data class AgentHubLandingUiState(
    val profileName: String = "Server",
    val serverUrl: String? = null,
    val isOnline: Boolean = true,
    val isDevMode: Boolean = false,
    val hasMfa: Boolean = false,
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
    val agentName: String, // "Codex", "OMP", "Claude"
    val projectName: String,
    val sessionDisplayId: String, // "#1", "#2"
    val status: AgentStatusKind = AgentStatusKind.IDLE,
    val statusLabel: String = "Idle", // "Approval Requested", "Working", "Idle"
    val elapsedDuration: String = "", // "1m 12s", "3m 42s"
    val lastEventSummary: String = "", // "Write perm: auth_service.rs"
    val targetTerminalId: String,
    val incarnationExact: Long = 0L,
)

enum class AgentStatusKind {
    ATTENTION,
    WORKING,
    IDLE,
}

data class ProjectListCenterStageUiState(
    val searchQuery: String = "",
    val projects: List<ProjectCardUiState> = emptyList(),
    val selectedProjectName: String? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

data class ProjectCardUiState(
    val id: String,
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
    val targetRef: ProjectTargetRef,
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
```

---

### 2. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingCallbacks.kt` (NEW)
**Target Line Count**: ~70 lines (< 200 lines)

```kotlin
package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection

/**
 * Event dispatch contract for the Agent Hub Landing Screen.
 */
interface AgentHubLandingCallbacks {
    // Top Chrome & Navigation
    fun onToggleAgentsSidebar()
    fun onToggleFilesSidebar()
    fun onOpenNotifications()
    fun onOpenSettings()
    fun onSwitchProfile()

    // Agents Sidebar
    fun onAgentFilterChange(filter: TerminalAgentsFilterSelection)
    fun onJumpToAgentTerminal(terminalId: String, incarnationExact: Long)
    fun onRefreshAgents()
    fun onOpenAgentSettings()

    // Center Projects Stage
    fun onSearchQueryChange(query: String)
    fun onOpenProjectPicker()
    fun onSelectProjectForTree(projectName: String)
    fun onLaunchTerminalInProject(projectName: String)
    fun onOpenGitForProject(projectName: String)
    fun onDismissZeroSessionProject(projectName: String)

    // Workspace File Tree & Code Editor
    fun onToggleFolder(path: String)
    fun onOpenFileInEditor(target: ProjectTargetRef, path: String)
    fun onOpenChangesReview(projectName: String)
    fun onCloseFilesSidebar()
}

/**
 * No-op implementation of [AgentHubLandingCallbacks] for preview and unit test mocks.
 */
open class EmptyAgentHubLandingCallbacks : AgentHubLandingCallbacks {
    override fun onToggleAgentsSidebar() {}
    override fun onToggleFilesSidebar() {}
    override fun onOpenNotifications() {}
    override fun onOpenSettings() {}
    override fun onSwitchProfile() {}
    override fun onAgentFilterChange(filter: TerminalAgentsFilterSelection) {}
    override fun onJumpToAgentTerminal(terminalId: String, incarnationExact: Long) {}
    override fun onRefreshAgents() {}
    override fun onOpenAgentSettings() {}
    override fun onSearchQueryChange(query: String) {}
    override fun onOpenProjectPicker() {}
    override fun onSelectProjectForTree(projectName: String) {}
    override fun onLaunchTerminalInProject(projectName: String) {}
    override fun onOpenGitForProject(projectName: String) {}
    override fun onDismissZeroSessionProject(projectName: String) {}
    override fun onToggleFolder(path: String) {}
    override fun onOpenFileInEditor(target: ProjectTargetRef, path: String) {}
    override fun onOpenChangesReview(projectName: String) {}
    override fun onCloseFilesSidebar() {}
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
    "id": "define-agent-hub-state-models",
    "title": "Define Agent Hub Landing Screen UI state data classes and enums",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingUiState.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "All classes must be immutable data classes or enums.",
      "Provide clean default values for all collections and state flags."
    ],
    "acceptance": [
      "AgentHubLandingUiState compiles cleanly on KMP commonMain.",
      "Encapsulates urgencyCounters, agentRoster, projectList, and workspaceFileTree."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  },
  {
    "id": "define-agent-hub-callbacks",
    "title": "Define AgentHubLandingCallbacks interface and no-op implementation",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AgentHubLandingCallbacks.kt"
    ],
    "constraints": [
      "Keep file under 200 lines.",
      "Interface methods must cover all header, agent, project, and file tree user interactions."
    ],
    "acceptance": [
      "AgentHubLandingCallbacks compiles cleanly on KMP commonMain.",
      "EmptyAgentHubLandingCallbacks provides safe no-op defaults for previews and tests."
    ],
    "verification": [
      ":shared:compileKotlinJvm passes without compiler errors."
    ]
  }
]
```

- [ ] <!-- evcrate-task:define-agent-hub-state-models --> Define Agent Hub Landing Screen UI state data classes and enums
- [ ] <!-- evcrate-task:define-agent-hub-callbacks --> Define AgentHubLandingCallbacks interface and no-op implementation
