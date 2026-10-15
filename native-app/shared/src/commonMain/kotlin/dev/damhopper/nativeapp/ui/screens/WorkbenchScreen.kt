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
import dev.damhopper.nativeapp.features.workspace.KnownWorkspace
import dev.damhopper.nativeapp.features.workspace.ProjectSummary
import dev.damhopper.nativeapp.features.workspace.ProjectTargetPickerModal
import dev.damhopper.nativeapp.features.workspace.ProjectTargetStore
import dev.damhopper.nativeapp.features.workspace.ProjectWorktree
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import dev.damhopper.nativeapp.features.workspace.WorkspaceStatus
import dev.damhopper.nativeapp.features.workspace.WorkspaceSwitcherModal
import dev.damhopper.nativeapp.features.workspace.WorkspaceSwitchWarningDialog
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.components.WorkbenchHeader
import dev.damhopper.nativeapp.ui.navigation.PanelHost
import dev.damhopper.nativeapp.ui.navigation.PanelNavigationRow
import dev.damhopper.nativeapp.ui.navigation.WorkbenchNavigation
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

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
    var settingsTab by remember { mutableStateOf(0) } // 0: Profiles, 1: Remote Config

    // Initialize or re-create repositories when active profile changes
    LaunchedEffect(activeProfileId, activeProfile?.baseUrl) {
        if (profileRepository != null && activeProfileId != null) {
            try {
                val client = profileRepository.getOrCreateApiClient(activeProfileId!!)
                val wRepo = WorkspaceRepository(client, targetStore)
                val cRepo = RemoteConfigRepository(client)
                val cEditor = RemoteConfigEditor(cRepo)
                workspaceRepo = wRepo
                configEditor = cEditor

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
            workspaceStatus = null
            projects = emptyList()
            currentWorktrees = emptyList()
            knownWorkspaces = emptyList()
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

    val snapshot = targetStore.getSnapshot(
        profileId = activeProfileId,
        workspaceConfigPath = workspaceStatus?.configPath,
        project = navState.activeProject
    )

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
