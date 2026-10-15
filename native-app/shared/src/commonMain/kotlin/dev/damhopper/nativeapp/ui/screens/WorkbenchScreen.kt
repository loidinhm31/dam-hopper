package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.profiles.ProfileListScreen
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.components.GenericPanelPlaceholder
import dev.damhopper.nativeapp.ui.components.PanelNavigationRow
import dev.damhopper.nativeapp.ui.components.TerminalPanelPlaceholder
import dev.damhopper.nativeapp.ui.components.WorkbenchHeader
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

@Composable
fun WorkbenchScreen(
    initialState: WorkbenchState = WorkbenchState(),
    profileRepository: ProfileRepository? = null,
    modifier: Modifier = Modifier
) {
    var state by remember { mutableStateOf(initialState) }
    var showProfileList by remember { mutableStateOf(false) }
    var authProfileId by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()

    val profiles by profileRepository?.profiles?.collectAsState() ?: remember { mutableStateOf(emptyList()) }
    val activeProfileId by profileRepository?.activeProfileId?.collectAsState() ?: remember { mutableStateOf(null) }
    val authStatuses by profileRepository?.authStatuses?.collectAsState() ?: remember { mutableStateOf(emptyMap()) }

    val activeProfile = profiles.find { it.id == activeProfileId }
    val currentServerName = activeProfile?.name ?: state.serverName

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .safeDrawingPadding()
    ) {
        // 1. Top Header: Server & Project info (clickable to open profiles)
        WorkbenchHeader(
            state = state.copy(serverName = currentServerName),
            onOpenProfiles = if (profileRepository != null) { { showProfileList = true } } else null
        )

        // 2. Single Top Panel-Navigation Row (Horizontally scrollable, docked)
        PanelNavigationRow(
            activePanel = state.activePanel,
            onSelectPanel = { panel ->
                state = state.copy(activePanel = panel)
            }
        )

        // 3. Single Content Area (replaces content visually, keeping controllers alive)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(DamHopperColors.Background)
                .padding(8.dp)
        ) {
            when {
                showProfileList && profileRepository != null -> {
                    ProfileListScreen(
                        profiles = profiles,
                        activeProfileId = activeProfileId,
                        authStatuses = authStatuses,
                        onSelectProfile = { id ->
                            profileRepository.selectProfile(id)
                            showProfileList = false
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
                        onOpenAuth = { id -> authProfileId = id },
                        onClose = { showProfileList = false }
                    )
                }
                state.activePanel == WorkbenchPanel.TERMINAL -> {
                    TerminalPanelPlaceholder()
                }
                state.activePanel == WorkbenchPanel.SETTINGS && profileRepository != null -> {
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
                        onOpenAuth = { id -> authProfileId = id },
                        onClose = { state = state.copy(activePanel = WorkbenchPanel.TERMINAL) }
                    )
                }
                else -> {
                    GenericPanelPlaceholder(panel = state.activePanel)
                }
            }
        }
    }

    authProfileId?.let { pId ->
        if (profileRepository != null) {
            WorkbenchAuthFlow(
                profileId = pId,
                profiles = profiles,
                authStatuses = authStatuses,
                profileRepository = profileRepository,
                coroutineScope = coroutineScope,
                onDismiss = { authProfileId = null }
            )
        }
    }
}
