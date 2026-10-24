package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CancellationException
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.settings.InMemoryPreferencesStore
import dev.damhopper.nativeapp.features.settings.PreferencesStore
import dev.damhopper.nativeapp.features.terminal.TerminalRepository
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.ui.flow.AppFlowNavigation
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.features.editor.EditorRepository
import dev.damhopper.nativeapp.features.files.FileRepository
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
/**
 * Root Mobile Entry Application Composable.
 *
 * Implements the guided linear mobile flow:
 * [AppFlowStage.PROFILE_LOGIN] -> [AppFlowStage.PROJECT_LIST] -> [AppFlowStage.TERMINAL]
 *
 * Invariants:
 * 1. Profile change clears active project and terminal session in [AppFlowNavigation].
 * 2. Unauthenticated state gracefully redirects to [AppFlowStage.PROFILE_LOGIN].
 * 3. Terminal output and input route strictly through [ProjectTerminalScreen] and [TerminalSessionController].
 * 4. Navigating back from Terminal deactivates input without killing remote PTY sessions.
 * 5. Zero WebView and zero floating action buttons across all hosted screens.
 */
@Composable
fun DamHopperMobileApp(
    profileRepository: ProfileRepository,
    targetStore: ProjectTargetStore = remember { ProjectTargetStore() },
    navigation: AppFlowNavigation = remember { AppFlowNavigation() },
    preferencesStore: PreferencesStore = remember { InMemoryPreferencesStore() },
    lifecycleCoordinator: LifecycleCoordinator = remember { LifecycleCoordinator() },
    workspaceStateProvider: ((WorkspaceFileOwner, ProjectTargetRef, ApiClient, WsConnection) -> ProjectWorkspaceState)? = null,
    modifier: Modifier = Modifier,
) {
    val flowState by navigation.state.collectAsState()
    val profiles by profileRepository.profiles.collectAsState()
    val activeProfileId by profileRepository.activeProfileId.collectAsState()
    val authStatuses by profileRepository.authStatuses.collectAsState()

    val currentProfile = profiles.find { it.id == activeProfileId }
    val currentAuthStatus = authStatuses[activeProfileId]

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
                terminalRepo = TerminalRepository(client, ws)
                if (ws != null) {
                    try {
                        ws.connect()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // Handled by downstream screens
                    }
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

    // Startup session restoration: validate stored session for active profile on initial launch
    LaunchedEffect(activeProfileId) {
        val profId = activeProfileId ?: return@LaunchedEffect
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
    val activeWorkspaceState = remember(activeProfileId, currentProfile?.baseUrl, currentConn?.generation, selectedProj, apiClient, wsConnection) {
        val client = apiClient
        val ws = wsConnection
        val profId = activeProfileId
        val prof = currentProfile
        if (profId != null && prof != null && client != null && ws != null && selectedProj != null) {
            val accountUser = (currentAuthStatus as? AuthStatus.Authenticated)?.session?.user
                ?: if (prof.baseUrl.contains("127.0.0.1") || prof.baseUrl.contains("localhost")) "dev-user" else "authenticated-user"
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
                ProjectWorkspaceState.create(
                    owner = owner,
                    target = target,
                    fileRepository = fileRepo,
                    editorRepository = editorRepo,
                    lifecycleCoordinator = lifecycleCoordinator,
                )
            }
        } else null
    }

    // Auto-advance or redirect based on authentication status and active profile
    LaunchedEffect(activeProfileId, currentAuthStatus) {
        val profId = activeProfileId
        val isAuthenticated = currentAuthStatus is AuthStatus.Authenticated
        if (!isAuthenticated && flowState.stage != AppFlowStage.PROFILE_LOGIN) {
            activeWorkspaceState?.revokeAuthority()
            navigation.navigateToProfiles()
        } else if (isAuthenticated && profId != null) {
            if (!hasInitialAutoAdvanced) {
                hasInitialAutoAdvanced = true
                navigation.onProfileAuthenticated(profId)
            } else if (flowState.stage != AppFlowStage.PROFILE_LOGIN && flowState.activeProfileId != profId) {
                navigation.onProfileAuthenticated(profId)
            }
        }
    }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .safeDrawingPadding()
    ) {
        when (flowState.stage) {
            AppFlowStage.PROFILE_LOGIN -> {
                ProfileLoginScreen(
                    profileRepository = profileRepository,
                    onAuthenticated = { profId ->
                        navigation.onProfileAuthenticated(profId)
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            AppFlowStage.PROJECT_LIST -> {
                ProjectListScreen(
                    profileName = currentProfile?.name ?: "Server",
                    serverUrl = currentProfile?.baseUrl,
                    workspaceRepository = workspaceRepo,
                    onNavigateProfiles = {
                        navigation.navigateToProfiles()
                    },
                    onSelectProject = { projectName ->
                        targetStore.selectTarget(
                            profileId = activeProfileId,
                            workspaceConfigPath = null,
                            project = projectName,
                            worktreePath = null,
                        )
                        navigation.selectProject(projectName)
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            AppFlowStage.TERMINAL -> {
                val proj = flowState.activeProject
                if (proj.isNullOrBlank()) {
                    LaunchedEffect(Unit) {
                        navigation.handleBackPress()
                    }
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
                        preferencesStore = preferencesStore,
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
                        preferencesStore = preferencesStore,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }
}
