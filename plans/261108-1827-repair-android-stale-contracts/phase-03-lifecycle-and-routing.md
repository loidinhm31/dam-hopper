# Phase 03 — Flow Lifecycle, Panel Observation & Routing

## Overview
- **Priority**: P0
- **Status**: completed
- **Effort**: 1.5h
- **Owner**: UI / App Flow (`:shared` & `:androidApp`)
- **Dependencies**: [Phase 01](./phase-01-shared-contracts.md)

---

## Context & Objectives
1. **Agents Section Failure**: Following Phase 07, `AppFlowStage.TERMINAL` was superseded by `AppFlowStage.HUB`. In `DamHopperMobileApp.kt` lines 437 and 484, `flowState.stage == AppFlowStage.TERMINAL` is strictly tested. Since `flowState.stage` is always `AppFlowStage.HUB`, `agentsRegistration` is never created (`null`), `TerminalAgentsContext.registration` is null, and active terminal tabs cannot be published to the Agents roster.
2. **Global Workspace File Explorer UI Drop-Off**: In `DamHopperMobileApp.kt` line 847, `activeWorkspaceState.activePanel.value` is read directly without Compose state observation (`collectAsState()`). When the user clicks "Files" or "Editor" in `AgentHubEmptyRoot`, the panel changes to `FILES` or `EDITOR`, but Compose does not track the raw `.value` read and immediately falls back to `AgentHubEmptyRoot`.
3. **Flow Navigation for Global Workspace**: In `NativeWorkspaceViewModel.kt` lines 2105–2116 and 2119–2152, dispatching `AgentHubAction.OpenFiles` or `AgentHubAction.OpenEditor` with `FilesystemTargetRef.Workspace` does not notify `flowNavigation`, leaving `flowNavigation.state.value.activeProject` unchanged. `flowNavigation.selectProject(null, null, profId)` must be called so `selectedProj` is null, resolving `effectiveProject` to `"*"` and activating the global workspace state.
4. **Deprecated Enum Cleanup**: Deprecated `AppFlowStage.TERMINAL` usages across `DamHopperMobileApp.kt` emit 10 compiler warnings and create confusion about current navigation invariants.

---

## Exact File Actions

### 1. `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`

#### A. Fix `agentsRegistration` (Lines 431–452)
Admit `AppFlowStage.HUB` alongside `AppFlowStage.TERMINAL`:

**Before**:
```kotlin
    val agentsRegistration = remember(
        agentsService, flowState.stage, activeProfileId, currentProfile?.baseUrl, agentsAccount, selectedProj, flowState.activeWorktreePath,
    ) {
        val profId = activeProfileId
        val prof = currentProfile
        val project = selectedProj
        if (agentsService != null && flowState.stage == AppFlowStage.TERMINAL && profId != null && prof != null &&
            agentsAccount != null && project != null && project.isNotBlank()
        ) {
            agentsService.registerWorkspace(
                WorkspaceFileOwner(
                    profileId = profId,
                    baseUrl = prof.baseUrl,
                    accountUser = agentsAccount,
                    project = project,
                    worktreePath = flowState.activeWorktreePath,
                ),
            )
        } else {
            null
        }
    }
```

**After**:
```kotlin
    val agentsRegistration = remember(
        agentsService, flowState.stage, activeProfileId, currentProfile?.baseUrl, agentsAccount, selectedProj, flowState.activeWorktreePath,
    ) {
        val profId = activeProfileId
        val prof = currentProfile
        val project = selectedProj
        val isWorkspaceActive = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL)
        if (agentsService != null && isWorkspaceActive && profId != null && prof != null &&
            agentsAccount != null && project != null && project.isNotBlank()
        ) {
            agentsService.registerWorkspace(
                WorkspaceFileOwner(
                    profileId = profId,
                    baseUrl = prof.baseUrl,
                    accountUser = agentsAccount,
                    project = project,
                    worktreePath = flowState.activeWorktreePath,
                ),
            )
        } else {
            null
        }
    }
```

---

#### B. Fix Background Reconciliation Gate (Lines 481–492)
Admit `AppFlowStage.HUB` when checking whether the workspace is currently focused:

**Before**:
```kotlin
            val reg = service.registerWorkspace(owner)
            val normWt = WorkspaceFileOwner.normalizeWorktree(worktreePath)
            val activeWt = WorkspaceFileOwner.normalizeWorktree(flowState.activeWorktreePath)
            if (flowState.stage != AppFlowStage.TERMINAL || project != selectedProj || normWt != activeWt) {
                val matchingSessions = receipt.sessions.filter {
                    TerminalAgentsMembership.isTraditionalType(it.sessionType) && it.alive && !it.targetUnavailable &&
                        it.project == project && WorkspaceFileOwner.normalizeWorktree(it.worktreePath) == normWt
                }
                service.publishWorkspaceTabs(reg, receipt, matchingSessions, emptySet())
            }
```

**After**:
```kotlin
            val reg = service.registerWorkspace(owner)
            val normWt = WorkspaceFileOwner.normalizeWorktree(worktreePath)
            val activeWt = WorkspaceFileOwner.normalizeWorktree(flowState.activeWorktreePath)
            val isCurrentlyFocusedWorkspace = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL) &&
                project == selectedProj && normWt == activeWt
            if (!isCurrentlyFocusedWorkspace) {
                val matchingSessions = receipt.sessions.filter {
                    TerminalAgentsMembership.isTraditionalType(it.sessionType) && it.alive && !it.targetUnavailable &&
                        it.project == project && WorkspaceFileOwner.normalizeWorktree(it.worktreePath) == normWt
                }
                service.publishWorkspaceTabs(reg, receipt, matchingSessions, emptySet())
            }
```

---

#### C. Fix Workspace Root / Empty Root Selection (Lines 845–860)
Replace the unobserved `activeWorkspaceState.activePanel.value` with `currentPanel` (which is already collected as a Compose State via `collectAsState()` on line 562):

**Before**:
```kotlin
                        AppFlowStage.HUB, AppFlowStage.TERMINAL, AppFlowStage.PROJECT_LIST -> {
                            val proj = flowState.activeProject
                            if (proj.isNullOrBlank() && (activeWorkspaceState == null || activeWorkspaceState.activePanel.value == WorkspacePanel.TERMINAL)) {
                                AgentHubEmptyRoot(
                                    profileName = currentProfile?.name ?: "Server",
                                    serverUrl = currentProfile?.baseUrl,
                                    headerEntries = headerEntries,
                                    agents = agentsContext,
                                    hubSnapshot = hubSnapshot,
                                    onAction = { action -> scope.launch { services?.dispatchAction(action) } },
                                    onOpenProject = { navigation.openProjectPicker() },
                                    onOpenSettings = { navigation.openSettings(SettingsOrigin(flowState.stage, flowState.activeSessionId)) },
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else if (activeWorkspaceState != null) {
                                ProjectWorkspaceScreen(
                                    projectName = proj ?: "Workspace",
                                    workspaceState = activeWorkspaceState,
                                    terminalRepo = terminalRepo,
                                    navigation = navigation,
                                    initialSessionId = flowState.activeSessionId,
                                    agentsContext = agentsContext,
                                    activeProfileId = activeProfileId,
                                    currentReceipt = currentReceipt,
                                    services = services,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
```

**After**:
```kotlin
                        AppFlowStage.HUB, AppFlowStage.TERMINAL, AppFlowStage.PROJECT_LIST -> {
                            val proj = flowState.activeProject
                            if (proj.isNullOrBlank() && (activeWorkspaceState == null || currentPanel == WorkspacePanel.TERMINAL)) {
                                AgentHubEmptyRoot(
                                    profileName = currentProfile?.name ?: "Server",
                                    serverUrl = currentProfile?.baseUrl,
                                    headerEntries = headerEntries,
                                    agents = agentsContext,
                                    hubSnapshot = hubSnapshot,
                                    onAction = { action -> scope.launch { services?.dispatchAction(action) } },
                                    onOpenProject = { navigation.openProjectPicker() },
                                    onOpenSettings = { navigation.openSettings(SettingsOrigin(flowState.stage, flowState.activeSessionId)) },
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else if (activeWorkspaceState != null) {
                                ProjectWorkspaceScreen(
                                    projectName = proj ?: "Workspace",
                                    workspaceState = activeWorkspaceState,
                                    terminalRepo = terminalRepo,
                                    navigation = navigation,
                                    initialSessionId = flowState.activeSessionId,
                                    agentsContext = agentsContext,
                                    activeProfileId = activeProfileId,
                                    currentReceipt = currentReceipt,
                                    services = services,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
```

---

#### D. Clean Up Deprecated `AppFlowStage.TERMINAL` References
- **Line 520 & 522**: Navigation restore state:
  ```kotlin
  val lastNav = profileRepository.getLastNavigationState()
  if (lastNav != null && lastNav.profileId == profId && (lastNav.stage == AppFlowStage.HUB.name || lastNav.stage == AppFlowStage.TERMINAL.name) && lastNav.project != null) {
      navigation.restoreState(
          stage = AppFlowStage.HUB,
          profileId = profId,
          project = lastNav.project,
          sessionId = lastNav.sessionId,
          worktreePath = lastNav.worktreePath
      )
  } else {
      navigation.onProfileAuthenticated(profId)
  }
  ```
- **Line 607**: Agents host close guard:
  ```kotlin
  LaunchedEffect(flowState.stage) {
      if (flowState.stage != AppFlowStage.HUB && flowState.stage != AppFlowStage.TERMINAL) agentsHost.close()
  }
  ```
- **Line 724 & 904**: Workspace shortcuts and search view:
  ```kotlin
  val inWorkspace = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL) && ws != null
  ```
  (Ensure consistent compound check or unified HUB stage).

---

### 2. `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`

#### A. Handle `AgentHubAction.OpenFiles` with `FilesystemTargetRef.Workspace`
Transition `flowNavigation.selectProject(null, null, profId)` so `flowState.activeProject` is null and `effectiveProject` in `DamHopperMobileApp` evaluates to `"*"`.

**Location**: Lines 2105–2116.

**Before**:
```kotlin
            is AgentHubAction.OpenFiles -> {
                when (val target = action.target) {
                    is FilesystemTargetRef.Project -> {
                        flowNavigation.selectProject(target.project, target.worktreePath, target.profileId)
                        activeWorkspaceStateOwner(target.profileId)?.let { workspaceStates[it]?.selectPanel(WorkspacePanel.FILES) }
                    }
                    is FilesystemTargetRef.Workspace -> {
                        val profId = target.profileId ?: flowNavigation.state.value.activeProfileId
                        val owner = profId?.let { p ->
                            workspaceStates.keys.firstOrNull { it.profileId == p && (it.project == "*" || it.project.isBlank()) }
                                ?: activeWorkspaceStateOwner(p)
                        }
                        owner?.let {
                            val ws = workspaceStates[it]
                            ws?.selectPanel(WorkspacePanel.FILES)
                            ws?.fileTreeState?.selectBrowsingTarget(target)
                        }
                    }
                }
            }
```

**After**:
```kotlin
            is AgentHubAction.OpenFiles -> {
                when (val target = action.target) {
                    is FilesystemTargetRef.Project -> {
                        flowNavigation.selectProject(target.project, target.worktreePath, target.profileId)
                        activeWorkspaceStateOwner(target.profileId)?.let { workspaceStates[it]?.selectPanel(WorkspacePanel.FILES) }
                    }
                    is FilesystemTargetRef.Workspace -> {
                        val profId = target.profileId ?: flowNavigation.state.value.activeProfileId
                        flowNavigation.selectProject(null, null, profId)
                        val owner = profId?.let { p ->
                            workspaceStates.keys.firstOrNull { it.profileId == p && (it.project == "*" || it.project.isBlank()) }
                                ?: activeWorkspaceStateOwner(p)
                        }
                        owner?.let {
                            val ws = workspaceStates[it]
                            ws?.selectPanel(WorkspacePanel.FILES)
                            ws?.fileTreeState?.selectBrowsingTarget(target)
                        }
                    }
                }
            }
```

---

#### B. Handle `AgentHubAction.OpenEditor` with `FilesystemTargetRef.Workspace`
Transition `flowNavigation.selectProject(null, null, p)` when opening editor for workspace.

**Location**: Lines 2119–2138.

**Before**:
```kotlin
            is AgentHubAction.OpenEditor -> {
                val target = action.target
                val profId = when (target) {
                    is FilesystemTargetRef.Project -> {
                        flowNavigation.selectProject(target.project, target.worktreePath, target.profileId)
                        target.profileId
                    }
                    is FilesystemTargetRef.Workspace -> target.profileId
                    null -> null
                } ?: flowNavigation.state.value.activeProfileId
...
```

**After**:
```kotlin
            is AgentHubAction.OpenEditor -> {
                val target = action.target
                val profId = when (target) {
                    is FilesystemTargetRef.Project -> {
                        flowNavigation.selectProject(target.project, target.worktreePath, target.profileId)
                        target.profileId
                    }
                    is FilesystemTargetRef.Workspace -> {
                        val p = target.profileId ?: flowNavigation.state.value.activeProfileId
                        flowNavigation.selectProject(null, null, p)
                        p
                    }
                    null -> null
                } ?: flowNavigation.state.value.activeProfileId
...
```

---

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "fix-agents-registration-hub-stage",
    "title": "Admit AppFlowStage.HUB in DamHopperMobileApp agents registration and reconciliation",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt"
    ],
    "constraints": [
      "Check flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL for agentsRegistration.",
      "Ensure focused workspace in HUB stage is excluded from background tab publication.",
      "Clean up deprecated AppFlowStage.TERMINAL usages in navigation restore and shortcut handling."
    ],
    "acceptance": [
      "agentsRegistration is created when flowState.stage == AppFlowStage.HUB and a project is selected.",
      "TerminalAgentsContext receives a valid non-null registration.",
      "Background reconciliation does not publish empty excludedTerminalIds for the focused project."
    ],
    "verification": [
      "Compose flow test or state assertions verify agentsRegistration is non-null under AppFlowStage.HUB."
    ]
  },
  {
    "id": "fix-workspace-panel-compose-observation",
    "title": "Observe currentPanel state in DamHopperMobileApp line 847",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt"
    ],
    "constraints": [
      "Use currentPanel (collected on line 562 via collectAsState()) instead of activeWorkspaceState.activePanel.value.",
      "Do not alter empty root styling or header entry layout."
    ],
    "acceptance": [
      "Switching activePanel to FILES or EDITOR in a workspace with null activeProject renders ProjectWorkspaceScreen.",
      "UI does not drop back to AgentHubEmptyRoot when currentPanel != WorkspacePanel.TERMINAL."
    ],
    "verification": [
      "Verify recomposition condition: when activeProject is null and currentPanel is FILES, ProjectWorkspaceScreen is composed."
    ]
  },
  {
    "id": "route-open-files-editor-workspace",
    "title": "Update NativeWorkspaceViewModel to transition flowNavigation on workspace OpenFiles/OpenEditor",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt"
    ],
    "constraints": [
      "Invoke flowNavigation.selectProject(null, null, profId) for FilesystemTargetRef.Workspace.",
      "Select WorkspacePanel.FILES or EDITOR on the matched or active workspace state.",
      "Preserve existing Project target handling."
    ],
    "acceptance": [
      "AgentHubAction.OpenFiles(FilesystemTargetRef.Workspace) clears activeProject in flowNavigation.",
      "The workspace state selects WorkspacePanel.FILES and selects browsing target."
    ],
    "verification": [
      "Unit test dispatching OpenFiles with FilesystemTargetRef.Workspace verifies flowNavigation state has activeProject == null and activePanel == FILES."
    ]
  }
]
```

- [x] <!-- evcrate-task:fix-agents-registration-hub-stage --> Admit AppFlowStage.HUB in DamHopperMobileApp agents registration and reconciliation
- [x] <!-- evcrate-task:fix-workspace-panel-compose-observation --> Observe currentPanel state in DamHopperMobileApp line 847
- [x] <!-- evcrate-task:route-open-files-editor-workspace --> Update NativeWorkspaceViewModel to transition flowNavigation on workspace OpenFiles/OpenEditor
