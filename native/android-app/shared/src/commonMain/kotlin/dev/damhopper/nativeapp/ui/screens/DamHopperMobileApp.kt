package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import dev.damhopper.nativeapp.core.model.FilesystemTargetRef
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.damhopper.nativeapp.features.workspace.AgentHubActionPort
import dev.damhopper.nativeapp.features.workspace.AgentHubSnapshotPort
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.notifications.NotificationFeedState
import dev.damhopper.nativeapp.core.notifications.NotificationRecord
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.editor.EditorZoom
import dev.damhopper.nativeapp.features.editor.LocalEditorFontSize
import dev.damhopper.nativeapp.features.editor.LocalEditorZoom
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.files.SearchRepository
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.settings.HardwareShortcutRegistry
import dev.damhopper.nativeapp.features.settings.SettingsDiagnosticsInput
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.features.settings.SettingsRepository
import dev.damhopper.nativeapp.features.settings.SettingsScreenServices
import dev.damhopper.nativeapp.features.settings.SettingsScreens
import dev.damhopper.nativeapp.features.settings.SettingsSubSection
import dev.damhopper.nativeapp.features.settings.ShortcutAction
import dev.damhopper.nativeapp.features.settings.ShortcutGate
import dev.damhopper.nativeapp.features.settings.ShortcutGrammar
import dev.damhopper.nativeapp.features.settings.ShortcutOutcome
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.features.settings.toShortcutInput
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.terminal.stepTerminalFontSize
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.git.GitHostPorts
import dev.damhopper.nativeapp.features.git.GitWorkspaceRuntime
import dev.damhopper.nativeapp.features.git.GitRepository
import dev.damhopper.nativeapp.features.git.WorkspaceGitSafety
import dev.damhopper.nativeapp.features.workspace.WorkspaceDepartureIntent
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.features.workspace.WorkspacePanel
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.ui.flow.targetServicesReady
import androidx.compose.runtime.rememberUpdatedState
import dev.damhopper.nativeapp.features.settings.HostSettingsSection
import dev.damhopper.nativeapp.features.terminal.RetainedTerminalAgentsService
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsRefreshReason
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsMembership
import dev.damhopper.nativeapp.ui.components.TerminalAgentsContext
import dev.damhopper.nativeapp.ui.components.TerminalAgentsSidebarHost
import dev.damhopper.nativeapp.ui.components.TerminalAgentsHostState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.Saver
import dev.damhopper.nativeapp.ui.components.CognitoOverlay
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.flow.SettingsOrigin
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.NativeTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import kotlin.time.TimeSource

/**
 * Everything the active root consumes from the retained owner (the Android ViewModel implements it). The root never
 * constructs Settings, notification or history services itself, so they survive rotation and route changes and
 * exist exactly once per process-retained owner.
 */
interface RetainedRootServices : AgentHubSnapshotPort, AgentHubActionPort {
    val settingsRepository: SettingsRepository
    val privacyController: PrivacyController
    val settingsScreenServices: StateFlow<SettingsScreenServices>
    val notificationFeed: StateFlow<NotificationFeedState>

    /** Explicit text of the last refused notification click (never a silent no-op, never a stale activation). */
    val routeNotice: StateFlow<String?>
    val commandHistory: ObservableCommandHistory
    val shortcutRegistry: HardwareShortcutRegistry

    fun markNotificationRead(key: String)
    fun markAllNotificationsRead()
    fun clearNotifications()
    fun dismissTransient(key: String)
    fun dismissRouteNotice()

    /** Validates [target] against authoritative live state and routes it; null when routed, else the refusal text. */
    suspend fun openNotification(target: NotificationTarget): String?
    suspend fun activateNotification(key: String): String?

    /** Hands the root's EXISTING socket to the retained owner (one collector per runtime; no new connection). */
    suspend fun attachRuntime(client: ApiClient, ws: WsConnection, accountId: String)

    fun diagnosticsInput(): SettingsDiagnosticsInput
    fun onTargetRevalidated(profileId: String)

    /** The ONE retained Agents roster service of the retained owner (inventory, activation, filter). */
    val terminalAgents: RetainedTerminalAgentsService

    /** Refreshes every attached connected runtime's roster inventory (sidebar open, retry); never connects. */
    fun refreshTerminalAgents(reason: TerminalAgentsRefreshReason)

    fun gitHostPorts(owner: WorkspaceFileOwner): GitHostPorts
}

/**
 * Root Mobile Entry Application Composable.
 *
 * Implements the guided linear mobile flow:
 * [AppFlowStage.PROFILE_LOGIN] -> [AppFlowStage.PROJECT_LIST] -> [AppFlowStage.TERMINAL]
 * with Settings as a RETAINED OVERLAY above the current stage (never a second navigation system).
 *
 * Invariants:
 * 1. Profile change clears active project and terminal session in [AppFlowNavigation].
 * 2. Unauthenticated state gracefully redirects to [AppFlowStage.PROFILE_LOGIN].
 * 3. Terminal output and input route strictly through [ProjectTerminalScreen] and [TerminalSessionController].
 * 4. Navigating back from Terminal deactivates input without killing remote PTY sessions.
 * 5. Zero WebView and zero floating action buttons across all hosted screens.
 * 6. Opening Settings keeps the workspace composed and retained (dirty documents, undo, sidebar, PTYs); only widget
 *    input is suspended. Back returns to the captured origin.
 * 7. Every persisted preference is read from ONE collected flow ([RetainedRootServices.settingsRepository]); no
 *    consumer owns a snapshot copy.
 */
@Composable
fun DamHopperMobileApp(
    profileRepository: ProfileRepository,
    targetStore: ProjectTargetStore = remember { ProjectTargetStore() },
    navigation: AppFlowNavigation = remember { AppFlowNavigation() },
    services: RetainedRootServices? = null,
    lifecycleCoordinator: LifecycleCoordinator = remember { LifecycleCoordinator() },
    workspaceStateProvider: ((WorkspaceFileOwner, ProjectTargetRef, ApiClient, WsConnection) -> ProjectWorkspaceState)? = null,
    modifier: Modifier = Modifier,
) {
    val settingsRepository = services?.settingsRepository
    val fallbackPrefs = remember { MutableStateFlow(WorkbenchPreferences()) }
    val prefsFlow: StateFlow<WorkbenchPreferences> = settingsRepository?.preferences ?: fallbackPrefs
    val prefs by prefsFlow.collectAsState()
    val prefAccess = remember(settingsRepository) {
        if (settingsRepository != null) {
            PreferenceAccess(settingsRepository.preferences, settingsRepository::updatePreferences, settingsRepository::setExplorerLanguageFilter)
        } else {
            PreferenceAccess(fallbackPrefs, { transform -> fallbackPrefs.value = transform(fallbackPrefs.value) })
        }
    }

    val editorZoom = remember(prefs.editorZoomWheelEnabled, prefs.editorFontSize, prefAccess) {
        EditorZoom(
            enabled = prefs.editorZoomWheelEnabled,
            fontSize = prefs.editorFontSize,
            onFontSize = { size -> prefAccess.update { it.copy(editorFontSize = WorkbenchPreferences.clampFont(size)) } },
        )
    }
    NativeTheme(theme = prefs.theme, systemFontSize = prefs.systemFontSize) {
        CompositionLocalProvider(
            LocalEditorFontSize provides prefs.editorFontSize,
            LocalEditorZoom provides editorZoom,
        ) {
            RootContent(
                profileRepository = profileRepository,
                targetStore = targetStore,
                navigation = navigation,
                services = services,
                prefs = prefs,
                prefAccess = prefAccess,
                lifecycleCoordinator = lifecycleCoordinator,
                workspaceStateProvider = workspaceStateProvider,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun RootContent(
    profileRepository: ProfileRepository,
    targetStore: ProjectTargetStore,
    navigation: AppFlowNavigation,
    services: RetainedRootServices?,
    prefs: WorkbenchPreferences,
    prefAccess: PreferenceAccess,
    lifecycleCoordinator: LifecycleCoordinator,
    workspaceStateProvider: ((WorkspaceFileOwner, ProjectTargetRef, ApiClient, WsConnection) -> ProjectWorkspaceState)?,
    modifier: Modifier,
) {
    val flowState by navigation.state.collectAsState()
    val profiles by profileRepository.profiles.collectAsState()
    val repoActiveProfileId by profileRepository.activeProfileId.collectAsState()
    val authStatuses by profileRepository.authStatuses.collectAsState()
    val scope = rememberCoroutineScope()

    // While a stage other than login is shown the flow owns the profile, so a validated cross-profile route never
    // flashes a workspace for a project of the previously selected profile.
    val activeProfileId = if (flowState.stage != AppFlowStage.PROFILE_LOGIN) {
        flowState.activeProfileId ?: repoActiveProfileId
    } else {
        repoActiveProfileId
    }
    val currentProfile = profiles.find { it.id == activeProfileId }
    val currentAuthStatus = authStatuses[activeProfileId]
    val repoAuthStatus = authStatuses[repoActiveProfileId]

    val connections by profileRepository.registry.connectionsState.collectAsState()
    val currentConn = connections[activeProfileId]

    var hasInitialAutoAdvanced by rememberSaveable { mutableStateOf(false) }

    var apiClient by remember { mutableStateOf<ApiClient?>(null) }
    var wsConnection by remember { mutableStateOf<WsConnection?>(null) }
    var workspaceRepo by remember { mutableStateOf<WorkspaceRepository?>(null) }
    var terminalRepo by remember { mutableStateOf<TerminalRepository?>(null) }

    // Reconstruct repositories when active profile, its base URL, or generation changes
    LaunchedEffect(activeProfileId, currentProfile?.baseUrl, currentConn?.generation) {
        workspaceRepo = null
        terminalRepo = null
        apiClient = null
        wsConnection = null

        val profId = activeProfileId
        if (profId != null && currentProfile != null) {
            try {
                val client = profileRepository.getOrCreateApiClient(profId)
                val ws = try {
                    profileRepository.getOrCreateWsConnection(profId)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
                apiClient = client
                wsConnection = ws
                workspaceRepo = WorkspaceRepository(client, targetStore)
                terminalRepo = TerminalRepository(client, ws, services?.settingsRepository?.preferencesStore)
                // When RetainedRootServices is available, connection lifecycle and recovery are managed
                // by WsRecoverySupervisor in attachRuntime(). Only standalone preview/tests without services connect directly.
                if (services == null && ws != null) {
                    try {
                        ws.connect()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {}
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                apiClient = null
                wsConnection = null
                workspaceRepo = null
                terminalRepo = null
            }
        }
    }

    // Hand the already-created runtime to the retained owner (one collector per runtime, no extra connection).
    val effectiveAccountUser = (currentAuthStatus as? AuthStatus.Authenticated)?.session?.user
    LaunchedEffect(apiClient, wsConnection, effectiveAccountUser, activeProfileId) {
        val client = apiClient
        val ws = wsConnection
        val user = effectiveAccountUser
        val profId = activeProfileId
        if (services != null && client != null && ws != null && user != null && profId != null &&
            client.connection.profileId == profId && ws.connection.profileId == profId
        ) {
            services.attachRuntime(client, ws, user)
            services.refreshTerminalAgents(TerminalAgentsRefreshReason.CONNECTED)
        }
    }

    // Startup session restoration: validate stored session for active profile on initial launch
    LaunchedEffect(repoActiveProfileId) {
        val profId = repoActiveProfileId ?: return@LaunchedEffect
        if (authStatuses[profId] == null) {
            try {
                profileRepository.refreshAuthStatus(profId)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Network error / offline: handled downstream
            }
        }
    }

    val selectedProj = flowState.activeProject
    val activeWorkspaceState = remember(
        activeProfileId,
        currentProfile?.baseUrl,
        effectiveAccountUser,
        currentConn,
        selectedProj,
        flowState.activeWorktreePath,
        apiClient,
        wsConnection,
    ) {
        val client = apiClient
        val ws = wsConnection
        val profId = activeProfileId
        val prof = currentProfile
        val conn = currentConn
        val accountUser = effectiveAccountUser
        if (profId != null && prof != null && client != null && ws != null && selectedProj != null &&
            conn != null && accountUser != null &&
            client.connection == conn && ws.connection == conn &&
            client.normalizedBaseUrl == WorkspaceFileOwner.normalizeBaseUrl(prof.baseUrl) &&
            ws.baseUrl.trim().trimEnd('/') == WorkspaceFileOwner.normalizeBaseUrl(prof.baseUrl)
        ) {
            val owner = WorkspaceFileOwner(
                profileId = profId,
                baseUrl = prof.baseUrl,
                accountUser = accountUser,
                project = selectedProj,
                worktreePath = flowState.activeWorktreePath,
            )
            val target = owner.toProjectTargetRef()
            if (workspaceStateProvider != null) {
                workspaceStateProvider(owner, target, client, ws)
            } else {
                val fileRepo = FileRepository(owner, client, ws)
                val editorRepo = EditorRepository(fileRepo, profileId = profId)
                val wsState = ProjectWorkspaceState.create(
                    owner = owner,
                    target = target,
                    fileRepository = fileRepo,
                    editorRepository = editorRepo,
                    lifecycleCoordinator = lifecycleCoordinator,
                    preferenceAccess = prefAccess,
                    commandHistory = services?.commandHistory,
                    historyOwner = SettingsOwner(client.connection, client.normalizedBaseUrl, accountUser),
                    preferencesStore = services?.settingsRepository?.preferencesStore,
                )
                val safety = WorkspaceGitSafety(
                    boundOwner = owner,
                    connectionGetter = { client.connection },
                    fileRepositoryGetter = { fileRepo },
                    editorRepositoryGetter = { editorRepo },
                    terminalRepositoryGetter = { dev.damhopper.nativeapp.features.terminal.TerminalRepository(client, ws, services?.settingsRepository?.preferencesStore) },
                    workspaceStateGetter = { wsState },
                    retainedDirtyDocsProvider = { requestedOwner ->
                        if (requestedOwner == owner) {
                            wsState.getDirtyDocumentIds()
                        } else {
                            emptyList()
                        }
                    },
                    targetStore = targetStore,
                    flowNavigation = navigation,
                )
                val runtime = GitWorkspaceRuntime(
                    owner = owner,
                    connection = client.connection,
                    repository = GitRepository(client),
                    presentation = wsState.gitState,
                    safety = safety,
                    coroutineScope = wsState.coroutineScope,
                )
                wsState.bindGitRuntime(runtime)
                wsState
            }
        } else null
    }

    // Retained Agents roster registration: only for a real authenticated server-returned account (never the fallback
    // display labels above) and only while the focused workspace stage is shown. Idempotent per logical owner.
    val agentsService = services?.terminalAgents
    val agentsAccount = effectiveAccountUser
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

    val agentInventories by (agentsService?.inventories ?: remember { MutableStateFlow(emptyMap()) }).collectAsState()
    val currentReceipt = activeProfileId?.let { profId -> agentInventories.values.firstOrNull { it.runtime.connection.profileId == profId } }

    LaunchedEffect(currentReceipt, agentsService, activeProfileId, currentProfile, effectiveAccountUser, currentConn) {
        val service = agentsService ?: return@LaunchedEffect
        val receipt = currentReceipt ?: return@LaunchedEffect
        val profId = activeProfileId ?: return@LaunchedEffect
        val prof = currentProfile ?: return@LaunchedEffect
        val account = effectiveAccountUser ?: return@LaunchedEffect
        val conn = currentConn ?: return@LaunchedEffect
        if (receipt.runtime.connection != conn ||
            receipt.runtime.endpoint != WorkspaceFileOwner.normalizeBaseUrl(prof.baseUrl) ||
            receipt.runtime.accountUser != account
        ) {
            return@LaunchedEffect
        }
        val projects = receipt.sessions.filter { !it.project.isNullOrBlank() }
            .map { it.project!! to it.worktreePath }
            .distinct()
        for ((project, worktreePath) in projects) {
            val owner = WorkspaceFileOwner(
                profileId = profId,
                baseUrl = prof.baseUrl,
                accountUser = account,
                project = project,
                worktreePath = worktreePath,
            )
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
        }
    }

    LaunchedEffect(flowState.activeProject, flowState.activeWorktreePath) {
        val proj = flowState.activeProject
        if (proj != null && activeProfileId != null) {
            targetStore.selectTarget(
                profileId = activeProfileId,
                workspaceConfigPath = null,
                project = proj,
                worktreePath = flowState.activeWorktreePath,
            )
        }
    }
    val agentsHost = rememberSaveable(saver = AgentsHostStateSaver) { TerminalAgentsHostState() }

    // Auto-advance or redirect based on the repository's active profile authentication
    LaunchedEffect(repoActiveProfileId, repoAuthStatus) {
        val profId = repoActiveProfileId
        val isExplicitlyUnauthenticated = repoAuthStatus is AuthStatus.LoginRequired ||
            repoAuthStatus is AuthStatus.Incompatible ||
            repoAuthStatus is AuthStatus.MfaRequired
        if (isExplicitlyUnauthenticated && flowState.stage != AppFlowStage.PROFILE_LOGIN) {
            activeWorkspaceState?.revokeAuthority()
            navigation.navigateToProfiles()
        } else if (repoAuthStatus is AuthStatus.Authenticated && profId != null) {
            if (flowState.stage == AppFlowStage.PROFILE_LOGIN) {
                hasInitialAutoAdvanced = true
                val lastNav = profileRepository.getLastNavigationState()
                if (lastNav != null && lastNav.profileId == profId && lastNav.stage == AppFlowStage.TERMINAL.name && lastNav.project != null) {
                    navigation.restoreState(
                        stage = AppFlowStage.TERMINAL,
                        profileId = profId,
                        project = lastNav.project,
                        sessionId = lastNav.sessionId,
                        worktreePath = lastNav.worktreePath
                    )
                } else {
                    navigation.onProfileAuthenticated(profId)
                }
            } else if (flowState.activeProfileId != profId) {
                navigation.onProfileAuthenticated(profId)
            }
        }
    }

    // ---- Settings overlay, privacy, notification feed ----
    val settingsOpen = flowState.settings != null
    val privacyController = services?.privacyController
    val masked by (privacyController?.isMaskActive ?: remember { MutableStateFlow(false) }).collectAsState()
    val feed by (services?.notificationFeed ?: remember { MutableStateFlow(NotificationFeedState()) }).collectAsState()
    val routeNotice by (services?.routeNotice ?: remember { MutableStateFlow<String?>(null) }).collectAsState()
    val settingsServices by (services?.settingsScreenServices ?: remember { MutableStateFlow(SettingsScreenServices()) }).collectAsState()
    val languageNotice by (services?.settingsRepository?.languageFilterMigrationNotice ?: remember { MutableStateFlow<String?>(null) }).collectAsState()
    var searchMode by remember { mutableStateOf<WorkspaceSearchMode?>(null) }
    var shortcutNotice by remember { mutableStateOf<String?>(null) }
    val hubSnapshot by (services?.hubSnapshot ?: remember { MutableStateFlow(dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot()) }).collectAsState()

    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    LaunchedEffect(settingsOpen, masked, flowState.projectPickerOpen, flowState.notificationsOpen, activeWorkspaceState) {
        val covered = settingsOpen || masked || flowState.projectPickerOpen || flowState.notificationsOpen
        activeWorkspaceState?.setInputSuspended(covered)
        if (covered) {
            keyboardController?.hide()
            focusManager.clearFocus(force = true)
        }
    }
    LaunchedEffect(activeWorkspaceState) { searchMode = null }

    // Capability -> Terminal back unwinding: when active panel is not TERMINAL, Back switches back to Terminal
    val currentPanel by (activeWorkspaceState?.activePanel ?: remember { MutableStateFlow(WorkspacePanel.TERMINAL) }).collectAsState()
    DisposableEffect(navigation, activeWorkspaceState, currentPanel) {
        val ws = activeWorkspaceState
        val unregister = if (ws != null && currentPanel != WorkspacePanel.TERMINAL) {
            navigation.registerBackInterceptor {
                ws.selectPanel(WorkspacePanel.TERMINAL)
                true
            }
        } else null
        onDispose { unregister?.invoke() }
    }

    // ONE effective cover, derived synchronously in composition from the owned sources: privacy, Settings, search,
    // project picker modal, pending departure + the host-owned local terminal modals, sidebar popup and compact Agents.
    val departurePending by remember(activeWorkspaceState) {
        activeWorkspaceState?.pendingDeparture ?: MutableStateFlow<WorkspaceDepartureIntent?>(null)
    }.collectAsState()
    val externalCover = masked || settingsOpen || searchMode != null || departurePending != null || flowState.projectPickerOpen || flowState.notificationsOpen
    SideEffect { agentsHost.setExternalCover(externalCover) }
    val effectiveCover = externalCover || agentsHost.localCover || agentsHost.popupVisible || agentsHost.compactSheetOpen
    // Search owns Back dismissal while open.
    DisposableEffect(navigation, searchMode) {
        val unregister = if (searchMode != null) {
            navigation.registerBackInterceptor {
                searchMode = null
                true
            }
        } else {
            {}
        }
        onDispose { unregister() }
    }

    // Back closes the compact sheet before any route Back, only while it is itself the topmost visible surface.
    val sheetIsTopmost = agentsHost.compactSheetOpen && !externalCover
    DisposableEffect(navigation, sheetIsTopmost) {
        val unregister = if (sheetIsTopmost) {
            navigation.registerBackInterceptor { agentsHost.closeCompactSheet() }
        } else {
            {}
        }
        onDispose { unregister() }
    }
    // The Agents host only exists on the Terminal stage: leaving it can never strand a cover without its surface.
    LaunchedEffect(flowState.stage) {
        if (flowState.stage != AppFlowStage.HUB && flowState.stage != AppFlowStage.TERMINAL && flowState.stage != AppFlowStage.PROJECT_LIST) agentsHost.close()
    }

    // Back returns to the captured origin: restore the workspace panel the user left (state itself never moved).
    var lastOrigin by remember { mutableStateOf<SettingsOrigin?>(null) }
    LaunchedEffect(flowState.settings) {
        val overlay = flowState.settings
        if (overlay != null) {
            lastOrigin = overlay.origin
        } else {
            val origin = lastOrigin
            lastOrigin = null
            if (flowState.notificationRouteActive) {
                navigation.consumeNotificationRoute()
            } else {
                val panel = origin?.panel?.let { name -> WorkspacePanel.entries.firstOrNull { it.name == name } }
                if (panel != null && origin.stage == flowState.stage) {
                    activeWorkspaceState?.selectPanel(panel)
                }
            }
        }
    }

    fun captureOrigin() = SettingsOrigin(
        stage = flowState.stage,
        panel = activeWorkspaceState?.activePanel?.value?.name,
        document = activeWorkspaceState?.editorTabsState?.activeTabKey?.value,
        sessionId = flowState.activeSessionId,
    )

    // Contextual Agents settings: the selected/current workspace server B (independent of preference source A) is
    // queued as the Settings target; the retained overlay opens the existing Host administration -> Agents section.
    val openAgentSettings: () -> Unit = {
        val target = activeProfileId
        if (services != null && target != null) {
            services.settingsRepository.setSettingsTarget(target)
            navigation.openAgentSettings(captureOrigin(), target)
        }
    }
    val latestOpenAgentSettings by rememberUpdatedState(openAgentSettings)
    val agentsContext = remember(agentsService, agentsRegistration, agentsHost, services) {
        if (agentsService != null && services != null) {
            TerminalAgentsContext(
                service = agentsService,
                registration = agentsRegistration,
                host = agentsHost,
                refreshAll = { reason -> services.refreshTerminalAgents(reason) },
                onOpenSettings = { latestOpenAgentSettings() },
            )
        } else {
            null
        }
    }

    val headerEntries = services?.let {
        HeaderEntries(
            unreadNotifications = unreadCount(feed),
            notificationsOpen = flowState.notificationsOpen,
            onOpenSettings = { navigation.openSettings(captureOrigin()) },
            onToggleNotifications = { navigation.toggleNotifications() },
        )
    }

    fun openRecord(record: NotificationRecord) {
        val svc = services ?: return
        scope.launch {
            svc.activateNotification(record.key)
        }
    }

    // Dirty-state guard for destructive Settings actions (reset): confirms through the workspace's own departure
    // dialog and answers true only for an explicit proceed; cancel/dismiss/superseded answer false.
    suspend fun guardDeparture(): Boolean {
        val ws = activeWorkspaceState ?: return true
        if (!ws.hasDirtyDocuments() || ws.isAuthorityRetired.value) return true
        val decision = CompletableDeferred<Boolean>()
        val intent = WorkspaceDepartureIntent.WorkspaceLeave(
            targetStageName = "SETTINGS_RESET",
            dirtyDocuments = ws.getDirtyDocumentIds(),
            dirtyRevisions = ws.getDirtyRevisions(),
            onConfirmed = { decision.complete(true) },
            // Cancellation is observed through the pending-prompt watcher below; a failed Save keeps the prompt open.
            onCancelled = {},
        )
        ws.setPendingDeparture(intent)
        if (ws.pendingDeparture.value !== intent) return false
        val watcher = scope.launch {
            ws.pendingDeparture.collect { current ->
                if (current !== intent) {
                    yield() // let a confirming click handler finish before treating the intent as cancelled
                    decision.complete(false)
                }
            }
        }
        return try {
            decision.await()
        } finally {
            watcher.cancel()
        }
    }

    // ---- Hardware shortcuts (C1 grammar; Settings/privacy/capture/focus gates win) ----
    val shortcutClock = remember { TimeSource.Monotonic.markNow() }
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    val rootFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        try {
            rootFocus.requestFocus()
        } catch (_: Throwable) {
            // Not attached yet; the first tap focuses the root.
        }
    }

    fun runShortcut(action: ShortcutAction): Boolean {
        // A compact Agents sheet consumes search/panel/Projects shortcuts: nothing routes under it.
        if (agentsSheetConsumesShortcut(agentsHost.compactSheetOpen, action)) return true
        val ws = activeWorkspaceState
        val inWorkspace = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL) && ws != null
        return when (action) {
            ShortcutAction.SEARCH_TEXT -> inWorkspace.also { if (it) searchMode = WorkspaceSearchMode.TEXT }
            ShortcutAction.SEARCH_FILENAME -> inWorkspace.also { if (it) searchMode = WorkspaceSearchMode.FILENAME }
            ShortcutAction.FILE_PANEL -> inWorkspace.also { if (it) ws!!.selectPanel(WorkspacePanel.FILES) }
            ShortcutAction.REVEAL_ACTIVE_FILE -> inWorkspace.also {
                if (it) {
                    val path = ws!!.editorTabsState.activeTab?.path
                    ws.selectPanel(WorkspacePanel.FILES)
                    if (path != null) ws.fileTreeState.revealPath(path)
                }
            }
            ShortcutAction.PROJECT_PANEL -> {
                navigation.openProjectPicker()
                true
            }
            ShortcutAction.TERMINAL_FONT_INCREASE -> {
                prefAccess.update { it.copy(terminalFontSize = stepTerminalFontSize(it.terminalFontSize, 1)) }
                true
            }
            ShortcutAction.TERMINAL_FONT_DECREASE -> {
                prefAccess.update { it.copy(terminalFontSize = stepTerminalFontSize(it.terminalFontSize, -1)) }
                true
            }
            ShortcutAction.COGNITO -> {
                val privacy = privacyController ?: return false
                val chord = ShortcutGrammar.format(prefs.cognitoModeShortcut)
                if (privacy.isMaskActive.value) privacy.dismissWithChord(chord) else privacy.activate(chord, prefs.cognitoModeStyle)
                true
            }
            // Unavailable destinations never reach here (the registry answers Unavailable); ignore defensively.
            ShortcutAction.TERMINAL_WORKSPACE, ShortcutAction.GIT_PANEL, ShortcutAction.PORTS_PANEL, ShortcutAction.FLEET_TERMINAL -> false
        }
    }

    fun onRootKey(event: KeyEvent): Boolean {
        val svc = services ?: return false
        val isEditing = searchMode != null || (activeWorkspaceState != null && (activeWorkspaceState.activePanel.value == WorkspacePanel.EDITOR || activeWorkspaceState.activePanel.value == WorkspacePanel.GIT || activeWorkspaceState.isCommandInputFocused.value || activeWorkspaceState.terminalState?.isCommandInputFocused?.value == true))
        val isComposing = activeWorkspaceState?.terminalState?.isImeComposing?.value == true
        if ((isEditing || isComposing) && !masked) {
            svc.shortcutRegistry.reset()
            return false
        }
        val input = event.toShortcutInput(shortcutClock.elapsedNow().inWholeMilliseconds, composing = isComposing) ?: return false
        val gate = ShortcutGate(
            routeId = "${flowState.stage}|$activeProfileId|$selectedProj|${activeWorkspaceState?.activePanel?.value}",
            focused = windowFocused,
            blocked = settingsOpen || flowState.projectPickerOpen,
            masked = masked,
            capturing = false,
            editableFocused = isEditing || isComposing,
        )
        return when (val outcome = svc.shortcutRegistry.onKey(input, gate, prefs)) {
            ShortcutOutcome.PassThrough -> false
            ShortcutOutcome.Consume -> true
            is ShortcutOutcome.Dispatch -> {
                runShortcut(outcome.action)
                true // consumed even when the action has no destination here (never leaks into the PTY/editor)
            }
            is ShortcutOutcome.Unavailable -> {
                shortcutNotice = "${outcome.action.title}: ${outcome.reason}"
                true
            }
        }
    }

    val body: @Composable () -> Unit = {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(DamHopperColors.Background)
                .safeDrawingPadding()
                .focusRequester(rootFocus)
                .focusable()
                .onPreviewKeyEvent { onRootKey(it) }
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                if (services != null) {
                    NotificationTransients(
                        feed = feed,
                        onOpen = { openRecord(it) },
                        onDismiss = { services.dismissTransient(it) },
                    )
                    if (flowState.notificationsOpen) {
                        NotificationCenter(
                            feed = feed,
                            statusFilter = prefs.statusFilter,
                            routeNotice = routeNotice,
                            onOpen = { openRecord(it) },
                            onMarkAllRead = { services.markAllNotificationsRead() },
                            onClear = { services.clearNotifications() },
                            onDismissNotice = { services.dismissRouteNotice() },
                        )
                    }
                }
                shortcutNotice?.let { notice ->
                    Text(
                        text = notice,
                        color = DamHopperColors.Warning,
                        fontSize = 12.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(DamHopperColors.Surface)
                            .sizeIn(minHeight = 48.dp)
                            .clickable { shortcutNotice = null }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                    )
                }
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when (flowState.stage) {
                        AppFlowStage.PROFILE_LOGIN -> {
                            ProfileLoginScreen(
                                profileRepository = profileRepository,
                                onAuthenticated = { profId ->
                                    navigation.onProfileAuthenticated(profId)
                                },
                                headerEntries = headerEntries,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }

                        AppFlowStage.HUB, AppFlowStage.TERMINAL, AppFlowStage.PROJECT_LIST -> {
                            val proj = flowState.activeProject
                            if (proj.isNullOrBlank()) {
                                AgentHubEmptyRoot(
                                    profileName = currentProfile?.name ?: "Server",
                                    serverUrl = currentProfile?.baseUrl,
                                    headerEntries = headerEntries,
                                    agents = agentsContext,
                                    hubSnapshot = hubSnapshot,
                                    onAction = { action -> scope.launch { services?.dispatchAction(action) } },
                                    onOpenProject = { navigation.openProjectPicker() },
                                    onOpenSettings = { navigation.openSettings(captureOrigin()) },
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else if (activeWorkspaceState != null) {
                                ProjectWorkspaceScreen(
                                    projectName = proj,
                                    workspaceState = activeWorkspaceState,
                                    terminalRepo = terminalRepo,
                                    navigation = navigation,
                                    initialSessionId = flowState.activeSessionId,
                                    onSessionSelected = { sessionId ->
                                        navigation.selectSession(sessionId)
                                    },
                                    profileId = activeProfileId,
                                    preferenceAccess = prefAccess,
                                    languageFilterNotice = languageNotice,
                                    headerEntries = headerEntries,
                                    requiredTerminalInstance = flowState.requiredTerminalInstance,
                                    agents = agentsContext,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else {
                                ProjectTerminalScreen(
                                    projectName = proj,
                                    terminalRepo = terminalRepo,
                                    onBackToProjects = {
                                        navigation.handleBackPress()
                                    },
                                    initialSessionId = flowState.activeSessionId,
                                    onSessionSelected = { sessionId ->
                                        navigation.selectSession(sessionId)
                                    },
                                    profileId = activeProfileId,
                                    preferenceAccess = prefAccess,
                                    inputCovered = settingsOpen || masked || effectiveCover,
                                    requiredTerminalInstance = flowState.requiredTerminalInstance,
                                    agents = agentsContext,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
                    }

                    val mode = searchMode
                    val ws = activeWorkspaceState
                    val client = apiClient
                    val inWorkspace = (flowState.stage == AppFlowStage.HUB || flowState.stage == AppFlowStage.TERMINAL) && !settingsOpen
                    if (mode != null && ws != null && client != null && inWorkspace) {
                        val search = remember { SearchRepository() }
                        WorkspaceSearchView(
                            mode = mode,
                            target = ws.target,
                            apiClient = client,
                            searchRepository = search,
                            onOpen = { path ->
                                searchMode = null
                                scope.launch {
                                    ws.editorTabsState.openTab(ws.target, path)
                                    ws.selectPanel(WorkspacePanel.EDITOR)
                                }
                            },
                            onClose = { searchMode = null },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }

                    val overlay = flowState.settings
                    if (overlay != null && services != null) {
                        // The captured Settings target B must be the selected target AND its exact retained service
                        // owner; otherwise target services stay blocked (no ambient fallback to another server).
                        val intendedTarget = overlay.targetProfileId
                        val sourceTarget by services.settingsRepository.sourceTargetState.collectAsState()
                        val targetOwner = settingsServices.targetServices?.owner
                        val targetReady = overlay.targetServicesReady(
                            selectedTargetProfileId = sourceTarget.settingsProfileId,
                            serviceOwnerConnection = targetOwner?.connection,
                            serviceOwnerAccount = targetOwner?.accountId,
                            currentConnection = intendedTarget?.let { connections[it] },
                            currentAccount = intendedTarget?.let { (authStatuses[it] as? AuthStatus.Authenticated)?.session?.user },
                        )
                        val shownServices = if (targetReady) {
                            settingsServices
                        } else {
                            SettingsScreenServices(
                                targetServices = null,
                                commandHistory = settingsServices.commandHistory,
                                documentWorkflow = settingsServices.documentWorkflow,
                                notificationPlatform = settingsServices.notificationPlatform,
                                notificationAudio = settingsServices.notificationAudio,
                                integrationReadiness = settingsServices.integrationReadiness,
                            )
                        }
                        // A new Agents settings intent re-keys the content so remembered sections update deterministically.
                        key(overlay.intent) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(DamHopperColors.Background)
                                .pointerInput(Unit) { detectTapGestures { } }, // the covered stage never sees touches
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Box(
                                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).clickable { navigation.closeSettings() },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text("← Back", color = DamHopperColors.Primary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                }
                                Text("Settings", color = DamHopperColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            }
                            SettingsScreens(
                                settingsRepository = services.settingsRepository,
                                privacyController = services.privacyController,
                                services = shownServices,
                                departureGuard = { guardDeparture() },
                                diagnosticsInput = { services.diagnosticsInput() },
                                onTargetRevalidated = { profileId ->
                                    services.onTargetRevalidated(profileId)
                                    if (profileId == activeProfileId) activeWorkspaceState?.fileTreeState?.refresh()
                                },
                                onResetConfirmed = { profileId ->
                                    // Only a confirmed reset of the still-current server leaves for workspace selection.
                                    if (profileId == activeProfileId) navigation.completeResetToWorkspaceSelection()
                                },
                                availableProfiles = profiles,
                                activeProfileId = repoActiveProfileId,
                                profileRepository = profileRepository,
                                authStatuses = authStatuses,
                                initialSubSection = SettingsSubSection.entries.firstOrNull { it.name == overlay.subSection }
                                    ?: SettingsSubSection.PREFERENCES,
                                onActiveSubSectionChanged = { navigation.setSettingsSubSection(it.name) },
                                initialHostSection = HostSettingsSection.entries.firstOrNull { it.name == overlay.hostSection }
                                    ?: HostSettingsSection.IDLE,
                                onHostSectionChanged = { navigation.setSettingsHostSection(it.name) },
                                onNavigateBack = { navigation.closeSettings() },
                                onOpenAuth = {
                                    navigation.closeSettings()
                                    navigation.navigateToProfiles()
                                },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
                    if (flowState.projectPickerOpen && !masked) {
                        AgentHubProjectPickerModal(
                            profileName = currentProfile?.name ?: "Server",
                            serverUrl = currentProfile?.baseUrl,
                            workspaceRepo = workspaceRepo,
                            onClose = { navigation.closeProjectPicker() },
                            onSelectProject = { projectName ->
                                val targetRef = ProjectTargetRef(
                                    profileId = activeProfileId,
                                    project = projectName,
                                    worktreePath = null,
                                )
                                scope.launch {
                                    navigation.requestWorkspaceTarget(
                                        target = targetRef,
                                        revalidate = {
                                            val profId = targetRef.profileId.orEmpty()
                                            profileRepository.registry.getCurrentConnection(profId) != null
                                        },
                                        onCommitted = {
                                            targetStore.selectTarget(
                                                profileId = activeProfileId,
                                                workspaceConfigPath = null,
                                                project = projectName,
                                                worktreePath = null,
                                            )
                                            navigation.closeProjectPicker()
                                        }
                                    )
                                }
                            },
                            onNavigateProfiles = {
                                navigation.closeProjectPicker()
                                navigation.navigateToProfiles()
                            },
                        )
                    }
            }
        }
    }
    }

    if (privacyController != null) {
        CognitoOverlay(privacyController = privacyController, modifier = Modifier.fillMaxSize(), content = body)
    } else {
        body()
    }
}

private val AgentsHostStateSaver: Saver<TerminalAgentsHostState, Boolean> = Saver(
    save = { it.open },
    restore = { TerminalAgentsHostState(initialOpen = it) },
)

/** Route shortcuts a compact Agents sheet consumes (nothing routes under the sheet); privacy/Settings still win. */
private val AGENTS_SHEET_SUPPRESSED_SHORTCUTS: Set<ShortcutAction> = setOf(
    ShortcutAction.SEARCH_TEXT,
    ShortcutAction.SEARCH_FILENAME,
    ShortcutAction.FILE_PANEL,
    ShortcutAction.REVEAL_ACTIVE_FILE,
    ShortcutAction.PROJECT_PANEL,
)

/**
 * True when an open compact Agents sheet consumes [action]: search/panel/Projects routes never run under the sheet,
 * while font and privacy (emergency dismissal) shortcuts still work.
 */
internal fun agentsSheetConsumesShortcut(compactSheetOpen: Boolean, action: ShortcutAction): Boolean =
    compactSheetOpen && action in AGENTS_SHEET_SUPPRESSED_SHORTCUTS

@Composable
private fun HubCapabilityTab(
    label: String,
    isSelected: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit = {},
    contentDescription: String? = null,
) {
    val bg = if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
    val textColor = if (isSelected) DamHopperColors.Background else if (enabled) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary.copy(alpha = 0.5f)
    Box(
        modifier = Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 36.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .semantics { contentDescription?.let { this.contentDescription = it } },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 13.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

@Composable
private fun AgentHubEmptyRoot(
    profileName: String,
    serverUrl: String?,
    headerEntries: HeaderEntries?,
    agents: TerminalAgentsContext?,
    hubSnapshot: dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot = dev.damhopper.nativeapp.features.workspace.AgentHubSnapshot(),
    onAction: (dev.damhopper.nativeapp.features.workspace.AgentHubAction) -> Unit = {},
    onOpenProject: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val content: @Composable () -> Unit = {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(DamHopperColors.Background),
        ) {
            // Row 1 & 2: Adaptive two-row chrome
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Surface)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // Row 1: Brand title + Open Project button + Header entries (Alerts, Settings)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Agent Hub",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.semantics { heading() },
                    )
                    Box(
                        modifier = Modifier
                            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .border(BorderStroke(1.dp, DamHopperColors.Border), RoundedCornerShape(6.dp))
                            .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.7f))
                            .clickable(onClick = onOpenProject)
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "+ Open Project",
                            color = DamHopperColors.Primary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    headerEntries?.let { HeaderEntryButtons(it) }
                }

                // Row 2: Capabilities bar (Terminal, Files, Editor, Git) horizontally scrollable
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    HubCapabilityTab(
                        label = "Terminal",
                        isSelected = true,
                        onClick = { onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.CreateTerminalIntent(hubSnapshot.selectedProjectTarget)) },
                    )
                    HubCapabilityTab(
                        label = "Files",
                        isSelected = false,
                        enabled = true,
                        onClick = {
                            val target = hubSnapshot.selectedProjectTarget
                            if (target != null) {
                                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.OpenFiles(FilesystemTargetRef.Project(profileId = target.profileId, project = target.project, worktreePath = target.worktreePath)))
                            } else {
                                onOpenProject()
                            }
                        },
                    )
                    HubCapabilityTab(
                        label = "Editor",
                        isSelected = false,
                        enabled = true,
                        onClick = {
                            val target = hubSnapshot.selectedProjectTarget
                            if (target != null) {
                                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.OpenFiles(FilesystemTargetRef.Project(profileId = target.profileId, project = target.project, worktreePath = target.worktreePath)))
                            } else {
                                onOpenProject()
                            }
                        },
                    )
                    HubCapabilityTab(
                        label = "Git",
                        isSelected = false,
                        enabled = true,
                        onClick = {
                            val target = hubSnapshot.selectedProjectTarget
                            if (target != null) {
                                onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.OpenGit(target))
                            } else {
                                onOpenProject()
                            }
                        },
                    )
            }
            }

            if (hubSnapshot.terminalRows.isNotEmpty() || hubSnapshot.zeroSessionOpenTargets.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (hubSnapshot.pinnedTerminals.isNotEmpty()) {
                        Text("Pinned Terminals", color = DamHopperColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        hubSnapshot.pinnedTerminals.forEach { row ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .sizeIn(minHeight = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(DamHopperColors.Surface)
                                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                    .clickable { onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.SelectTerminal(row.id, row.projectTarget?.profileId)) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                Text("${row.projectTarget?.project.orEmpty()}: ${row.displayName}", color = DamHopperColors.TextPrimary, fontSize = 14.sp)
                            }
                        }
                    }
                    if (hubSnapshot.activeTerminals.isNotEmpty()) {
                        Text("Active Terminals", color = DamHopperColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        hubSnapshot.activeTerminals.forEach { row ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .sizeIn(minHeight = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(DamHopperColors.Surface)
                                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                    .clickable { onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.SelectTerminal(row.id, row.projectTarget?.profileId)) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                Text("${row.projectTarget?.project.orEmpty()}: ${row.displayName}", color = DamHopperColors.TextPrimary, fontSize = 14.sp)
                            }
                        }
                    }
                    if (hubSnapshot.zeroSessionOpenTargets.isNotEmpty()) {
                        Text("Open Projects (0 sessions)", color = DamHopperColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        hubSnapshot.zeroSessionOpenTargets.forEach { target ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .sizeIn(minHeight = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(DamHopperColors.Surface)
                                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                    .clickable { onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.SelectProjectTarget(target)) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(target.project, color = DamHopperColors.TextPrimary, fontSize = 14.sp, modifier = Modifier.weight(1f))
                                Box(
                                    modifier = Modifier
                                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                        .clickable { onAction(dev.damhopper.nativeapp.features.workspace.AgentHubAction.DismissZeroSessionProject(target)) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text("✕", color = DamHopperColors.TextSecondary, fontSize = 14.sp)
                                }
                            }
                        }
                    }
                }
            } else {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        modifier = Modifier
                            .sizeIn(maxWidth = 440.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(DamHopperColors.Surface)
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp))
                            .padding(24.dp),
                    ) {
                        Text(
                            text = "Connected to $profileName",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        serverUrl?.let {
                            Text(
                                text = it,
                                color = DamHopperColors.TextSecondary,
                                fontSize = 12.sp,
                            )
                        }
                        Text(
                            text = "No project is currently open. Select a project to view terminal sessions, browse files, edit code, and manage Git repositories.",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 13.sp,
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(DamHopperColors.Primary)
                                    .clickable(onClick = onOpenProject)
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "Open Project",
                                    color = DamHopperColors.Background,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                    .background(DamHopperColors.SurfaceVariant)
                                    .clickable(onClick = onOpenSettings)
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "Settings",
                                    color = DamHopperColors.TextPrimary,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (agents != null) {
        TerminalAgentsSidebarHost(
            agents = agents,
            active = null,
            modifier = modifier,
            content = content,
        )
    } else {
        Box(modifier = modifier) { content() }
    }
}

@Composable
private fun AgentHubProjectPickerModal(
    profileName: String,
    serverUrl: String?,
    workspaceRepo: WorkspaceRepository?,
    onClose: () -> Unit,
    onSelectProject: (String) -> Unit,
    onNavigateProfiles: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(DamHopperColors.Background.copy(alpha = 0.95f))
                .padding(16.dp),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Open Project",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Box(
                        modifier = Modifier
                            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(onClick = onClose)
                            .padding(8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "✕ Close",
                            color = DamHopperColors.Primary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                ProjectListScreen(
                    profileName = profileName,
                    serverUrl = serverUrl,
                    workspaceRepository = workspaceRepo,
                    onNavigateProfiles = onNavigateProfiles,
                    onSelectProject = onSelectProject,
                    headerEntries = null,
                    agents = null,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
            }
        }
    }
}
