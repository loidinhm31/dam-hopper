package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.input.key.*
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.lifecycle.LifecycleAware
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.profiles.ProfileListScreen
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.settings.RemoteConfigEditor
import dev.damhopper.nativeapp.features.settings.RemoteConfigRepository
import dev.damhopper.nativeapp.features.settings.RemoteConfigScreen
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.settings.SettingsRepository
import dev.damhopper.nativeapp.features.settings.SettingsScreens
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import dev.damhopper.nativeapp.features.settings.SettingsDiagnosticsInput
import dev.damhopper.nativeapp.features.settings.SettingsScreenServices
import dev.damhopper.nativeapp.core.notifications.NotificationSink
import dev.damhopper.nativeapp.ui.components.CognitoOverlay
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentsPanelScreen
import dev.damhopper.nativeapp.features.terminal.CreateSessionRequest
import dev.damhopper.nativeapp.features.terminal.TerminalPanelScreen
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
import dev.damhopper.nativeapp.features.terminal.TerminalAttachQueue
import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import dev.damhopper.nativeapp.features.workspace.KnownWorkspace
import dev.damhopper.nativeapp.features.workspace.ProjectSummary
import dev.damhopper.nativeapp.features.workspace.ProjectTargetPickerModal
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.features.workspace.WorkspaceStatus
import dev.damhopper.nativeapp.features.workspace.WorkspaceSwitcherModal
import dev.damhopper.nativeapp.features.workspace.WorkspaceSwitchWarningDialog
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.agents.AgentImportController
import dev.damhopper.nativeapp.features.agents.AgentImportRepository
import dev.damhopper.nativeapp.features.agents.AgentMemoryController
import dev.damhopper.nativeapp.features.agents.AgentMemoryRepository
import dev.damhopper.nativeapp.features.agents.AgentStoreController
import dev.damhopper.nativeapp.features.agents.AgentStoreRepository
import dev.damhopper.nativeapp.features.agents.AgentsSubProduct
import dev.damhopper.nativeapp.features.agents.AgentsUnifiedPanelScreen
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.files.FileMutationCoordinator
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.FileTreeState
import dev.damhopper.nativeapp.features.files.FilesPanelScreen
import dev.damhopper.nativeapp.features.files.ProfileTargetBinding
import dev.damhopper.nativeapp.features.files.ReplaceCoordinator
import dev.damhopper.nativeapp.features.files.SearchRepository
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.components.WorkbenchHeader
import dev.damhopper.nativeapp.ui.navigation.PanelHost
import dev.damhopper.nativeapp.ui.navigation.PanelNavigationRow
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.first
import dev.damhopper.nativeapp.features.editor.EditorPanelScreen
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.features.editor.BlameCache
import dev.damhopper.nativeapp.features.editor.BlameRepository
import dev.damhopper.nativeapp.features.git.DiffReviewController
import dev.damhopper.nativeapp.features.git.DiffReviewScreen
import dev.damhopper.nativeapp.features.git.MergeConflictController
import dev.damhopper.nativeapp.features.git.MergeConflictScreen
import dev.damhopper.nativeapp.features.git.GitRepository
import dev.damhopper.nativeapp.features.git.GitHistoryController
import dev.damhopper.nativeapp.features.git.GitChangesController
import dev.damhopper.nativeapp.features.git.GitBranchController
import dev.damhopper.nativeapp.features.git.WorktreeMutationController
import dev.damhopper.nativeapp.features.git.GitRewriteActionController
import dev.damhopper.nativeapp.features.git.GitHistoryActionController
import dev.damhopper.nativeapp.features.git.LeasedPublishController
import dev.damhopper.nativeapp.features.git.GitPanelScreen
import dev.damhopper.nativeapp.features.git.GitSyncController
import dev.damhopper.nativeapp.features.git.GitOperationScope
import dev.damhopper.nativeapp.features.workflow.WorkflowRepository
import dev.damhopper.nativeapp.features.workflow.WorkflowController
import dev.damhopper.nativeapp.features.workflow.ProjectPlansRepository
import dev.damhopper.nativeapp.features.workflow.ProjectPlansController
import dev.damhopper.nativeapp.features.workflow.WorkflowPanelScreen
import dev.damhopper.nativeapp.features.workflow.WorkflowSubProduct
import dev.damhopper.nativeapp.ui.components.GenericPanelPlaceholder
import dev.damhopper.nativeapp.core.transport.HostResourceSseClient
import dev.damhopper.nativeapp.features.host.HostResourceController
import dev.damhopper.nativeapp.features.host.HostResourceRepository
import dev.damhopper.nativeapp.features.host.ResourceStreamCoordinator
import dev.damhopper.nativeapp.features.host.ResourcesSubProduct
import dev.damhopper.nativeapp.features.host.ResourcesUnifiedPanelScreen
import dev.damhopper.nativeapp.features.host.UsageController
import dev.damhopper.nativeapp.features.host.UsageRepository
import dev.damhopper.nativeapp.features.host.PortRepository
import dev.damhopper.nativeapp.features.host.TunnelRepository
import dev.damhopper.nativeapp.features.host.IdleSuspendRepository
import dev.damhopper.nativeapp.features.host.IdleConsentController
import dev.damhopper.nativeapp.features.host.SshRepository
import dev.damhopper.nativeapp.features.host.HostControlRepository
import dev.damhopper.nativeapp.features.host.DiagnosticsRepository
import dev.damhopper.nativeapp.features.host.PortsPanelScreen
import dev.damhopper.nativeapp.features.host.HostControlScreens
import dev.damhopper.nativeapp.features.host.WorkbenchSleepConsentBanner

@Composable
fun WorkbenchScreen(
    initialState: WorkbenchState = WorkbenchState(),
    profileRepository: ProfileRepository? = null,
    targetStore: ProjectTargetStore = remember { ProjectTargetStore() },
    navigation: WorkbenchNavigation = remember { WorkbenchNavigation() },
    settingsRepository: SettingsRepository,
    settingsServices: SettingsScreenServices = SettingsScreenServices(),
    diagnosticsInput: () -> SettingsDiagnosticsInput,
    privacyController: PrivacyController = remember { PrivacyController() },
    agentReducerFor: (ConnectionRef) -> AgentStatusReducer? = { null },
    onAgentStatusRefresh: suspend (ConnectionRef) -> Unit = {},
    invalidateRuntime: suspend (ConnectionRef) -> Unit = {},
    lifecycleCoordinator: LifecycleCoordinator = remember { LifecycleCoordinator() },
    modifier: Modifier = Modifier,
) {
    val navState by navigation.state.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    val profiles by profileRepository?.profiles?.collectAsState() ?: remember { mutableStateOf(emptyList()) }
    val activeProfileId by profileRepository?.activeProfileId?.collectAsState() ?: remember { mutableStateOf(null) }
    val authStatuses by profileRepository?.authStatuses?.collectAsState() ?: remember { mutableStateOf(emptyMap()) }

    val activeProfile = profiles.find { it.id == activeProfileId }
    val currentServerName = activeProfile?.name ?: initialState.serverName

    var workspaceStatus by remember { mutableStateOf<WorkspaceStatus?>(null) }
    var projects by remember { mutableStateOf<List<ProjectSummary>>(emptyList()) }
    var currentWorktrees by remember { mutableStateOf<List<ProjectWorktree>>(emptyList()) }
    var isWorktreesLoading by remember { mutableStateOf(false) }
    var knownWorkspaces by remember { mutableStateOf<List<KnownWorkspace>>(emptyList()) }

    var isSwitchingWorkspace by remember { mutableStateOf(false) }
    var workspaceRepo by remember { mutableStateOf<WorkspaceRepository?>(null) }
    var terminalRepo by remember { mutableStateOf<TerminalRepository?>(null) }
    val allConnections by profileRepository?.registry?.connectionsState?.collectAsState() ?: remember { mutableStateOf(emptyMap()) }
    // The retained owner's reducer for the active runtime (its single collector); Workbench never produces events.
    val agentReducer: AgentStatusReducer? = activeProfileId?.let { allConnections[it] }?.let(agentReducerFor)

    /** Runtime-only agent mutation: runtime readiness is revoked (awaited) first, then the request uses an explicit owner guard. */
    suspend fun runAgentMutation(block: suspend (TerminalRepository, RequestAdmissionGuard) -> Unit) {
        val repo = terminalRepo ?: return
        val owner = repo.apiClient.connection
        try {
            invalidateRuntime(owner)
            block(repo, RuntimeOwnerGuard(owner))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
        }
        onAgentStatusRefresh(owner)
    }
    val cryptoSessionManager = remember { dev.damhopper.nativeapp.core.security.CryptoSessionManager() }
    val terminalControllers = remember { mutableMapOf<String, TerminalSessionController>() }
    val terminalAttachQueues = remember { mutableMapOf<TerminalSessionController, TerminalAttachQueue>() }
    val terminalAttachTokens = remember { mutableMapOf<TerminalSessionController, Long>() }
    var terminalListenersRepo by remember { mutableStateOf<TerminalRepository?>(null) }
    var terminalSessions by remember { mutableStateOf<List<TerminalSessionDetailed>>(emptyList()) }
    var activeTerminalSessionId by remember { mutableStateOf<String?>(null) }
    var terminalSelectionEpoch by remember { mutableStateOf(0L) }
    fun selectTerminalSession(id: String?) {
        if (activeTerminalSessionId != id) {
            terminalSelectionEpoch++
            activeTerminalSessionId = id
        }
    }
    var sessionCounter by remember { mutableStateOf(1) }
    var settingsTab by remember { mutableStateOf(0) } // 0: Profiles, 1: Remote Config
    var activeApiClient by remember { mutableStateOf<ApiClient?>(null) }
    var fileRepo by remember { mutableStateOf<FileRepository?>(null) }
    var fileTreeState by remember { mutableStateOf<FileTreeState?>(null) }
    var fileMutationCoordinator by remember { mutableStateOf<FileMutationCoordinator?>(null) }
    var federatedBindings by remember { mutableStateOf<List<ProfileTargetBinding>>(emptyList()) }
    var federatedRepos by remember { mutableStateOf<Map<String, FileRepository>>(emptyMap()) }
    val currentClientMap by rememberUpdatedState(
        remember(activeApiClient, activeProfileId, federatedBindings) {
            val map = mutableMapOf<String, ApiClient>()
            federatedBindings.forEach { binding ->
                map[binding.profileId] = binding.apiClient
            }
            val active = activeApiClient
            val activeId = activeProfileId
            if (activeId != null && active != null && active.connection.profileId == activeId) {
                map[activeId] = active
            }
            map
        }
    )
    var editorTabsState by remember { mutableStateOf<EditorTabsState?>(null) }
    var editorRepo by remember { mutableStateOf<EditorRepository?>(null) }
    var diffController by remember { mutableStateOf<DiffReviewController?>(null) }
    var mergeController by remember { mutableStateOf<MergeConflictController?>(null) }
    val blameCache = remember { BlameCache() }
    var blameRepo by remember { mutableStateOf<BlameRepository?>(null) }
    var gitRepo by remember { mutableStateOf<GitRepository?>(null) }
    var gitHistoryController by remember { mutableStateOf<GitHistoryController?>(null) }
    var gitChangesController by remember { mutableStateOf<GitChangesController?>(null) }
    var gitBranchController by remember { mutableStateOf<GitBranchController?>(null) }
    var gitWorktreeController by remember { mutableStateOf<WorktreeMutationController?>(null) }
    var gitRewriteController by remember { mutableStateOf<GitRewriteActionController?>(null) }
    var gitActionController by remember { mutableStateOf<GitHistoryActionController?>(null) }
    var leasedPublishController by remember { mutableStateOf<LeasedPublishController?>(null) }
    var gitSyncController by remember { mutableStateOf<GitSyncController?>(null) }
    var workflowRepo by remember { mutableStateOf<WorkflowRepository?>(null) }
    var workflowController by remember { mutableStateOf<WorkflowController?>(null) }
    var projectPlansRepo by remember { mutableStateOf<ProjectPlansRepository?>(null) }
    var projectPlansController by remember { mutableStateOf<ProjectPlansController?>(null) }
    var workflowActiveSubProduct by remember { mutableStateOf(WorkflowSubProduct.TRACKING) }
    var agentStoreRepo by remember { mutableStateOf<AgentStoreRepository?>(null) }
    var agentStoreController by remember { mutableStateOf<AgentStoreController?>(null) }
    var agentMemoryRepo by remember { mutableStateOf<AgentMemoryRepository?>(null) }
    var agentMemoryController by remember { mutableStateOf<AgentMemoryController?>(null) }
    var agentImportRepo by remember { mutableStateOf<AgentImportRepository?>(null) }
    var agentImportController by remember { mutableStateOf<AgentImportController?>(null) }
    var agentsActiveSubProduct by remember { mutableStateOf(AgentsSubProduct.STORE) }
    var hostResourceRepo by remember { mutableStateOf<HostResourceRepository?>(null) }
    var hostResourceController by remember { mutableStateOf<HostResourceController?>(null) }
    var usageRepo by remember { mutableStateOf<UsageRepository?>(null) }
    var usageController by remember { mutableStateOf<UsageController?>(null) }
    var resourcesActiveSubProduct by remember { mutableStateOf(ResourcesSubProduct.FLEET) }
    var portRepo by remember { mutableStateOf<PortRepository?>(null) }
    var tunnelRepo by remember { mutableStateOf<TunnelRepository?>(null) }
    var idleSuspendRepo by remember { mutableStateOf<IdleSuspendRepository?>(null) }
    var idleConsentController by remember { mutableStateOf<IdleConsentController?>(null) }
    var sshRepo by remember { mutableStateOf<SshRepository?>(null) }
    var hostControlRepo by remember { mutableStateOf<HostControlRepository?>(null) }
    var diagnosticsRepo by remember { mutableStateOf<DiagnosticsRepository?>(null) }
    var activeWsConnection by remember { mutableStateOf<dev.damhopper.nativeapp.core.transport.WsConnection?>(null) }
    val searchRepo = remember { SearchRepository() }
    val replaceCoordinator = remember(fileRepo, federatedRepos, editorTabsState) {
        ReplaceCoordinator(
            repositoryProvider = { profId ->
                federatedRepos[profId] ?: if (profId == activeProfileId) fileRepo else null
            },
            isDirtyFile = { target, path ->
                editorTabsState?.isDirtyFile(target, path) ?: false
            }
        )
    }
    // Initialize or re-create repositories when active profile changes
    LaunchedEffect(activeProfileId, activeProfile?.baseUrl) {
        terminalControllers.values.forEach { it.close() }
        terminalControllers.clear()
        terminalAttachQueues.clear()
        terminalAttachTokens.clear()
        terminalSessions = emptyList()
        selectTerminalSession(null)
        cryptoSessionManager.closeAll()

        if (profileRepository != null && activeProfileId != null) {
            try {
                val client = profileRepository.getOrCreateApiClient(activeProfileId!!)
                val wRepo = WorkspaceRepository(client, targetStore)
                val ws = try { profileRepository.getOrCreateWsConnection(activeProfileId!!) } catch (_: Exception) { null }
                activeWsConnection = ws
                val tRepo = TerminalRepository(client, ws)
                workspaceRepo = wRepo
                terminalRepo = tRepo
                activeApiClient = client
                val fRepo = if (ws != null) FileRepository(client, ws, coroutineScope) else null
                fileRepo = fRepo
                editorTabsState?.closeAll()
                if (fRepo != null) {
                    val eRepo = EditorRepository(
                        fileRepository = fRepo,
                        connectionRegistry = profileRepository?.registry,
                        profileId = activeProfileId!!,
                        cryptoSessionProvider = {
                            kotlinx.coroutines.runBlocking {
                                val currentConn = profileRepository?.registry?.getCurrentConnection(activeProfileId!!)
                                cryptoSessionManager.getActiveSession(currentConn)
                            }
                        }
                    )
                    val eTabs = EditorTabsState(activeProfileId!!, eRepo)
                    eTabs.isInputAllowed = { privacyController.isInputAllowed() }
                    editorRepo = eRepo
                    editorTabsState = eTabs
                } else {
                    editorTabsState = null
                    editorRepo = null
                }
                val dCtrl = DiffReviewController(
                    apiClient = client,
                    targetStore = targetStore,
                    isDirtyBufferProvider = { target, path -> editorTabsState?.isDirtyFile(target, path) ?: false },
                    coroutineScope = coroutineScope
                )
                val mCtrl = MergeConflictController(
                    apiClient = client,
                    targetStore = targetStore,
                    coroutineScope = coroutineScope
                )
                val bRepo = BlameRepository(
                    apiClient = client,
                    cache = blameCache,
                    coroutineScope = coroutineScope
                )
                diffController = dCtrl
                mergeController = mCtrl
                blameRepo = bRepo
                val gRepo = GitRepository(client)
                val gHistory = GitHistoryController(gRepo, coroutineScope)
                val gChanges = GitChangesController(gRepo, coroutineScope)
                val gBranch = GitBranchController(gRepo, coroutineScope)
                val gWorktree = WorktreeMutationController(
                    repository = gRepo,
                    coroutineScope = coroutineScope,
                    isTargetDirty = { target -> editorTabsState?.isDirtyTarget(target) ?: false },
                    hasActiveTerminal = { target ->
                        terminalSessions.any { it.project == target.project && it.worktreePath == target.worktreePath }
                    },
                    onActiveWorktreeRemoved = {
                        targetStore.selectTarget(activeProfileId, workspaceStatus?.configPath, navState.activeProject, null)
                    }
                )
                val gRewrite = GitRewriteActionController(gRepo, coroutineScope)
                val gAction = GitHistoryActionController(gRepo, coroutineScope)
                val lPublish = LeasedPublishController(gRepo, coroutineScope)
                val gSync = GitSyncController(gRepo, coroutineScope)
                gitRepo = gRepo
                gitHistoryController = gHistory
                gitChangesController = gChanges
                gitBranchController = gBranch
                gitWorktreeController = gWorktree
                gitRewriteController = gRewrite
                gitActionController = gAction
                leasedPublishController = lPublish
                gitSyncController = gSync
                val wfRepo = WorkflowRepository(client)
                val wfCtrl = WorkflowController(
                    repository = wfRepo,
                    scope = coroutineScope,
                    profileId = activeProfileId ?: "default",
                    generation = client.connection.generation
                )
                val ppRepo = ProjectPlansRepository(apiClient = client, fileRepository = fRepo)
                val ppCtrl = ProjectPlansController(
                    repository = ppRepo,
                    scope = coroutineScope,
                    initialProject = navState.activeProject.takeIf { it != "Default Workspace" } ?: "",
                    initialWorktreePath = null,
                    profileId = activeProfileId ?: "default",
                    generation = client.connection.generation
                )
                workflowRepo = wfRepo
                workflowController = wfCtrl
                projectPlansRepo = ppRepo
                projectPlansController = ppCtrl
                agentStoreController?.retire()
                agentMemoryController?.retire()
                agentImportController?.retire()
                val asRepo = AgentStoreRepository(client)
                val amRepo = AgentMemoryRepository(client)
                val aiRepo = AgentImportRepository(client)
                agentStoreRepo = asRepo
                agentMemoryRepo = amRepo
                agentImportRepo = aiRepo
                val asCtrl = AgentStoreController(asRepo, coroutineScope, activeProfileId ?: "default", client.connection.generation)
                val amCtrl = AgentMemoryController(amRepo, coroutineScope, activeProfileId ?: "default", client.connection.generation)
                val aiCtrl = AgentImportController(aiRepo, coroutineScope, activeProfileId ?: "default", client.connection.generation)
                agentStoreController = asCtrl
                agentMemoryController = amCtrl
                agentImportController = aiCtrl
                hostResourceController?.dispose()
                usageController?.dispose()
                val hRepo = HostResourceRepository(client)
                val uRepo = UsageRepository(client)
                val sseClient = HostResourceSseClient(
                    connection = client.connection,
                    baseUrl = client.normalizedBaseUrl,
                    authTokenProvider = client.authTokenProvider,
                    registry = client.registry,
                )
                val sCoord = ResourceStreamCoordinator(
                    owner = client.connection,
                    sseClient = sseClient,
                    registry = client.registry,
                    coroutineScope = coroutineScope,
                )
                val hCtrl = HostResourceController(client.connection, sCoord, hRepo, coroutineScope)
                val uCtrl = UsageController(client.connection, uRepo, coroutineScope)
                hostResourceRepo = hRepo
                usageRepo = uRepo
                hostResourceController = hCtrl
                usageController = uCtrl
                idleConsentController?.retire()
                portRepo?.clear()
                tunnelRepo?.clear()
                val pRepo = PortRepository(client)
                val tunRepo = TunnelRepository(client)
                val iRepo = IdleSuspendRepository(client)
                val iCtrl = IdleConsentController(
                    connection = client.connection,
                    repository = iRepo,
                    receiptProvider = { ws?.currentReceipt?.value }
                )
                val sRepo = SshRepository(client)
                val hcRepo = HostControlRepository(client)
                val dRepo = DiagnosticsRepository(client)
                portRepo = pRepo
                tunnelRepo = tunRepo
                idleSuspendRepo = iRepo
                idleConsentController = iCtrl
                sshRepo = sRepo
                hostControlRepo = hcRepo
                diagnosticsRepo = dRepo
                coroutineScope.launch {
                    try { iCtrl.refreshStatus() } catch (_: Exception) {}
                }
                coroutineScope.launch {
                    try { ws?.connect() } catch (_: Exception) {}
                }
                val status = try { wRepo.getWorkspaceStatus() } catch (_: Exception) { null }
                workspaceStatus = status
                val projs = try { wRepo.listProjects() } catch (_: Exception) { emptyList() }
                projects = projs
                // Projects will be dispatched to amCtrl via LaunchedEffect(projects)

                if (projs.isNotEmpty() && (navState.activeProject == "Default Workspace" || projs.none { it.name == navState.activeProject })) {
                    navigation.selectProject(projs.first().name)
                }

                val kw = try { wRepo.listKnownWorkspaces() } catch (_: Exception) { null }
                knownWorkspaces = kw?.workspaces ?: emptyList()

            } catch (_: Exception) {}
        } else {
            workspaceRepo = null
            terminalRepo = null
            workspaceStatus = null
            projects = emptyList()
            currentWorktrees = emptyList()
            knownWorkspaces = emptyList()
            terminalSessions = emptyList()
            selectTerminalSession(null)
            terminalControllers.values.forEach { it.close() }
            terminalControllers.clear()
            terminalAttachQueues.clear()
            terminalAttachTokens.clear()
            fileTreeState?.dispose()
            fileRepo?.dispose()
            fileTreeState = null
            fileMutationCoordinator = null
            editorTabsState?.closeAll()
            editorTabsState = null
            editorRepo = null
            fileRepo = null
            activeApiClient = null
            diffController = null
            mergeController = null
            blameRepo = null
            gitRepo = null
            gitHistoryController = null
            gitChangesController = null
            gitBranchController = null
            gitWorktreeController = null
            gitRewriteController = null
            gitActionController = null
            leasedPublishController = null
            gitSyncController = null
            workflowRepo = null
            workflowController = null
            projectPlansRepo = null
            projectPlansController = null
            agentStoreController?.retire()
            agentStoreController = null
            agentStoreRepo = null
            agentMemoryController?.retire()
            agentMemoryController = null
            agentMemoryRepo = null
            agentImportController?.retire()
            agentImportController = null
            agentImportRepo = null
            hostResourceController?.dispose()
            hostResourceController = null
            hostResourceRepo = null
            usageController?.dispose()
            usageController = null
            activeWsConnection = null
            usageRepo = null
            portRepo?.clear()
            portRepo = null
            tunnelRepo?.clear()
            tunnelRepo = null
            idleConsentController?.retire()
            idleConsentController = null
            idleSuspendRepo = null
            sshRepo = null
            hostControlRepo = null
            diagnosticsRepo = null
        }
    }
    // Refresh worktrees when active project changes or workspace revision bumps
    val currentWorkspaceRev = targetStore.getWorkspaceRevision(activeProfileId)
    val currentActiveProj = navState.activeProject
    LaunchedEffect(currentActiveProj, workspaceRepo, currentWorkspaceRev) {
        val repo = workspaceRepo
        val proj = currentActiveProj
        isWorktreesLoading = true
        currentWorktrees = emptyList()
        if (repo != null && proj.isNotBlank() && proj != "Default Workspace") {
            try {
                val wts = repo.listWorktrees(proj)
                // Reject stale async response if workspace revision or project shifted
                if (targetStore.getWorkspaceRevision(activeProfileId) == currentWorkspaceRev && navState.activeProject == proj) {
                    currentWorktrees = wts
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                if (targetStore.getWorkspaceRevision(activeProfileId) == currentWorkspaceRev && navState.activeProject == proj) {
                    currentWorktrees = emptyList()
                }
            } finally {
                if (targetStore.getWorkspaceRevision(activeProfileId) == currentWorkspaceRev && navState.activeProject == proj) {
                    isWorktreesLoading = false
                }
            }
        } else {
            currentWorktrees = emptyList()
            isWorktreesLoading = false
        }
    }
    fun scheduleTerminalAttach(
        ctrl: TerminalSessionController,
        repo: TerminalRepository,
        recoveryOffset: ULong? = null,
    ) {
        val owner = repo.apiClient.connection
        val sessionId = ctrl.sessionId
        val incarnation = ctrl.incarnation
        val epoch = terminalSelectionEpoch
        val project = navState.activeProject
        val controllerKey = "${owner.profileId}:$sessionId"
        val token = (terminalAttachTokens[ctrl] ?: 0L) + 1L
        terminalAttachTokens[ctrl] = token
        val isCurrent = {
            terminalRepo === repo && repo.apiClient.connection == owner &&
                activeProfileId == owner.profileId && navState.activeProject == project &&
                terminalControllers[controllerKey] === ctrl && ctrl.incarnation == incarnation &&
                activeTerminalSessionId == sessionId && terminalSelectionEpoch == epoch &&
                terminalAttachTokens[ctrl] == token
        }
        val queue = terminalAttachQueues.getOrPut(ctrl) { TerminalAttachQueue(ctrl, coroutineScope) }
        val connect: suspend () -> Unit = {
            // A tab action can arrive before the listener effect; keep its gate closed until subscribed.
            snapshotFlow { terminalListenersRepo === repo || terminalRepo !== repo }.first { it }
            if (isCurrent()) repo.wsConnection?.connect()
        }
        val send: suspend (ULong?) -> Unit = { offset -> repo.attachTerminal(sessionId, offset) }
        val onResult: (Exception?) -> Unit = { error ->
            if (error != null) {
                AppLogger.recordDiagnostic(
                    type = "transport",
                    scope = "terminal-panel",
                    message = "terminal.attach_failed",
                    profileId = owner.profileId,
                    generation = owner.generation,
                    sessionId = sessionId,
                )
            }
        }
        if (recoveryOffset == null) queue.attach(isCurrent, connect, send, onResult)
        else queue.recover(recoveryOffset, isCurrent, connect, send, onResult)
    }

    fun getOrCreateController(
        id: String,
        incarnation: Long = 0L,
        repo: TerminalRepository = checkNotNull(terminalRepo),
    ): TerminalSessionController {
        val owner = repo.apiClient.connection
        val compositeKey = "${owner.profileId}:$id"
        val existing = terminalControllers[compositeKey]
        if (existing != null && existing.connectionRef != owner) {
            terminalControllers.remove(compositeKey)
            terminalAttachQueues.remove(existing)
            terminalAttachTokens.remove(existing)
            existing.close()
        }
        return terminalControllers.getOrPut(compositeKey) {
            val session = terminalSessions.find { it.id == id }
            val effectiveIncarnation = if (incarnation != 0L) incarnation else (session?.incarnation?.toLong() ?: 0L)
            val ctrl = TerminalSessionController(
                sessionId = id,
                initialIncarnation = effectiveIncarnation,
                connectionRef = owner,
                terminalRepository = repo,
            )
            ctrl.setRawInputSink { bytes ->
                val epoch = terminalSelectionEpoch
                coroutineScope.launch {
                    if (terminalRepo === repo && repo.apiClient.connection == owner &&
                        terminalControllers[compositeKey] === ctrl && terminalSelectionEpoch == epoch &&
                        activeTerminalSessionId == id && ctrl.isPanelActive && ctrl.isReplayCompleted && ctrl.isInputAllowed()
                    ) repo.writeTerminal(id, bytes.decodeToString())
                }
            }
            ctrl.onRequestReattach = { _, offset -> scheduleTerminalAttach(ctrl, repo, offset) }
            ctrl.isInputAllowed = { privacyController.isInputAllowed() }
            ctrl.isPanelActive = (id == activeTerminalSessionId && navState.activePanel == WorkbenchPanel.TERMINAL)
            ctrl
        }
    }

    // Listener readiness is a prerequisite, not a best-effort ordering between separate effects.
    LaunchedEffect(currentActiveProj, terminalRepo, terminalListenersRepo) {
        val repo = terminalRepo ?: return@LaunchedEffect
        if (terminalListenersRepo !== repo) return@LaunchedEffect
        val owner = repo.apiClient.connection
        try {
            val detailed = repo.listDetailed()
            if (terminalRepo !== repo || repo.apiClient.connection != owner || navState.activeProject != currentActiveProj) {
                return@LaunchedEffect
            }
            terminalSessions = detailed
            if (detailed.isNotEmpty() && (activeTerminalSessionId == null || detailed.none { it.id == activeTerminalSessionId })) {
                val first = detailed.first()
                selectTerminalSession(first.id)
                scheduleTerminalAttach(getOrCreateController(first.id, first.incarnation.toLong(), repo), repo)
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {}
    }

    // Listen to WebSocket events from TerminalRepository
    LaunchedEffect(terminalRepo) {
        val repo = terminalRepo ?: return@LaunchedEffect
        launch(start = CoroutineStart.UNDISPATCHED) {
            repo.terminalOutput.collect { msg ->
                if (terminalRepo !== repo) return@collect
                getOrCreateController(msg.id, msg.incarnation.toLong(), repo).handleLiveChunk(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            repo.terminalBuffer.collect { msg ->
                if (terminalRepo !== repo) return@collect
                getOrCreateController(msg.id, msg.incarnation.toLong(), repo).handleBufferReplay(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.reset,
                    msg.truncated,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            repo.terminalExit.collect { msg ->
                if (terminalRepo !== repo) return@collect
                getOrCreateController(msg.id, msg.incarnation?.toLong() ?: 0L, repo).handleExit(
                    msg.exitCode,
                    msg.willRestart,
                    msg.restartCount,
                    msg.incarnation
                )
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            repo.terminalLagged.collect { msg ->
                if (terminalRepo !== repo) return@collect
                activeTerminalSessionId?.let { id ->
                    terminalControllers["${repo.apiClient.connection.profileId}:$id"]?.handleLagged(msg.dropped)
                }
            }
        }
        launch(start = CoroutineStart.UNDISPATCHED) {
            repo.processRestarted.collect { msg ->
                if (terminalRepo !== repo) return@collect
                getOrCreateController(msg.id, repo = repo).handleProcessRestarted(
                    msg.restartCount,
                    msg.previousExitCode
                )
            }
        }
        terminalListenersRepo = repo
    }

    val activeTerminalController = activeTerminalSessionId?.takeIf { terminalRepo != null }?.let { id ->
        getOrCreateController(id)
    }
    LaunchedEffect(navState.activePanel, activeTerminalSessionId, activeProfileId) {
        val activeKey = "${activeProfileId ?: "none"}:$activeTerminalSessionId"
        terminalControllers.forEach { (key, ctrl) ->
            ctrl.isPanelActive = (key == activeKey && navState.activePanel == WorkbenchPanel.TERMINAL)
        }
    }

    val snapshot = targetStore.getSnapshot(
        profileId = activeProfileId,
        workspaceConfigPath = workspaceStatus?.configPath,
        project = navState.activeProject
    )
    // Refresh Git controllers when active project, worktree, or profile changes
    LaunchedEffect(gitRepo, currentActiveProj, snapshot.target.worktreePath) {
        val client = activeApiClient ?: return@LaunchedEffect
        val proj = currentActiveProj.takeIf { it.isNotBlank() && it != "Default Workspace" } ?: return@LaunchedEffect
        val conn = client.connection
        val scope = GitOperationScope(
            profileId = conn.profileId,
            generation = conn.generation,
            project = proj,
            worktreePath = snapshot.target.worktreePath,
            root = null,
        )
        gitHistoryController?.updateScope(scope, null, null)
        gitChangesController?.updateScope(scope)
        gitBranchController?.updateScope(scope)
        gitWorktreeController?.updateScope(scope)
        gitRewriteController?.updateScope(scope)
        gitActionController?.updateScope(scope)
        leasedPublishController?.updateScope(scope)
        gitSyncController?.updateScope(scope)
        gitBranchController?.refreshBranches { branches ->
            val active = branches.firstOrNull { it.isCurrent }
            gitHistoryController?.updateScope(scope, active, active)
        }
    }
    LaunchedEffect(currentActiveProj, snapshot.target.worktreePath, activeProfileId, activeApiClient) {
        val proj = currentActiveProj.takeIf { it.isNotBlank() && it != "Default Workspace" } ?: ""
        val client = activeApiClient
        val profId = activeProfileId ?: "default"
        val gen = client?.connection?.generation ?: 0L
        projectPlansController?.updateTarget(
            newProject = proj,
            newWorktreePath = snapshot.target.worktreePath,
            newProfileId = profId,
            newGeneration = gen
        )
        workflowController?.updateContext(
            newProfileId = profId,
            newGeneration = gen
        )
    }
    LaunchedEffect(projects, agentMemoryController) {
        agentMemoryController?.setProjects(projects.map { it.name })
    }
    DisposableEffect(navState.activePanel, projectPlansController, workflowActiveSubProduct, agentsActiveSubProduct, resourcesActiveSubProduct) {
        if (navState.activePanel == WorkbenchPanel.WORKFLOW && workflowActiveSubProduct == WorkflowSubProduct.PROJECT_PLANS) {
            navigation.panelBackHandler = {
                projectPlansController?.handleBack() ?: false
            }
        } else if (navState.activePanel == WorkbenchPanel.AGENTS && agentsActiveSubProduct != AgentsSubProduct.STORE) {
            navigation.panelBackHandler = {
                agentsActiveSubProduct = AgentsSubProduct.STORE
                true
            }
        } else if (navState.activePanel == WorkbenchPanel.RESOURCES && resourcesActiveSubProduct != ResourcesSubProduct.FLEET) {
            navigation.panelBackHandler = {
                resourcesActiveSubProduct = ResourcesSubProduct.FLEET
                true
            }
        } else {
            navigation.panelBackHandler = null
        }
        onDispose {
            navigation.panelBackHandler = null
        }
    }
    LaunchedEffect(navState.activePanel, hostResourceController, usageController) {
        val isResActive = navState.activePanel == WorkbenchPanel.RESOURCES
        hostResourceController?.setForeground(isResActive)
        usageController?.setForeground(isResActive)
    }
    // Automatically trigger diff / merge queries on panel navigation
    LaunchedEffect(navState.activePanel, navState.activeProject, snapshot.target) {
        val proj = navState.activeProject.takeIf { it != "Default Workspace" }
        if (proj != null) {
            if (navState.activePanel == WorkbenchPanel.DIFF) {
                val current = diffController?.activeQuery?.value
                if (current?.commitHash == null) {
                    val openPath = editorTabsState?.activeTab?.path ?: ""
                    if (openPath.isNotBlank() && current?.path != openPath) {
                        diffController?.loadDiff(proj, snapshot.target, openPath)
                    }
                }
            } else if (navState.activePanel == WorkbenchPanel.MERGE) {
                mergeController?.loadConflicts(proj, snapshot.target)
            }
        }
    }

    LaunchedEffect(fileRepo, snapshot.target) {
        val repo = fileRepo ?: return@LaunchedEffect
        fileTreeState?.dispose()
        val newState = FileTreeState(snapshot.target, repo, coroutineScope)
        fileTreeState = newState
        fileMutationCoordinator = FileMutationCoordinator(repo, newState)
    }
    LaunchedEffect(fileRepo, snapshot.target, editorTabsState) {
        val repo = fileRepo ?: return@LaunchedEffect
        val tabs = editorTabsState ?: return@LaunchedEffect
        val target = snapshot.target
        repo.wsConnection.incomingMessages.collect { msg ->
            if (msg is dev.damhopper.nativeapp.core.transport.ServerMsg.FsEventMsg) {
                val rawPath = msg.event.targetRelativePath ?: msg.event.path
                val cleanPath = rawPath.trimStart('/')
                val kind = msg.event.kind.lowercase()
                if (kind == "modified" || kind == "created" || kind == "modify" || kind == "change") {
                    tabs.handleRemoteFileModified(target, cleanPath)
                }
            }
        }
    }
    LaunchedEffect(profiles, activeProfileId, activeApiClient, snapshot.target) {
        val list = mutableListOf<ProfileTargetBinding>()
        val repos = mutableMapOf<String, FileRepository>()
        if (activeProfileId != null && activeApiClient != null) {
            list.add(ProfileTargetBinding(activeProfileId!!, activeApiClient!!, snapshot.target))
            fileRepo?.let { repos[activeProfileId!!] = it }
        }
        if (profileRepository != null) {
            for (p in profiles) {
                if (p.id != activeProfileId) {
                    try {
                        val c = profileRepository.getOrCreateApiClient(p.id)
                        val t = targetStore.getSnapshot(p.id, null, p.name).target
                        list.add(ProfileTargetBinding(p.id, c, t))
                        val ws = try { profileRepository.getOrCreateWsConnection(p.id) } catch (_: Throwable) { null }
                        if (ws != null) {
                            repos[p.id] = FileRepository(c, ws, coroutineScope)
                        }
                    } catch (_: Throwable) {}
                }
            }
        }
        federatedBindings = list
        federatedRepos = repos
    }
    LaunchedEffect(activeProfileId, portRepo, tunnelRepo, idleConsentController) {
        val p = portRepo ?: return@LaunchedEffect
        val t = tunnelRepo ?: return@LaunchedEffect
        val ic = idleConsentController ?: return@LaunchedEffect
        val wsConn = try { profileRepository?.getOrCreateWsConnection(activeProfileId ?: return@LaunchedEffect) } catch (_: Throwable) { null }
            ?: return@LaunchedEffect

        wsConn.incomingMessages.collect { msg ->
            p.handleServerMsg(msg)
            t.handleServerMsg(msg)
            coroutineScope.launch {
                ic.handleServerMsg(msg)
            }
        }
    }

    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val isMaskActive by privacyController.isMaskActive.collectAsState()
    val workbenchPreferences by settingsRepository.preferences.collectAsState()

    LaunchedEffect(isMaskActive) {
        if (isMaskActive) {
            keyboardController?.hide()
            focusManager.clearFocus(force = true)
        }
    }

    DisposableEffect(lifecycleCoordinator, hostResourceController) {
        val hrc = hostResourceController
        if (hrc != null) {
            lifecycleCoordinator.register(hrc)
        }
        val listener = object : LifecycleAware {
            override fun onForeground() {
                hostResourceController?.coordinator?.setForeground(true)
            }
            override fun onBackground() {
                hostResourceController?.coordinator?.setForeground(false)
                privacyController.reset()
            }
            override fun onOwnerRetired(profileId: String) {
                settingsRepository.onProfileRemoved(profileId)
                val toRemove = terminalControllers.keys.filter { it.startsWith("$profileId:") }
                toRemove.forEach { key ->
                    terminalControllers.remove(key)?.let { controller ->
                        terminalAttachQueues.remove(controller)
                        terminalAttachTokens.remove(controller)
                        controller.close()
                    }
                }
            }
            override fun onDestroy() {
                privacyController.reset()
            }
        }
        lifecycleCoordinator.register(listener)
        onDispose {
            if (hrc != null) {
                lifecycleCoordinator.unregister(hrc)
            }
            lifecycleCoordinator.unregister(listener)
        }
    }

    CognitoOverlay(
        privacyController = privacyController,
        modifier = modifier
            .fillMaxSize()
            .onPreviewKeyEvent { keyEvent ->
                if (keyEvent.type == KeyEventType.KeyDown) {
                    val isCtrl = keyEvent.isCtrlPressed
                    val isAlt = keyEvent.isAltPressed
                    val isShift = keyEvent.isShiftPressed
                    val chord = buildString {
                        if (isCtrl) append("ctrl+")
                        if (isAlt) append("alt+")
                        if (isShift) append("shift+")
                        when (keyEvent.key) {
                            Key.P -> append("p")
                            Key.L -> append("l")
                            Key.K -> append("k")
                            Key.C -> append("c")
                            Key.D -> append("d")
                            Key.Z -> append("z")
                            Key.Escape -> append("esc")
                            else -> append(keyEvent.key.keyCode.toString())
                        }
                    }
                    if (isMaskActive) {
                        if (privacyController.dismissWithChord(chord)) {
                            keyboardController?.hide()
                            true
                        } else {
                            true
                        }
                    } else {
                        val configured = workbenchPreferences.cognitoModeShortcut.trim().lowercase()
                        if (chord == configured) {
                            privacyController.activate(chord, workbenchPreferences.cognitoModeStyle)
                            true
                        } else {
                            false
                        }
                    }
                } else if (isMaskActive) {
                    true
                } else {
                    false
                }
            },
    ) {
        dev.damhopper.nativeapp.ui.theme.NativeTheme(theme = workbenchPreferences.theme) {
            Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DamHopperColors.Background)
                .safeDrawingPadding()
        ) {
        // 1. Top Header: Server & Project info with interactive target picker and workspace switcher
        WorkbenchHeader(
            state = initialState.copy(
                serverName = currentServerName,
                activeProject = navState.activeProject,
                activePanel = navState.activePanel
            ),
            targetLabel = snapshot.label,
            onOpenProfiles = if (profileRepository != null) { { navigation.openProfileList() } } else null,
            onOpenTargetPicker = { navigation.openTargetPicker() },
            onOpenWorkspaceSwitcher = { navigation.openWorkspaceSwitcher() }
        )
        SleepConsentBannerHost(
            controller = idleConsentController,
            wsConnection = activeWsConnection,
            coroutineScope = coroutineScope
        )


        // 2. Single Top Panel-Navigation Row (Docked, horizontally scrollable, auto-revealing)
        PanelNavigationRow(
            activePanel = navState.activePanel,
            onSelectPanel = { panel ->
                navigation.navigateTo(panel)
            }
        )

        // 3. Single Content Area Host
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(DamHopperColors.Background)
        ) {
            when {
                navState.showProfileList && profileRepository != null -> {
                    ProfileListScreen(
                        profiles = profiles,
                        activeProfileId = activeProfileId,
                        authStatuses = authStatuses,
                        onSelectProfile = { id ->
                            coroutineScope.launch {
                                profileRepository.selectProfile(id)
                                navigation.closeProfileList()
                            }
                        },
                        onAddProfile = { name, url, username ->
                            coroutineScope.launch {
                                profileRepository.addProfile(name, url, username)
                            }
                        },
                        onDeleteProfile = { id ->
                            coroutineScope.launch {
                                profileRepository.deleteProfile(id)
                                lifecycleCoordinator.onProfileRetired(id)
                            }
                        },
                        onOpenAuth = { id -> navigation.openAuth(id) },
                        onClose = { navigation.closeProfileList() }
                    )
                }

                navState.showTargetPicker -> {
                    ProjectTargetPickerModal(
                        projects = projects,
                        currentProject = navState.activeProject,
                        worktrees = currentWorktrees,
                        selectedWorktreePath = snapshot.target.worktreePath,
                        isLoading = isWorktreesLoading,
                        onSelectProject = { proj ->
                            navigation.selectProject(proj)
                        },
                        onSelectTarget = { proj, wtPath ->
                            if (proj == navState.activeProject) {
                                targetStore.selectTarget(
                                    profileId = activeProfileId,
                                    workspaceConfigPath = workspaceStatus?.configPath,
                                    project = proj,
                                    worktreePath = wtPath
                                )
                            }
                        },
                        onDismiss = { navigation.closeTargetPicker() }
                    )
                }

                navState.showWorkspaceSwitcher -> {
                    WorkspaceSwitcherModal(
                        status = workspaceStatus,
                        knownWorkspaces = knownWorkspaces,
                        onRequestSwitch = { path ->
                            navigation.requestWorkspaceSwitch(path)
                        },
                        onAddWorkspace = { path, name ->
                            coroutineScope.launch {
                                workspaceRepo?.let { repo ->
                                    try {
                                        repo.addKnownWorkspace(path, name, RuntimeOwnerGuard(repo.apiClient.connection))
                                    } catch (e: kotlinx.coroutines.CancellationException) {
                                        throw e
                                    } catch (_: Exception) {
                                    }
                                }
                                val kw = workspaceRepo?.listKnownWorkspaces()
                                knownWorkspaces = kw?.workspaces ?: emptyList()
                            }
                        },
                        onDismiss = { navigation.closeWorkspaceSwitcher() }
                    )
                }

                else -> {
                    PanelHost(
                        activePanel = navState.activePanel,
                        terminalContent = {
                            TerminalPanelScreen(
                                sessions = terminalSessions,
                                activeSessionId = activeTerminalSessionId,
                                controller = activeTerminalController,
                                onSelectSession = select@{ id ->
                                    val repo = terminalRepo ?: return@select
                                    selectTerminalSession(id)
                                    val session = terminalSessions.find { it.id == id }
                                    scheduleTerminalAttach(getOrCreateController(id, session?.incarnation?.toLong() ?: 0L, repo), repo)
                                },
                                onCreateSession = create@{ cmd, name ->
                                    val repo = terminalRepo ?: return@create
                                    val owner = repo.apiClient.connection
                                    val project = navState.activeProject
                                    val epoch = terminalSelectionEpoch
                                    val worktreePath = snapshot.target.worktreePath
                                    val newId = "term-${sessionCounter++}"
                                    coroutineScope.launch {
                                        try {
                                            repo.createSession(
                                                CreateSessionRequest(
                                                    id = newId,
                                                    command = cmd,
                                                    name = name,
                                                    project = project.takeIf { it != "Default Workspace" },
                                                    worktreePath = worktreePath,
                                                )
                                            )
                                            if (terminalRepo !== repo || repo.apiClient.connection != owner ||
                                                navState.activeProject != project || terminalSelectionEpoch != epoch
                                            ) return@launch
                                            val detailed = repo.listDetailed()
                                            if (terminalRepo !== repo || repo.apiClient.connection != owner ||
                                                navState.activeProject != project || terminalSelectionEpoch != epoch
                                            ) return@launch
                                            terminalSessions = detailed
                                            selectTerminalSession(newId)
                                            val incarnation = detailed.find { it.id == newId }?.incarnation?.toLong() ?: 0L
                                            scheduleTerminalAttach(getOrCreateController(newId, incarnation, repo), repo)
                                        } catch (e: kotlinx.coroutines.CancellationException) {
                                            throw e
                                        } catch (_: Exception) {}
                                    }
                                },
                                onRenameSession = { id, newName ->
                                    coroutineScope.launch {
                                        try {
                                            terminalRepo?.renameSession(id, newName)
                                            terminalSessions = terminalRepo?.listDetailed() ?: emptyList()
                                        } catch (_: Exception) {}
                                    }
                                },
                                onKillSession = { id ->
                                    coroutineScope.launch {
                                        try {
                                            terminalRepo?.killSession(id)
                                            terminalSessions = terminalRepo?.listDetailed() ?: emptyList()
                                        } catch (_: Exception) {}
                                    }
                                },
                                onRemoveSession = remove@{ id ->
                                    val repo = terminalRepo ?: return@remove
                                    val owner = repo.apiClient.connection
                                    val project = navState.activeProject
                                    val epoch = terminalSelectionEpoch
                                    coroutineScope.launch {
                                        try {
                                            repo.removeSession(id)
                                            if (terminalRepo !== repo || repo.apiClient.connection != owner ||
                                                navState.activeProject != project
                                            ) return@launch
                                            terminalControllers.remove("${owner.profileId}:$id")?.let { controller ->
                                                terminalAttachQueues.remove(controller)
                                                terminalAttachTokens.remove(controller)
                                                controller.close()
                                            }
                                            val detailed = repo.listDetailed()
                                            if (terminalRepo !== repo || repo.apiClient.connection != owner ||
                                                navState.activeProject != project
                                            ) return@launch
                                            terminalSessions = detailed
                                            if (activeTerminalSessionId == id && terminalSelectionEpoch == epoch) {
                                                val next = detailed.firstOrNull()
                                                selectTerminalSession(next?.id)
                                                if (next != null) {
                                                    scheduleTerminalAttach(getOrCreateController(next.id, next.incarnation.toLong(), repo), repo)
                                                }
                                            }
                                        } catch (e: kotlinx.coroutines.CancellationException) {
                                            throw e
                                        } catch (_: Exception) {}
                                    }
                                },
                                fontSize = workbenchPreferences.terminalFontSize
                            )
                        },
                        filesContent = {
                            if (fileTreeState != null && fileMutationCoordinator != null) {
                                FilesPanelScreen(
                                    treeState = fileTreeState!!,
                                    mutationCoordinator = fileMutationCoordinator!!,
                                    searchRepo = searchRepo,
                                    replaceCoordinator = replaceCoordinator,
                                    bindings = federatedBindings,
                                    onOpenFile = { target, path ->
                                        coroutineScope.launch {
                                            editorTabsState?.openTab(target, path)
                                        }
                                        navigation.navigateTo(WorkbenchPanel.EDITOR)
                                    }
                                )
                            }
                        },
                        editorContent = {
                            if (editorTabsState != null) {
                                // EditorPanelScreen(tabsState = editorTabsState!!)
                                EditorPanelScreen(
                                    tabsState = editorTabsState!!,
                                    blameRepo = blameRepo,
                                    onInspectCommit = { hash ->
                                        val proj = navState.activeProject.takeIf { it != "Default Workspace" } ?: ""
                                        val activePath = editorTabsState?.activeTab?.path
                                        if (proj.isNotBlank() && !activePath.isNullOrBlank()) {
                                            diffController?.loadDiff(
                                                project = proj,
                                                target = snapshot.target,
                                                path = activePath,
                                                commitHash = hash
                                            )
                                            navigation.navigateTo(WorkbenchPanel.DIFF)
                                        }
                                    },
                                    fontSize = workbenchPreferences.editorFontSize
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.EDITOR)
                            }
                        },
                        diffContent = {
                            if (diffController != null) {
                                // DiffReviewScreen(controller = diffController!!)
                                DiffReviewScreen(
                                    controller = diffController!!,
                                    onSaveModified = {
                                        fileRepo?.let { repo -> coroutineScope.launch { diffController?.saveModified(repo) } }
                                    }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.DIFF)
                            }
                        },
                        mergeContent = {
                            if (mergeController != null) {
                                MergeConflictScreen(
                                    controller = mergeController!!,
                                    onResolved = {
                                        val rem = mergeController?.conflictFiles?.value ?: emptyList()
                                        if (rem.size <= 1) {
                                            navigation.navigateTo(WorkbenchPanel.TERMINAL)
                                        }
                                    }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.MERGE)
                            }
                        },
                        agentsContent = {
                            val sCtrl = agentStoreController
                            val mCtrl = agentMemoryController
                            val iCtrl = agentImportController
                            if (sCtrl != null && mCtrl != null && iCtrl != null) {
                                AgentsUnifiedPanelScreen(
                                    storeController = sCtrl,
                                    memoryController = mCtrl,
                                    importController = iCtrl,
                                    agentReducer = agentReducer,
                                    availableProjects = projects.map { it.name },
                                    onJumpToTerminalSession = jump@{ termId, incarnation ->
                                        val repo = terminalRepo ?: return@jump
                                        selectTerminalSession(termId)
                                        scheduleTerminalAttach(getOrCreateController(termId, incarnation.toLong(), repo), repo)
                                        navigation.navigateTo(WorkbenchPanel.TERMINAL)
                                    },
                                    onRefreshObservation = {
                                        coroutineScope.launch {
                                            terminalRepo?.apiClient?.connection?.let { onAgentStatusRefresh(it) }
                                        }
                                    },
                                    onInstallOmp = {
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.installOmpExtension(guard = guard) } }
                                    },
                                    onUninstallOmp = {
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.uninstallOmpExtension(guard = guard) } }
                                    },
                                    onInstallNative = { agent ->
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.installNativeIntegration(agent, guard = guard) } }
                                    },
                                    onUninstallNative = { agent ->
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.uninstallNativeIntegration(agent, guard = guard) } }
                                    },
                                    onActiveSubProductChanged = { agentsActiveSubProduct = it }
                                )
                            } else if (agentReducer != null) {
                                AgentsPanelScreen(
                                    reducer = agentReducer!!,
                                    onJumpToTerminalSession = jump@{ termId, incarnation ->
                                        val repo = terminalRepo ?: return@jump
                                        selectTerminalSession(termId)
                                        scheduleTerminalAttach(getOrCreateController(termId, incarnation.toLong(), repo), repo)
                                        navigation.navigateTo(WorkbenchPanel.TERMINAL)
                                    },
                                    onRefresh = {
                                        coroutineScope.launch {
                                            terminalRepo?.apiClient?.connection?.let { onAgentStatusRefresh(it) }
                                        }
                                    },
                                    onInstallOmp = {
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.installOmpExtension(guard = guard) } }
                                    },
                                    onUninstallOmp = {
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.uninstallOmpExtension(guard = guard) } }
                                    },
                                    onInstallNative = { agent ->
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.installNativeIntegration(agent, guard = guard) } }
                                    },
                                    onUninstallNative = { agent ->
                                        coroutineScope.launch { runAgentMutation { repo, guard -> repo.uninstallNativeIntegration(agent, guard = guard) } }
                                    }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.AGENTS)
                            }
                        },
                        gitContent = {
                            if (gitHistoryController != null && gitChangesController != null &&
                                gitBranchController != null && gitWorktreeController != null &&
                                gitRewriteController != null && gitActionController != null &&
                                leasedPublishController != null && gitSyncController != null
                            ) {
                                GitPanelScreen(
                                    historyController = gitHistoryController!!,
                                    changesController = gitChangesController!!,
                                    branchController = gitBranchController!!,
                                    worktreeController = gitWorktreeController!!,
                                    rewriteController = gitRewriteController!!,
                                    actionController = gitActionController!!,
                                    leasedController = leasedPublishController!!,
                                    syncController = gitSyncController!!,
                                    onOpenFileDiff = { path ->
                                        val proj = navState.activeProject.takeIf { it != "Default Workspace" } ?: ""
                                        if (proj.isNotBlank()) {
                                            diffController?.loadDiff(
                                                project = proj,
                                                target = snapshot.target,
                                                path = path,
                                                commitHash = null
                                            )
                                            navigation.navigateTo(WorkbenchPanel.DIFF)
                                        }
                                    },
                                    onMutationSuccess = {
                                        val client = activeApiClient
                                        if (client != null) {
                                            coroutineScope.launch {
                                                blameCache.advanceTargetEpoch(client.connection, snapshot.target)
                                            }
                                        }
                                        gitChangesController?.refreshChanges()
                                        gitBranchController?.refreshBranches()
                                        val activePath = editorTabsState?.activeTab?.path ?: ""
                                        if (activePath.isNotBlank()) {
                                            diffController?.loadDiff(navState.activeProject, snapshot.target, activePath)
                                        }
                                    }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.GIT)
                            }
                        },
                        workflowContent = {
                            if (workflowController != null && projectPlansController != null) {
                                WorkflowPanelScreen(
                                    workflowController = workflowController!!,
                                    projectPlansController = projectPlansController!!,
                                    onActiveProductChanged = { workflowActiveSubProduct = it }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.WORKFLOW)
                            }
                        },
                        resourcesContent = {
                            val hCtrl = hostResourceController
                            val uCtrl = usageController
                            if (hCtrl != null && uCtrl != null) {
                                ResourcesUnifiedPanelScreen(
                                    hostController = hCtrl,
                                    usageController = uCtrl,
                                    onActiveSubProductChanged = { resourcesActiveSubProduct = it }
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.RESOURCES)
                            }
                        },
                        portsContent = {
                            val p = portRepo
                            val t = tunnelRepo
                            if (p != null && t != null) {
                                PortsPanelScreen(
                                    portRepository = p,
                                    tunnelRepository = t
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.PORTS)
                            }
                        },
                        sshHostContent = {
                            val ic = idleConsentController
                            val s = sshRepo
                            val hc = hostControlRepo
                            val d = diagnosticsRepo
                            if (ic != null && s != null && hc != null && d != null) {
                                HostControlScreens(
                                    idleConsentController = ic,
                                    sshRepository = s,
                                    hostControlRepository = hc,
                                    diagnosticsRepository = d
                                )
                            } else {
                                GenericPanelPlaceholder(WorkbenchPanel.SSH_HOST)
                            }
                        },
                        settingsContent = {
                            // Invariant: state.activePanel == WorkbenchPanel.SETTINGS provides ProfileListScreen under SETTINGS
                            SettingsScreens(
                                settingsRepository = settingsRepository,
                                privacyController = privacyController,
                                services = settingsServices,
                                // Dirty documents block a destructive reset instead of being discarded.
                                departureGuard = { editorTabsState?.tabs?.value?.none { it.isDirty } ?: true },
                                diagnosticsInput = diagnosticsInput,
                                onTargetRevalidated = {},
                                onResetConfirmed = { id ->
                                    // Only a confirmed reset of the still-current server returns to workspace selection.
                                    if (id == activeProfileId) navigation.openWorkspaceSwitcher()
                                },
                                availableProfiles = profiles,
                                activeProfileId = activeProfileId,
                                profileRepository = profileRepository,
                                authStatuses = authStatuses,
                                onNavigateBack = { navigation.navigateTo(WorkbenchPanel.TERMINAL) },
                                onOpenAuth = { id -> navigation.openAuth(id) },
                            )
                        }
                    )
                }
            }
        }
    }
    }
    }

    // Modal dialogs and flows
    navState.pendingWorkspaceSwitchPath?.let { targetPath ->
        WorkspaceSwitchWarningDialog(
            targetPath = targetPath,
            onConfirm = {
                if (isSwitchingWorkspace) return@WorkspaceSwitchWarningDialog
                isSwitchingWorkspace = true
                coroutineScope.launch {
                    try {
                        // Immediately bump workspace revision and invalidate cache to fence against in-flight requests
                        targetStore.invalidateWorkspace(activeProfileId, targetPath)
                        // Clear stale worktree and project state immediately
                        currentWorktrees = emptyList()
                        projects = emptyList()
                        val repo = workspaceRepo
                        if (repo != null) {
                            val ok = repo.switchWorkspace(targetPath)
                            if (ok) {
                                workspaceStatus = repo.getWorkspaceStatus()
                                val projs = repo.listProjects()
                                projects = projs
                                if (projs.isNotEmpty()) {
                                    navigation.selectProject(projs.first().name)
                                }
                            }
                        }
                    } catch (_: Exception) {
                    } finally {
                        isSwitchingWorkspace = false
                        navigation.clearWorkspaceSwitchRequest()
                        navigation.closeWorkspaceSwitcher()
                    }
                }
            },
            onCancel = {
                navigation.clearWorkspaceSwitchRequest()
            }
        )
    }

    navState.authProfileId?.let { pId ->
        if (profileRepository != null) {
            WorkbenchAuthFlow(
                profileId = pId,
                profiles = profiles,
                authStatuses = authStatuses,
                profileRepository = profileRepository,
                coroutineScope = coroutineScope,
                onDismiss = { navigation.closeAuth() }
            )
        }
    }
}

@Composable
private fun SleepConsentBannerHost(
    controller: IdleConsentController?,
    wsConnection: dev.damhopper.nativeapp.core.transport.WsConnection?,
    coroutineScope: kotlinx.coroutines.CoroutineScope
) {
    if (controller == null) return
    val pendingConsent by controller.pendingConsent.collectAsState()
    val liveReceipt by (wsConnection?.currentReceipt?.collectAsState() ?: remember { mutableStateOf(null) })
    val isSubmittingConsent by controller.isSubmittingDecision.collectAsState()

    pendingConsent?.let { consent ->
        WorkbenchSleepConsentBanner(
            consent = consent,
            hasLiveReceipt = liveReceipt != null,
            isSubmitting = isSubmittingConsent,
            onDecision = { decision ->
                coroutineScope.launch {
                    // Runtime-only consent: an explicit guard for exactly this controller's owner, never the Settings target.
                    controller.submitConsent(decision, RuntimeOwnerGuard(controller.connection))
                }
            }
        )
    }
}

/**
 * Explicit single-use admission for RUNTIME (non-Settings) mutations of this dormant shell: bound to exactly one
 * [ConnectionRef] and admitted only inside the registry's `admitCurrentOwner` commit, so a pending/failed
 * retirement or a replaced owner is rejected (NotSubmitted) and a Settings target is never consulted.
 */
internal class RuntimeOwnerGuard(private val owner: ConnectionRef) : RequestAdmissionGuard {
    private val state = kotlinx.coroutines.flow.MutableStateFlow(dev.damhopper.nativeapp.core.transport.RequestAdmissionState.PENDING)
    override val admission: kotlinx.coroutines.flow.StateFlow<dev.damhopper.nativeapp.core.transport.RequestAdmissionState> =
        state

    override suspend fun admit(
        registry: dev.damhopper.nativeapp.core.ownership.ConnectionRegistry?,
        connection: ConnectionRef,
    ): Boolean {
        val pending = dev.damhopper.nativeapp.core.transport.RequestAdmissionState.PENDING
        val rejected = dev.damhopper.nativeapp.core.transport.RequestAdmissionState.REJECTED
        val admittedState = dev.damhopper.nativeapp.core.transport.RequestAdmissionState.ADMITTED
        if (registry == null || connection != owner) {
            state.compareAndSet(pending, rejected)
            return false
        }
        var committed = false
        val admitted = registry.admitCurrentOwner(connection) {
            committed = state.compareAndSet(pending, admittedState)
            committed
        }
        if (!admitted || !committed) {
            state.compareAndSet(pending, rejected)
            return false
        }
        return true
    }
}
