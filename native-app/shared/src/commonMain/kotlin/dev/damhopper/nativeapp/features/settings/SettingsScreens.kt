package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.notifications.NotificationSink
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ProfileListScreen
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

/**
 * Sub-sections available within WorkbenchPanel.SETTINGS.
 */
enum class SettingsSubSection(val label: String) {
    PREFERENCES("Preferences & Privacy"),
    MAINTENANCE("Import / Export & Maintenance"),
    NOTIFICATIONS("Notifications"),
    REMOTE_CONFIG("Remote Config"),
    PROFILES("Server Profiles"),
}

/**
 * Authoritative screen host for WorkbenchPanel.SETTINGS.
 *
 * Invariants:
 * - Zero FABs (0 FABs).
 * - Zero browser engines.
 * - Dark Workbench Theme using DamHopperColors.
 * - Single top horizontal panel row below header.
 * - Single content area.
 * - Minimum 48dp touch targets for accessibility.
 *
 * Integrates:
 * 1. Preferences & Privacy (Theme, Font sizes 10..32, live typography preview, terminal suggestions,
 *    explorer filters, sound/haptics, and Cognito Privacy Mode with test activation).
 * 2. Import / Export & Maintenance (Target server selection, 1 MiB TOML import with confirmation,
 *    export TOML with copy, server cache clearing, and nuclear reset with two-phase verification).
 * 3. Notifications (Master toggle, per-agent policies for OMP, Claude, Codex, and channel diagnostics).
 * 4. Remote Configuration (Allowlisted remote UI preferences & server configuration editor).
 * 5. Server Profiles (Multi-server profile management and authentication).
 */
@Composable
fun SettingsScreens(
    settingsRepository: SettingsRepository,
    privacyController: PrivacyController,
    availableProfiles: List<ServerProfile> = emptyList(),
    activeProfileId: String? = null,
    profileRepository: ProfileRepository? = null,
    authStatuses: Map<String, AuthStatus> = emptyMap(),
    remoteConfigEditor: RemoteConfigEditor? = null,
    notificationSink: NotificationSink? = null,
    initialSubSection: SettingsSubSection = SettingsSubSection.PREFERENCES,
    onActiveSubSectionChanged: (SettingsSubSection) -> Unit = {},
    onNavigateBack: (() -> Unit)? = null,
    onOpenAuth: ((profileId: String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var activeSubSection by remember { mutableStateOf(initialSubSection) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(activeSubSection) {
        onActiveSubSectionChanged(activeSubSection)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background),
    ) {
        // Top horizontal sub-product switcher row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SettingsSubSection.entries.forEach { subSection ->
                val isSelected = activeSubSection == subSection
                Box(
                    modifier = Modifier
                        .defaultMinSize(minHeight = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant,
                        )
                        .clickable { activeSubSection = subSection }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = subSection.label,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                        color = if (isSelected) Color.Black else DamHopperColors.TextSecondary,
                    )
                }
            }
        }

        // Single Content Area
        Box(
            modifier = Modifier
                .fillMaxSize()
                .weight(1f),
        ) {
            when (activeSubSection) {
                SettingsSubSection.PREFERENCES -> {
                    PreferencesPrivacyView(
                        settingsRepository = settingsRepository,
                        privacyController = privacyController,
                        availableProfiles = availableProfiles,
                    )
                }

                SettingsSubSection.MAINTENANCE -> {
                    MaintenanceView(
                        settingsRepository = settingsRepository,
                        availableProfiles = availableProfiles,
                    )
                }

                SettingsSubSection.NOTIFICATIONS -> {
                    NotificationsView(
                        settingsRepository = settingsRepository,
                        notificationSink = notificationSink,
                    )
                }

                SettingsSubSection.REMOTE_CONFIG -> {
                    if (remoteConfigEditor != null) {
                        RemoteConfigScreen(editor = remoteConfigEditor)
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "Remote configuration is unavailable for the selected profile.\nPlease connect to a server target.",
                                style = DamHopperTypography.bodyMedium,
                                color = DamHopperColors.TextSecondary,
                            )
                        }
                    }
                }

                SettingsSubSection.PROFILES -> {
                    if (profileRepository != null) {
                        ProfileListScreen(
                            profiles = availableProfiles,
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
                                    settingsRepository.onProfileRemoved(id)
                                }
                            },
                            onOpenAuth = { id -> onOpenAuth?.invoke(id) },
                            onClose = { onNavigateBack?.invoke() },
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "Profile repository is not initialized.",
                                style = DamHopperTypography.bodyMedium,
                                color = DamHopperColors.TextSecondary,
                            )
                        }
                    }
                }
            }
        }
    }
}
