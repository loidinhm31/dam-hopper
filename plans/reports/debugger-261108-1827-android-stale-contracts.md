# Diagnostic Report: Android App Stale Contracts & Runtime Breakages

**Date**: 2026-11-08  
**Author**: DebugAndroidContracts  
**Scope**: `native/android-app` and server REST/WebSocket filesystem contracts (`server/src/api/fs.rs`, `server/src/api/ws.rs`)  
**Target Path**: `plans/reports/debugger-261108-1827-android-stale-contracts.md`

---

## 1. Executive Summary

Investigation of three critical contract and runtime failures in `native/android-app`:
1. **Agents Section Failure**: Stale gate `flowState.stage == AppFlowStage.TERMINAL` in `DamHopperMobileApp.kt` (lines 437, 484). Following Phase 07, `AppFlowStage.TERMINAL` was superseded by `AppFlowStage.HUB`. `DamHopperMobileApp.kt` never creates `agentsRegistration` (it stays `null`), leaving `TerminalAgentsContext.registration == null`. The Agents sidebar treats the workspace as unauthenticated/unavailable and `ProjectTerminalScreen` cannot publish tabs to the roster.
2. **Global Workspace File Explorer Failure**: 
   - `NativeWorkspaceViewModel.kt` (lines 2105–2116) handles `AgentHubAction.OpenFiles` with `FilesystemTargetRef.Workspace` by finding an existing owner in `workspaceStates`, but never updates `flowNavigation`. Consequently, `flowState.activeProject` remains `null`.
   - In `DamHopperMobileApp.kt` line 847, `activeWorkspaceState.activePanel.value` is read directly without Compose state tracking (`collectAsState()`), causing the UI to miss the panel change and immediately fall back to `AgentHubEmptyRoot`.
   - In `FileTreeState.kt` line 117, `FilesystemTargetRef.Workspace` is erroneously mapped to `ProjectTargetRef(project = "workspace")` instead of `ProjectTargetRef(project = "*")`. This causes:
     - Cross-owner rejection in `WorkspaceFileOwner.kt` (line 39) / `FileRepository.kt` (line 64).
     - REST query corruption in `FileRepository.kt` (line 77): sends `GET /api/fs/list?targetType=project&project=workspace` instead of `targetType=workspace`, failing with HTTP 404.
     - WebSocket subscription corruption in `FileTreeSubscription.kt` (line 299): sends `fs:subscribe_tree` with `{ type: "project", project: "workspace" }`, failing with `NOT_FOUND`.
3. **Project File Tree Failure**:
   - `FileTreeState.kt` (lines 406–423) resolves `currentProjectRef`, but delegates to `watchCoordinator.fetchDirectoryOrdered("")`. `FileWatchCoordinator` binds immutably to its constructor-injected `val target: ProjectTargetRef`, ignoring changes in `_activeBrowsingTarget.value`.
   - `ProjectWorkspaceState.create` (line 652) defaults `coroutineScope` to `CoroutineScope(Dispatchers.Main.immediate)` without `SupervisorJob()`. An unhandled child failure (e.g., failed watcher subscription or network drop) cancels the entire workspace scope, killing all subsequent explorer, editor, and git operations.

| Issue | Severity | Root Cause | Impact |
|---|---|---|---|
| 1. Agents Section Failure | P0 | Stale `AppFlowStage.TERMINAL` checks in `DamHopperMobileApp.kt` (lines 437, 484) | Agents roster completely broken; registration is null; active tabs never published |
| 2. Global Workspace Explorer Failure | P0 | Unobserved Compose read in line 847; invalid target `"workspace"` in `FileTreeState.kt` line 117 | UI falls back to `AgentHubEmptyRoot`; 404 and cross-owner exceptions on file browse |
| 3. Project File Tree Failure | P1 | Decoupled `watchCoordinator.target`; missing `SupervisorJob()` on `Dispatchers.Main.immediate` | File tree fails to subscribe/refresh on target switch; scope cancellation cascades |

---

## 2. Technical Analysis

### Issue 1: Agents Section Failure (Stale `AppFlowStage.TERMINAL` Gate)

#### 1.1 Affected Files & Exact Lines
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt`: lines 15–16, 20–22
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`: lines 49–52, 220, 255, 387, 436, 452
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`: lines 431–452, 481–491, 647–658, 845–847
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/TerminalAgentsSidebarHost.kt`: lines 211–221
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`: lines 894–896
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/TerminalAgentsInventoryCoordinator.kt`: lines 620–630

#### 1.2 Broken Logic Flow
1. **Stage Migration Incomplete**:
   In `AppFlowState.kt`:
   ```kotlin
   enum class AppFlowStage {
       PROFILE_LOGIN,
       HUB,
       @Deprecated("Legacy linear stage superseded by HUB in Phase 07")
       PROJECT_LIST,
       @Deprecated("Legacy linear stage superseded by HUB in Phase 07")
       TERMINAL;
   }
   ```
   In `AppFlowNavigation.kt`, all authentication and selection transitions set `stage = AppFlowStage.HUB`:
   - Line 50: `restoreState` maps `TERMINAL` and `PROJECT_LIST` to `HUB`.
   - Line 220: `onProfileAuthenticated` sets `stage = AppFlowStage.HUB`.
   - Line 255: `selectProject` sets `stage = AppFlowStage.HUB`.
   - Line 387: `onNotificationRouteSelected` sets `stage = AppFlowStage.HUB`.
   The application flow stage is **never** `AppFlowStage.TERMINAL`.
2. **Registration Starvation**:
   In `DamHopperMobileApp.kt` lines 431–452:
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
               WorkspaceFileOwner(...)
           )
       } else {
           null
       }
   }
   ```
   Because `flowState.stage == AppFlowStage.HUB`, `flowState.stage == AppFlowStage.TERMINAL` evaluates to `false`. `agentsRegistration` is **always `null`**.
3. **Context Nullability & Sidebar Drop-Off**:
   In `DamHopperMobileApp.kt` line 647:
   ```kotlin
   val agentsContext = remember(agentsService, agentsRegistration, agentsHost, services) {
       if (agentsService != null && services != null) {
           TerminalAgentsContext(
               service = agentsService,
               registration = agentsRegistration, // ALWAYS NULL
               host = agentsHost,
               refreshAll = { reason -> services.refreshTerminalAgents(reason) },
               onOpenSettings = { latestOpenAgentSettings() },
           )
       } else null
   }
   ```
   In `TerminalAgentsSidebarHost.kt` line 211:
   > `Everything a terminal screen needs to participate in the retained Agents roster. [registration] is null when the real authenticated owner is not known: the sidebar then renders an explicit unavailable notice and navigation stays disabled.`
4. **Terminal Tab Publication Silenced**:
   In `ProjectTerminalScreen.kt` lines 894–896:
   ```kotlin
   if (agentsRegistration != null && appliedInventoryRuntime == receipt.runtime && appliedInventoryTicket == receipt.requestTicket) {
       service.publishWorkspaceTabs(agentsRegistration, receipt, eligibleSessions, destroyingKeys)
   }
   ```
   Because `agentsRegistration == null`, `publishWorkspaceTabs` is never called by the terminal screen.
5. **Background Reconciliation Collides**:
   In `DamHopperMobileApp.kt` lines 483–490:
   ```kotlin
   val activeWt = WorkspaceFileOwner.normalizeWorktree(flowState.activeWorktreePath)
   if (flowState.stage != AppFlowStage.TERMINAL || project != selectedProj || normWt != activeWt) {
       val matchingSessions = receipt.sessions.filter { ... }
       service.publishWorkspaceTabs(reg, receipt, matchingSessions, emptySet())
   }
   ```
   Because `flowState.stage != AppFlowStage.TERMINAL` is **always `true`**, this background worker publishes tabs with `emptySet()` for `excludedTerminalIds` for every project, including the active project.
   In `TerminalAgentsInventoryCoordinator.kt` lines 620–630, only published registrations (`it.published && it.runtime != null`) enter `TerminalAgentsProjectionInput`. The active workspace state is never properly represented.

---

### Issue 2: Global Workspace File Explorer Failure (`targetType=workspace` & Collisions)

#### 2.1 Affected Files & Exact Lines
- `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`: lines 2105–2116
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`: lines 362, 562, 846–850
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`: lines 37–43
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileRepository.kt`: lines 63–69, 74–86
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`: lines 109–123 (line 117), 163–208, 221–224, 393–405, 489–505
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt`: lines 296–306
- `server/src/api/fs.rs`: lines 116–158 (`parse_rest_target`), lines 227–243 (`list`)
- `server/src/api/ws.rs`: lines 2272–2301 (`extract_ws_target`), lines 3623–3695 (`do_fs_subscribe`)

#### 2.2 Broken Logic Flow
1. **Flow Navigation Bypassed**:
   In `NativeWorkspaceViewModel.kt` lines 2105–2116:
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
   When navigating to `FilesystemTargetRef.Workspace`:
   - `flowNavigation` is never notified. `flowNavigation.state.value.activeProject` remains `null`.
2. **Compose Drop-Off to `AgentHubEmptyRoot`**:
   In `DamHopperMobileApp.kt` line 562 vs line 847:
   ```kotlin
   // Line 562: collects panel as Compose state
   val currentPanel by (activeWorkspaceState?.activePanel ?: remember { MutableStateFlow(WorkspacePanel.TERMINAL) }).collectAsState()

   // Line 847: reads raw StateFlow property .value (NOT Compose State)
   val proj = flowState.activeProject
   if (proj.isNullOrBlank() && (activeWorkspaceState == null || activeWorkspaceState.activePanel.value == WorkspacePanel.TERMINAL)) {
       AgentHubEmptyRoot(...)
   } else if (activeWorkspaceState != null) {
       ProjectWorkspaceScreen(...)
   }
   ```
   - In Compose, reading `activeWorkspaceState.activePanel.value` directly bypasses Compose snapshot tracking. When `selectPanel(WorkspacePanel.FILES)` is called in `NativeWorkspaceViewModel`, line 847 does not observe the change.
   - Even when recomposed via an external trigger, `activeWorkspaceState` may be `null` or uninitialized for `project = "*"` if `workspaceStates` had no pre-warmed instance.
   - The UI evaluates `proj.isNullOrBlank()` as `true` and falls back to `AgentHubEmptyRoot`.
3. **Invalid Project Target Ref (`"workspace"` vs `"*"`)**:
   In `FileTreeState.kt` line 117:
   ```kotlin
   constructor(
       fsTarget: FilesystemTargetRef,
       repository: FileRepository,
       coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Default),
       watchCoordinator: FileWatchCoordinator? = null,
   ) : this(
       target = when (fsTarget) {
           is FilesystemTargetRef.Project -> fsTarget.toProjectTargetRef()
           is FilesystemTargetRef.Workspace -> ProjectTargetRef(profileId = fsTarget.profileId, project = "workspace") // BUG! Must be "*"
       }, ...
   )
   ```
   Setting `target.project = "workspace"` causes immediate cascading contract violations:
   - **Cross-Owner Check in `WorkspaceFileOwner.kt` (lines 37–43)**:
     ```kotlin
     fun matchesTarget(target: ProjectTargetRef): Boolean {
         if (target.profileId != null && target.profileId != profileId) return false
         if (project.isNotBlank() && project != "*" && target.project != project) return false
         if (project == "*") return true
         val targetWorktree = normalizeWorktree(target.worktreePath)
         return targetWorktree == normalizedWorktreePath
     }
     ```
     If the workspace owner is bound to a project (e.g. `owner.project = "dam-hopper"`), `target.project ("workspace") != project ("dam-hopper")` returns `false`.
     `FileRepository.assertTargetMatchesOwner` (line 64) throws:
     `IllegalArgumentException: Cross-owner target rejected in FileRepository.listDirectory: target=ProjectTargetRef(project=workspace) does not match owner=WorkspaceFileOwner(project=dam-hopper)`.
   - **REST Query Failure in `FileRepository.kt` (lines 77–83)**:
     ```kotlin
     val queryParams = if (target.project == "*") {
         mutableMapOf("targetType" to "workspace", "path" to cleanPath)
     } else {
         val params = mutableMapOf("targetType" to "project", "project" to target.project, "path" to cleanPath)
         target.worktreePath?.let { params["worktreePath"] = it }
         params
     }
     ```
     Because `target.project == "workspace"` (not `"*"`), `FileRepository` sends:
     `GET /api/fs/list?targetType=project&project=workspace&path=.`
     The server (`server/src/api/fs.rs`) checks configured projects for `"workspace"`, finds none, and returns HTTP 404 / `INVALID_FS_TARGET`.
   - **WebSocket Wire Rejection in `FileTreeSubscription.kt` (lines 296–300)**:
     ```kotlin
     val serverTarget = if (target.project == "*") {
         ServerFsTarget(type = "workspace")
     } else {
         ServerFsTarget(type = "project", project = target.project, worktreePath = target.worktreePath)
     }
     ```
     Because `target.project != "*"`, it sends `{ type: "project", project: "workspace" }`. The server returns `ServerMsg.FsError("NOT_FOUND", "target directory not found")`.

---

### Issue 3: Project File Tree Failure (Decoupled Coordinator & Dispatcher Safety)

#### 3.1 Affected Files & Exact Lines
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeState.kt`: lines 102–132, 380–386, 406–423, 488–520
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileWatchCoordinator.kt`: lines 127–132, 343–384, 443–452, 458–523
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileTreeSubscription.kt`: lines 296–338
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`: line 94, line 652
- `server/src/api/ws.rs`: lines 885–915, 2353–2367 (`resolve_target_path`), 3623–3740 (`do_fs_subscribe`)
- `server/src/api/fs.rs`: lines 161–221 (`resolve`), lines 227–243 (`list`)

#### 3.2 Broken Logic Flow
1. **Decoupled Target in `FileWatchCoordinator`**:
   In `FileTreeState.kt`:
   ```kotlin
   var watchCoordinator: FileWatchCoordinator = watchCoordinator ?: FileWatchCoordinator(
       target = target,
       repository = repository,
       coroutineScope = coroutineScope,
   )
   ```
   `FileWatchCoordinator` stores `val target: ProjectTargetRef` as an immutable property.
   In `FileTreeState.initTreeAndSubscriptionInternal` (lines 406–408):
   ```kotlin
   val currentProjectRef = (currentTarget as? FilesystemTargetRef.Project)?.toProjectTargetRef() ?: target
   watchCoordinator.acquireExplorerDemand("")
   when (val result = watchCoordinator.fetchDirectoryOrdered("")) {
       is OrderedDirectoryListingResult.Published -> {
           _root.value = FileTreeHelpers.updateChildren(_root.value, "", result.entries, currentProjectRef)
       }
   }
   ```
   `currentProjectRef` is computed from `_activeBrowsingTarget.value`, but `watchCoordinator.fetchDirectoryOrdered("")` takes **no target parameter**.
   Inside `FileWatchCoordinator.kt`:
   - Line 443: `repository.assertTargetMatchesOwner(target, "subscribeTree")`
   - Line 444: `fallbackSubscriptionManager.subscribeQualified(target = target, ...)`
   - Line 496: `repository.listDirectory(target, cleanDir)`
   All three calls use `this.target` (the constructor target). If `FileTreeState` was created for `"*"` and the user selects a project, or was created for project A and switches to project B, `watchCoordinator` fetches and subscribes to the **original target**, while `FileTreeHelpers.updateChildren` attaches the entries to `currentProjectRef`.
2. **Server Wire Contract Alignment**:
   Comparison of client serialization vs server deserialization for `fs:subscribe_tree`:
   - **Client Wire Message (`ClientMsg.FsSubscribeTree`)**:
     ```json
     {
       "kind": "fs:subscribe_tree",
       "req_id": 100,
       "target": {
         "type": "project",
         "project": "dam-hopper",
         "worktreePath": null
       },
       "path": "",
       "watchOnly": true
     }
     ```
   - **Server Deserialization (`server/src/api/ws_protocol.rs` & `ws.rs`)**:
     ```rust
     #[serde(rename = "fs:subscribe_tree")]
     FsSubTree {
         req_id: u64,
         #[serde(default)]
         target: Option<FilesystemTargetRef>,
         #[serde(default)]
         project: Option<String>,
         #[serde(default)]
         worktree_path: Option<String>,
         path: String,
         #[serde(default, rename = "watchOnly")]
         watch_only: Option<bool>,
     }
     ```
     `extract_ws_target` parses `target` into `FilesystemTargetRef::Project(ProjectTargetRef { project: "dam-hopper", worktree_path: None })`.
   - **Server Path Resolution**:
     `resolve_target_path(state, target_ref, "")` normalizes `""` to `"."`.
     `super::fs::resolve` validates `target.target_path().join(".")` and returns canonical path.
     With `watch_only: true`, server calls `subscribe_target_directory` and returns:
     ```json
     {
       "kind": "fs:tree_snapshot",
       "req_id": 100,
       "sub_id": 1,
       "nodes": []
     }
     ```
     The client listener in `FileTreeSubscription.kt` receives `TreeSnapshot` and fulfills the deferred subscribe request. Then `FileWatchCoordinator` executes REST `GET /api/fs/list?targetType=project&project=dam-hopper&path=.` to obtain directory entries.
   - **Failure Trigger**: If `target.project` is `"workspace"`, server deserializes `target` as `FilesystemTargetRef::Project("workspace")`, fails to resolve project `"workspace"`, and sends `ServerMsg::FsError("NOT_FOUND")`.
3. **Coroutine Dispatcher Risk in `ProjectWorkspaceState.create`**:
   In `ProjectWorkspaceState.kt` lines 94, 652:
   ```kotlin
   fun create(
       owner: WorkspaceFileOwner,
       target: ProjectTargetRef,
       fileRepository: FileRepository,
       editorRepository: EditorRepository,
       documentFactory: EditorDocumentFactory? = null,
       coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate), // MISSING SupervisorJob()
       ...
   ): ProjectWorkspaceState
   ```
   - **Missing `SupervisorJob`**: Using `CoroutineScope(Dispatchers.Main.immediate)` creates a scope with a standard `Job`. In Kotlin coroutines, if any child coroutine launched in `coroutineScope` throws an unhandled exception (e.g. unhandled network exception during `initTreeAndSubscriptionInternal` or `observeConnectionState`), the parent `Job` cancels immediately. Once cancelled, no further coroutines can be launched on `wsState.coroutineScope`.
   - **Shared Scope Cascade**: `ProjectWorkspaceState.coroutineScope` is passed to:
     - `GitWorkspaceRuntime` (line 419 in `DamHopperMobileApp.kt`)
     - `FileTreeState` (line 672 in `ProjectWorkspaceState.kt`)
     - `FileWatchCoordinator` (line 130 in `FileTreeState.kt`)
     - `ProjectTerminalState` (line 684 in `ProjectWorkspaceState.kt`)
     A single watcher error cancels the git runtime, the editor mutation coordinator, and the terminal state simultaneously.
   - **Headless JVM / Testing**: Without `SupervisorJob() + Dispatchers.Main.immediate`, running in headless test environments where the Main dispatcher is not initialized fails with `IllegalStateException: Module with the Main dispatcher had failed to initialize`.

---

## 3. Reproduction Details & Test Analysis

### 3.1 Verification Execution
Ran `./gradlew.bat :shared:jvmTest --rerun-tasks` and `./gradlew.bat :androidApp:testDebugUnitTest --rerun-tasks`:
- `:shared:jvmTest`: 429 tests executed, 429 passed, 0 failed.
- `:androidApp:testDebugUnitTest`: 114 tests executed, 114 passed, 0 failed.

### 3.2 Why Breakages Are Not Caught in Existing JVM Tests
1. **Mocked / Isolated Unit Tests**: Existing unit tests (e.g. `RetainedTerminalAgentsIntegrationTest.kt`, `TerminalAgentsInventoryCoordinatorTest.kt`) instantiate `TerminalAgentsInventoryCoordinator` directly and manually call `inventory.registerWorkspace(...)` and `inventory.publishWorkspaceTabs(...)`. They bypass `DamHopperMobileApp.kt` completely.
2. **Compiler Warnings Ignored**: The Kotlin compiler emitted 10 explicit deprecation warnings during build:
   ```
   w: DamHopperMobileApp.kt:437:70 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:484:49 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:520:101 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:522:46 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:607:84 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:724:99 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:845:56 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   w: DamHopperMobileApp.kt:904:111 'static enum entry TERMINAL: AppFlowStage' is deprecated. Legacy linear stage superseded by HUB in Phase 07.
   ```
3. **No End-to-End Composable Flow Test**: No JVM test simulates clicking `AgentHubAction.OpenFiles(FilesystemTargetRef.Workspace)` and asserting that `ProjectWorkspaceScreen` is composed rather than `AgentHubEmptyRoot`.
4. **Target Constructor Gap**: `FileTreeStateTest.kt` tests `FileTreeState(target = ProjectTargetRef(...))` directly with `target.project == "demo"`, never invoking the secondary constructor `FileTreeState(fsTarget = FilesystemTargetRef.Workspace)` which injects `project = "workspace"`.

---

## 4. Specific Fix Recommendations for evc-planner

### Recommendation 1: Fix Agents Section Lifecycle & Registration in `DamHopperMobileApp.kt`
1. **Update Line 437**:
   Replace:
   ```kotlin
   if (agentsService != null && flowState.stage == AppFlowStage.TERMINAL && profId != null && prof != null &&
       agentsAccount != null && project != null && project.isNotBlank()
   )
   ```
   With:
   ```kotlin
   val isWorkspaceActive = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL)
   if (agentsService != null && isWorkspaceActive && profId != null && prof != null &&
       agentsAccount != null && project != null && project.isNotBlank()
   )
   ```
2. **Update Line 484**:
   Replace:
   ```kotlin
   if (flowState.stage != AppFlowStage.TERMINAL || project != selectedProj || normWt != activeWt)
   ```
   With:
   ```kotlin
   val isCurrentlyFocusedWorkspace = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL) &&
       project == selectedProj && normWt == activeWt
   if (!isCurrentlyFocusedWorkspace)
   ```
   This ensures:
   - When a project is active in `HUB`, `agentsRegistration` is created and provided to `TerminalAgentsContext`.
   - The focused terminal screen publishes its own tabs with accurate `destroyingKeys`, while background reconciliation publishes only for unfocused workspaces.
3. **Clean Up Remaining Deprecated References**:
   Update lines 520, 522, 607, 724, 845, 904 to use `AppFlowStage.HUB` exclusively or check `flowState.stage == AppFlowStage.HUB`.

---

### Recommendation 2: Fix Global Workspace Explorer (`NativeWorkspaceViewModel.kt`, `FileTreeState.kt`, `DamHopperMobileApp.kt`)
1. **Fix `FileTreeState.kt` Line 117**:
   Replace:
   ```kotlin
   is FilesystemTargetRef.Workspace -> ProjectTargetRef(profileId = fsTarget.profileId, project = "workspace")
   ```
   With:
   ```kotlin
   is FilesystemTargetRef.Workspace -> ProjectTargetRef(profileId = fsTarget.profileId, project = "*")
   ```
   This aligns `FileTreeState` with:
   - `WorkspaceFileOwner.kt` line 40 (`if (project == "*") return true`)
   - `FileRepository.kt` line 77 (`if (target.project == "*") { "targetType" to "workspace" }`)
   - `FileTreeSubscription.kt` line 296 (`if (target.project == "*") ServerFsTarget(type = "workspace")`)
2. **Fix `NativeWorkspaceViewModel.kt` Lines 2105–2116**:
   When handling `AgentHubAction.OpenFiles` with `FilesystemTargetRef.Workspace`:
   Ensure a workspace state for `project = "*"` exists and update `flowNavigation` (or ensure `activeProject` is null but active panel is `FILES`).
   ```kotlin
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
   ```
3. **Fix `DamHopperMobileApp.kt` Line 847**:
   Use `currentPanel` (which is already collected as state on line 562) instead of the unobserved `activeWorkspaceState.activePanel.value`:
   ```kotlin
   val proj = flowState.activeProject
   if (proj.isNullOrBlank() && (activeWorkspaceState == null || currentPanel == WorkspacePanel.TERMINAL)) {
       AgentHubEmptyRoot(...)
   } else if (activeWorkspaceState != null) {
       ProjectWorkspaceScreen(...)
   }
   ```

---

### Recommendation 3: Fix Project File Tree & Dispatcher Safety
1. **Pass Dynamic Target to `FileWatchCoordinator`**:
   In `FileWatchCoordinator.kt`, update `fetchDirectoryOrdered` and `ensureSubscribed` to accept an explicit `overrideTarget: ProjectTargetRef? = null` (defaulting to `this.target`), or provide a method to update coordinator target on browsing target change:
   ```kotlin
   suspend fun fetchDirectoryOrdered(
       directoryPath: String,
       targetOverride: ProjectTargetRef? = null,
       maxRefetchAttempts: Int = 2,
   ): OrderedDirectoryListingResult
   ```
   In `FileTreeState.kt` lines 408 and 509, pass `currentProjectRef` to `watchCoordinator.fetchDirectoryOrdered(cleanPath, targetOverride = currentProjectRef)`.
2. **Add `SupervisorJob()` to `ProjectWorkspaceState.create`**:
   In `ProjectWorkspaceState.kt` lines 94 and 652:
   Replace:
   ```kotlin
   coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
   ```
   With:
   ```kotlin
   coroutineScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
   ```
   This isolates child coroutine failures in background watcher and git polling from cancelling the entire workspace scope.

---

## 5. Unresolved Questions
1. When browsing the global workspace (`FilesystemTargetRef.Workspace`) and opening a file that belongs to a detected project folder, should `onOpenFile` switch the active workspace to that project, or stay in the global workspace state with a project-qualified `ProjectTargetRef`? (Currently `FileScreens.kt` line 349 resolves `matchingProj` and passes `ProjectTargetRef(project = matchingProj)`).
2. Should `AppFlowStage.TERMINAL` and `AppFlowStage.PROJECT_LIST` enum entries be completely removed in a subsequent clean cutover once all legacy references in `DamHopperMobileApp.kt` are resolved?
