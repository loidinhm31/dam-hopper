package dev.damhopper.nativeapp.features.settings

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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.notifications.NotificationAudioPort
import dev.damhopper.nativeapp.core.notifications.NotificationPlatformPort
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ProfileListScreen
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import kotlinx.coroutines.launch

/** Sub-sections available within WorkbenchPanel.SETTINGS. */
enum class SettingsSubSection(val label: String) {
    PREFERENCES("Preferences & Privacy"),
    NOTIFICATIONS("Notifications"),
    HOST("Host administration"),
    MAINTENANCE("Import / Export & Maintenance"),
    PROFILES("Server Profiles"),
}

/**
 * Retained services injected by the integration layer (never created here, never holding an Activity):
 * the selected Settings target's services, local history store, document workflow, notification ports and the
 * runtime-qualified integration readiness. Everything defaults to "absent", which the views render as an explicit
 * read-only/unavailable state - there is no silent fallback to another server.
 */
class SettingsScreenServices(
    val targetServices: SettingsTargetServices? = null,
    val commandHistory: CommandHistoryStore? = null,
    val documentWorkflow: SettingsDocumentWorkflow? = null,
    val notificationPlatform: NotificationPlatformPort? = null,
    val notificationAudio: NotificationAudioPort? = null,
    val integrationReadiness: Map<AgentKind, IntegrationReadinessState> = emptyMap(),
)

/**
 * Host for the Settings overlay. All state flows from [SettingsRepository]; authoritative target/source status
 * and every mutation go through its request-local guards.
 *
 * @param departureGuard the app's dirty-state guard; run before a destructive reset is even admitted.
 * @param diagnosticsInput builds the allowlisted LOCAL diagnostics input (typed fields only).
 * @param onTargetRevalidated refetch the given target's retained queries after a confirmed cache revalidation.
 * @param onResetConfirmed called only for a confirmed reset of the still-current target.
 */
@Composable
fun SettingsScreens(
    settingsRepository: SettingsRepository,
    privacyController: PrivacyController,
    services: SettingsScreenServices,
    departureGuard: suspend () -> Boolean,
    diagnosticsInput: () -> SettingsDiagnosticsInput,
    onTargetRevalidated: (profileId: String) -> Unit,
    onResetConfirmed: (profileId: String) -> Unit,
    availableProfiles: List<ServerProfile> = emptyList(),
    activeProfileId: String? = null,
    profileRepository: ProfileRepository? = null,
    authStatuses: Map<String, AuthStatus> = emptyMap(),
    initialSubSection: SettingsSubSection = SettingsSubSection.PREFERENCES,
    onActiveSubSectionChanged: (SettingsSubSection) -> Unit = {},
    onNavigateBack: (() -> Unit)? = null,
    onOpenAuth: ((profileId: String) -> Unit)? = null,
    initialHostSection: HostSettingsSection = HostSettingsSection.IDLE,
    onHostSectionChanged: (HostSettingsSection) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var activeSubSection by remember { mutableStateOf(initialSubSection) }
    val coroutineScope = rememberCoroutineScope()
    val sourceTarget by settingsRepository.sourceTargetState.collectAsState()

    LaunchedEffect(activeSubSection) { onActiveSubSectionChanged(activeSubSection) }

    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SettingsSubSection.entries.forEach { subSection ->
                    FilterChip(
                        selected = activeSubSection == subSection,
                        onClick = { activeSubSection = subSection },
                        label = { Text(subSection.label) },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    )
                }
            }

            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                when (activeSubSection) {
                    SettingsSubSection.PREFERENCES -> PreferencesPrivacyView(
                        settingsRepository = settingsRepository,
                        privacyController = privacyController,
                        availableProfiles = availableProfiles,
                        commandHistory = services.commandHistory,
                    )

                    SettingsSubSection.NOTIFICATIONS -> NotificationsView(
                        settingsRepository = settingsRepository,
                        platform = services.notificationPlatform,
                        audio = services.notificationAudio,
                        readiness = services.integrationReadiness,
                    )

                    SettingsSubSection.HOST -> {
                        val targetId = sourceTarget.settingsProfileId
                        val targetStatus = targetId?.let { authStatuses[it] }
                        val authenticated = targetStatus as? AuthStatus.Authenticated
                        val blocked = when {
                            targetId == null -> "Select a target server under Import / Export & Maintenance first."
                            authenticated == null -> if (targetStatus == null) {
                                "The sign-in status of the selected server is unknown; administration stays read-only."
                            } else {
                                "Sign in to the selected server to administer it."
                            }
                            else -> null
                        }
                        val noAuth = if (authenticated?.session?.devMode == true) {
                            "This server runs without authentication; it does not accept idle-suspend changes."
                        } else {
                            null
                        }
                        val label = availableProfiles.firstOrNull { it.id == targetId }?.name
                        val sourceLabel = availableProfiles.firstOrNull { it.id == sourceTarget.preferencesProfileId }?.name ?: "local only"
                        SettingsHostView(
                            settingsRepository = settingsRepository,
                            services = services.targetServices?.takeIf { it.owner.connection.profileId == targetId },
                            targetLabel = label,
                            sourceLabel = sourceLabel,
                            adminBlockedReason = blocked,
                            idleBlockedReason = noAuth,
                            initialSection = initialHostSection,
                            onSectionChanged = onHostSectionChanged,
                        )
                    }

                    SettingsSubSection.MAINTENANCE -> MaintenanceView(
                        settingsRepository = settingsRepository,
                        availableProfiles = availableProfiles,
                        workflow = services.documentWorkflow,
                        diagnosticsInput = diagnosticsInput,
                        departureGuard = departureGuard,
                        onTargetRevalidated = onTargetRevalidated,
                        onResetConfirmed = onResetConfirmed,
                    )

                    SettingsSubSection.PROFILES -> {
                        if (profileRepository != null) {
                            ProfileListScreen(
                                profiles = availableProfiles,
                                activeProfileId = activeProfileId,
                                authStatuses = authStatuses,
                                onSelectProfile = { id -> coroutineScope.launch { profileRepository.selectProfile(id) } },
                                onAddProfile = { name, url, username ->
                                    coroutineScope.launch { profileRepository.addProfile(name, url, username) }
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
                            Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    "Profile repository is not initialized.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Authoritative `ui.agentSettingsPaths` of the runtime's OWN server (event runtime C): read through that
 * runtime's client from its global config, never from preference source A, Settings target B or a local
 * fallback guess. A missing entry means "server default" (null).
 */
suspend fun fetchRuntimeAgentPaths(client: dev.damhopper.nativeapp.core.transport.ApiClient): AgentPathInputs {
    val ui = RemoteConfigRepository(client).getGlobalConfig()["ui"] as? kotlinx.serialization.json.JsonObject
    val paths = ui?.get("agentSettingsPaths") as? kotlinx.serialization.json.JsonObject
    fun read(key: AgentPathKey): String? =
        (paths?.get(key.wire) as? kotlinx.serialization.json.JsonPrimitive)
            ?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
    return AgentPathInputs(omp = read(AgentPathKey.OMP), codex = read(AgentPathKey.CODEX), claude = read(AgentPathKey.CLAUDE))
}

/**
 * Builds the retained [dev.damhopper.nativeapp.core.notifications.NotificationCoordinator] over the ONE reactive
 * preferences/policy of [settings]. Delivery reads those at effect time, so toggling a policy needs no restart.
 */
fun createNotificationCoordinator(
    provider: dev.damhopper.nativeapp.features.terminal.IntegrationReadinessProvider,
    sink: dev.damhopper.nativeapp.core.notifications.NotificationSink,
    audio: NotificationAudioPort,
    platform: NotificationPlatformPort,
    lifecycle: kotlinx.coroutines.flow.StateFlow<dev.damhopper.nativeapp.core.lifecycle.LifecycleState>,
    settings: SettingsRepository,
    isCurrentOwner: (dev.damhopper.nativeapp.features.terminal.IntegrationOwner) -> Boolean,
    processInstanceId: String,
    nowMs: () -> Long,
): dev.damhopper.nativeapp.core.notifications.NotificationCoordinator =
    dev.damhopper.nativeapp.core.notifications.NotificationCoordinator(
        provider = provider,
        sink = sink,
        audio = audio,
        platform = platform,
        lifecycle = lifecycle,
        preferences = { settings.preferences.value },
        unsupportedPolicy = { settings.unsupportedPolicy.value },
        isCurrentOwner = isCurrentOwner,
        processInstanceId = processInstanceId,
        nowMs = nowMs,
    )
