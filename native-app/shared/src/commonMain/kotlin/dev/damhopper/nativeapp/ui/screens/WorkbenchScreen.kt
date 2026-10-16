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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.AgentStatusReducer
import dev.damhopper.nativeapp.features.terminal.AgentsPanelScreen
import dev.damhopper.nativeapp.features.terminal.CreateSessionRequest
import dev.damhopper.nativeapp.features.terminal.TerminalPanelScreen
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.TerminalSessionController
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
import dev.damhopper.nativeapp.features.editor.EditorPanelScreen
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorTabsState
import dev.damhopper.nativeapp.features.editor.BlameCache
import dev.damhopper.nativeapp.features.editor.BlameRepository
import dev.damhopper.nativeapp.features.git.DiffReviewController
import dev.damhopper.nativeapp.features.git.DiffReviewScreen
import dev.damhopper.nativeapp.features.git.MergeConflictController
import dev.damhopper.nativeapp.features.git.MergeConflictScreen
import dev.damhopper.nativeapp.ui.components.GenericPanelPlaceholder

@Composable
fun WorkbenchScreen(
    initialState: WorkbenchState = WorkbenchState(),
    profileRepository: ProfileRepository? = null,
    targetStore: ProjectTargetStore = remember { ProjectTargetStore() },
    navigation: WorkbenchNavigation = remember { WorkbenchNavigation() },
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
    var configEditor by remember { mutableStateOf<RemoteConfigEditor?>(null) }
    var terminalRepo by remember { mutableStateOf<TerminalRepository?>(null) }
    var agentReducer by remember { mutableStateOf<AgentStatusReducer?>(null) }
    val cryptoSessionManager = remember { dev.damhopper.nativeapp.core.security.CryptoSessionManager() }
    val terminalControllers = remember { mutableMapOf<String, TerminalSessionController>() }
    var terminalSessions by remember { mutableStateOf<List<TerminalSessionDetailed>>(emptyList()) }
    var activeTerminalSessionId by remember { mutableStateOf<String?>(null) }
    var sessionCounter by remember { mutableStateOf(1) }
    var settingsTab by remember { mutableStateOf(0) } // 0: Profiles, 1: Remote Config
    var activeApiClient by remember { mutableStateOf<ApiClient?>(null) }
    var fileRepo by remember { mutableStateOf<FileRepository?>(null) }
    var fileTreeState by remember { mutableStateOf<FileTreeState?>(null) }
    var fileMutationCoordinator by remember { mutableStateOf<FileMutationCoordinator?>(null) }
    var federatedBindings by remember { mutableStateOf<List<ProfileTargetBinding>>(emptyList()) }
    var federatedRepos by remember { mutableStateOf<Map<String, FileRepository>>(emptyMap()) }
    var editorTabsState by remember { mutableStateOf<EditorTabsState?>(null) }
    var editorRepo by remember { mutableStateOf<EditorRepository?>(null) }
    var diffController by remember { mutableStateOf<DiffReviewController?>(null) }
    var mergeController by remember { mutableStateOf<MergeConflictController?>(null) }
    val blameCache = remember { BlameCache() }
    var blameRepo by remember { mutableStateOf<BlameRepository?>(null) }
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
        terminalSessions = emptyList()
        activeTerminalSessionId = null
        cryptoSessionManager.closeAll()

        if (profileRepository != null && activeProfileId != null) {
            try {
                val client = profileRepository.getOrCreateApiClient(activeProfileId!!)
                val wRepo = WorkspaceRepository(client, targetStore)
                val cRepo = RemoteConfigRepository(client)
                val cEditor = RemoteConfigEditor(cRepo)
                val ws = try { profileRepository.getOrCreateWsConnection(activeProfileId!!) } catch (_: Exception) { null }
                val tRepo = TerminalRepository(client, ws)
                val aReducer = AgentStatusReducer(tRepo)
                workspaceRepo = wRepo
                configEditor = cEditor
                terminalRepo = tRepo
                activeApiClient = client
                agentReducer = aReducer
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
                coroutineScope.launch {
                    try { ws?.connect() } catch (_: Exception) {}
                }
                val status = try { wRepo.getWorkspaceStatus() } catch (_: Exception) { null }
                workspaceStatus = status
                val projs = try { wRepo.listProjects() } catch (_: Exception) { emptyList() }
                projects = projs

                if (projs.isNotEmpty() && (navState.activeProject == "Default Workspace" || projs.none { it.name == navState.activeProject })) {
                    navigation.selectProject(projs.first().name)
                }

                val kw = try { wRepo.listKnownWorkspaces() } catch (_: Exception) { null }
                knownWorkspaces = kw?.workspaces ?: emptyList()

                try { cEditor.load() } catch (_: Exception) {}
            } catch (_: Exception) {}
        } else {
            workspaceRepo = null
            configEditor = null
            terminalRepo = null
            agentReducer = null
            workspaceStatus = null
            projects = emptyList()
            currentWorktrees = emptyList()
            knownWorkspaces = emptyList()
            terminalSessions = emptyList()
            activeTerminalSessionId = null
            terminalControllers.values.forEach { it.close() }
            terminalControllers.clear()
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
    // Refresh terminal sessions and agent status when active project changes or targetStore updates
    // Retain or create controller helper ensuring controller exists before attaching
    fun getOrCreateController(id: String, incarnation: Long = 0L): TerminalSessionController {
        val profileKey = activeProfileId ?: "none"
        val compositeKey = "$profileKey:$id"
        return terminalControllers.getOrPut(compositeKey) {
            val session = terminalSessions.find { it.id == id }
            val effectiveIncarnation = if (incarnation != 0L) incarnation else (session?.incarnation?.toLong() ?: 0L)
            val connRef = terminalRepo?.apiClient?.connection
                ?: dev.damhopper.nativeapp.core.model.ConnectionRef(activeProfileId ?: "default", 1L)
            val ctrl = TerminalSessionController(
                sessionId = id,
                initialIncarnation = effectiveIncarnation,
                connectionRef = connRef,
                terminalRepository = terminalRepo
            )
            ctrl.setRawInputSink { bytes ->
                coroutineScope.launch {
                    terminalRepo?.writeTerminal(id, bytes.decodeToString())
                }
            }
            ctrl.onRequestReattach = { sId, offset ->
                coroutineScope.launch {
                    terminalRepo?.attachTerminal(sId, offset)
                }
            }
            ctrl.isPanelActive = (id == activeTerminalSessionId && navState.activePanel == WorkbenchPanel.TERMINAL)
            ctrl
        }
    }

    // Refresh terminal sessions and agent status when active project changes or targetStore updates
    LaunchedEffect(currentActiveProj, terminalRepo) {
        val repo = terminalRepo ?: return@LaunchedEffect
        try {
            val detailed = repo.listDetailed()
            terminalSessions = detailed
            if (detailed.isNotEmpty() && (activeTerminalSessionId == null || detailed.none { it.id == activeTerminalSessionId })) {
                val first = detailed.first().id
                activeTerminalSessionId = first
                getOrCreateController(first, detailed.first().incarnation.toLong())
                try { repo.attachTerminal(first) } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        try {
            agentReducer?.reloadSnapshot()
        } catch (_: Exception) {}
    }

    // Listen to WebSocket events from TerminalRepository
    LaunchedEffect(terminalRepo) {
        val repo = terminalRepo ?: return@LaunchedEffect
        launch {
            repo.terminalOutput.collect { msg ->
                getOrCreateController(msg.id, msg.incarnation.toLong()).handleLiveChunk(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.incarnation
                )
            }
        }
        launch {
            repo.terminalBuffer.collect { msg ->
                getOrCreateController(msg.id, msg.incarnation.toLong()).handleBufferReplay(
                    msg.data.encodeToByteArray(),
                    msg.offset,
                    msg.reset,
                    msg.truncated,
                    msg.incarnation
                )
            }
        }
        launch {
            repo.terminalExit.collect { msg ->
                getOrCreateController(msg.id, msg.incarnation?.toLong() ?: 0L).handleExit(
                    msg.exitCode,
                    msg.willRestart,
                    msg.restartCount,
                    msg.incarnation
                )
            }
        }
        launch {
            repo.terminalLagged.collect { msg ->
                activeTerminalSessionId?.let { id ->
                    terminalControllers[id]?.handleLagged(msg.dropped)
                }
            }
        }
        launch {
            repo.processRestarted.collect { msg ->
                getOrCreateController(msg.id).handleProcessRestarted(
                    msg.restartCount,
                    msg.previousExitCode
                )
            }
        }
        launch {
            repo.agentStatusChanged.collect { msg ->
                agentReducer?.applyStatusChanged(msg)
            }
        }
        launch {
            repo.agentStatusRemoved.collect { msg ->
                agentReducer?.applyStatusRemoved(msg)
            }
        }
        launch {
            repo.agentStatusInvalidated.collect { msg ->
                agentReducer?.applyStatusInvalidated(msg)
            }
        }
    }

    val activeTerminalController = activeTerminalSessionId?.let { id ->
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

    Column(
        modifier = modifier
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
                            profileRepository.selectProfile(id)
                            navigation.closeProfileList()
                        },
                        onAddProfile = { name, url, username ->
                            coroutineScope.launch {
                                profileRepository.addProfile(name, url, username)
                            }
                        },
                        onDeleteProfile = { id ->
                            coroutineScope.launch {
                                profileRepository.deleteProfile(id)
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
                                workspaceRepo?.addKnownWorkspace(path, name)
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
                                onSelectSession = { id ->
                                    activeTerminalSessionId = id
                                    val session = terminalSessions.find { it.id == id }
                                    getOrCreateController(id, session?.incarnation?.toLong() ?: 0L)
                                    coroutineScope.launch {
                                        try { terminalRepo?.attachTerminal(id) } catch (_: Exception) {}
                                    }
                                },
                                onCreateSession = { cmd, name ->
                                    coroutineScope.launch {
                                        val newId = "term-${sessionCounter++}"
                                        try {
                                            terminalRepo?.createSession(
                                                CreateSessionRequest(
                                                    id = newId,
                                                    command = cmd,
                                                    name = name,
                                                    project = navState.activeProject.takeIf { it != "Default Workspace" },
                                                    worktreePath = snapshot.target.worktreePath
                                                )
                                            )
                                            val detailed = terminalRepo?.listDetailed() ?: emptyList()
                                            terminalSessions = detailed
                                            activeTerminalSessionId = newId
                                            getOrCreateController(newId, 0L)
                                            terminalRepo?.attachTerminal(newId)
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
                                onRemoveSession = { id ->
                                    coroutineScope.launch {
                                        try {
                                            terminalRepo?.removeSession(id)
                                            terminalControllers.remove("${activeProfileId ?: "none"}:$id")?.close()
                                            val detailed = terminalRepo?.listDetailed() ?: emptyList()
                                            terminalSessions = detailed
                                            if (activeTerminalSessionId == id) {
                                                val next = detailed.firstOrNull()?.id
                                                activeTerminalSessionId = next
                                                if (next != null) {
                                                    val s = detailed.firstOrNull()
                                                    getOrCreateController(next, s?.incarnation?.toLong() ?: 0L)
                                                    terminalRepo?.attachTerminal(next)
                                                }
                                            }
                                        } catch (_: Exception) {}
                                    }
                                }
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
                                    }
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
                            if (agentReducer != null) {
                                AgentsPanelScreen(
                                    reducer = agentReducer!!,
                                    onJumpToTerminalSession = { termId, incarnation ->
                                        activeTerminalSessionId = termId
                                        getOrCreateController(termId, incarnation.toLong())
                                        coroutineScope.launch {
                                            try { terminalRepo?.attachTerminal(termId) } catch (_: Exception) {}
                                        }
                                        navigation.navigateTo(WorkbenchPanel.TERMINAL)
                                    },
                                    onRefresh = {
                                        coroutineScope.launch {
                                            agentReducer?.reloadSnapshot()
                                        }
                                    },
                                    onInstallOmp = {
                                        coroutineScope.launch {
                                            try { terminalRepo?.installOmpExtension() } catch (_: Exception) {}
                                            agentReducer?.reloadSnapshot()
                                        }
                                    },
                                    onUninstallOmp = {
                                        coroutineScope.launch {
                                            try { terminalRepo?.uninstallOmpExtension() } catch (_: Exception) {}
                                            agentReducer?.reloadSnapshot()
                                        }
                                    },
                                    onInstallNative = { agent ->
                                        coroutineScope.launch {
                                            try { terminalRepo?.installNativeIntegration(agent) } catch (_: Exception) {}
                                            agentReducer?.reloadSnapshot()
                                        }
                                    },
                                    onUninstallNative = { agent ->
                                        coroutineScope.launch {
                                            try { terminalRepo?.uninstallNativeIntegration(agent) } catch (_: Exception) {}
                                            agentReducer?.reloadSnapshot()
                                        }
                                    }
                                )
                            }
                        },
                        settingsContent = {
                            Column(modifier = Modifier.fillMaxSize()) {
                                // Settings subtabs
                                val tabs = listOf("Server Profiles", "Remote Configuration")
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(DamHopperColors.SurfaceVariant)
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    tabs.forEachIndexed { index, title ->
                                        val isSelected = settingsTab == index
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(4.dp))
                                                .background(if (isSelected) DamHopperColors.Accent else DamHopperColors.Surface)
                                                .clickable { settingsTab = index }
                                                .padding(horizontal = 12.dp, vertical = 6.dp)
                                        ) {
                                            Text(
                                                text = title,
                                                color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                        }
                                    }
                                }
                                // Invariant: state.activePanel == WorkbenchPanel.SETTINGS provides ProfileListScreen under SETTINGS

                                if (settingsTab == 0 && profileRepository != null) {
                                    ProfileListScreen(
                                        profiles = profiles,
                                        activeProfileId = activeProfileId,
                                        authStatuses = authStatuses,
                                        onSelectProfile = { id -> profileRepository.selectProfile(id) },
                                        onAddProfile = { name, url, username ->
                                            coroutineScope.launch {
                                                profileRepository.addProfile(name, url, username)
                                            }
                                        },
                                        onDeleteProfile = { id ->
                                            coroutineScope.launch {
                                                profileRepository.deleteProfile(id)
                                            }
                                        },
                                        onOpenAuth = { id -> navigation.openAuth(id) },
                                        onClose = { navigation.navigateTo(WorkbenchPanel.TERMINAL) }
                                    )
                                } else if (settingsTab == 1 && configEditor != null) {
                                    RemoteConfigScreen(editor = configEditor!!)
                                }
                            }
                        }
                    )
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
