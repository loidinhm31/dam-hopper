package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.notifications.NotificationAudioPort
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationPermissionState
import dev.damhopper.nativeapp.core.notifications.NotificationPlatformPort
import dev.damhopper.nativeapp.features.terminal.AgentKind
import dev.damhopper.nativeapp.features.terminal.IntegrationReadinessState
import kotlin.math.roundToInt

private fun AgentPolicies.of(agent: AgentKind): TerminalAgentPolicy = when (agent) {
    AgentKind.OMP -> omp
    AgentKind.CLAUDE -> claude
    AgentKind.CODEX -> codex
}

private fun AgentPolicies.with(agent: AgentKind, transform: (TerminalAgentPolicy) -> TerminalAgentPolicy): AgentPolicies =
    when (agent) {
        AgentKind.OMP -> copy(omp = transform(omp))
        AgentKind.CLAUDE -> copy(claude = transform(claude))
        AgentKind.CODEX -> copy(codex = transform(codex))
    }

/**
 * Notifications (S22, S24, N01-N11). Permission/channel status and the policy editor are separate: permission
 * state comes only from [platform]; policy comes from the synchronized v2 preferences. Pattern and volume
 * affect foreground in-app audio only; the Android channel (system sound) is controlled in system settings.
 * Enabling an agent needs a qualified runtime readiness from [readiness]; unknown readiness visibly disables
 * enabling (turning an agent off is always possible). Codex is status-only and never alerts.
 */
@Composable
fun NotificationsView(
    settingsRepository: SettingsRepository,
    platform: NotificationPlatformPort?,
    audio: NotificationAudioPort?,
    readiness: Map<AgentKind, IntegrationReadinessState> = emptyMap(),
    modifier: Modifier = Modifier,
) {
    val preferences by settingsRepository.preferences.collectAsState()
    val unsupported by settingsRepository.unsupportedPolicy.collectAsState()
    val platformStatus = platform?.status?.collectAsState()?.value
    val policy = preferences.terminalAgentNotifications
    var previewNote by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Android notification permission", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                if (platform == null || platformStatus == null) {
                    Text("System notification status is unavailable here.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Text(
                        text = when (platformStatus.permission) {
                            NotificationPermissionState.NOT_REQUIRED -> "Permission is not required on this Android version."
                            NotificationPermissionState.NOT_REQUESTED -> "Permission has not been requested. Nothing prompts automatically."
                            NotificationPermissionState.GRANTED -> "Permission granted."
                            NotificationPermissionState.DENIED -> "Permission denied. In-app alerts still work; system notifications need Android settings."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (platformStatus.appBlocked) {
                        Text("Notifications are blocked for this app in Android settings.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                        Button(
                            enabled = platformStatus.permission == NotificationPermissionState.NOT_REQUESTED ||
                                platformStatus.permission == NotificationPermissionState.DENIED,
                            onClick = { platform.requestPermission() },
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        ) { Text("Enable system notifications") }
                        OutlinedButton(onClick = { platform.refreshStatus() }, modifier = Modifier.defaultMinSize(minHeight = 48.dp)) { Text("Refresh status") }
                    }
                    NotificationChannelId.entries.forEach { channel ->
                        val state = platformStatus.channels[channel]
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(channel.channelName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                                Text(
                                    text = when {
                                        state == null -> "Status unknown"
                                        state.blocked -> "Blocked in Android settings"
                                        state.soundConfigured -> "Allowed, system sound on"
                                        else -> "Allowed, silent"
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(onClick = { platform.openChannelSettings(channel) }, modifier = Modifier.defaultMinSize(minHeight = 48.dp)) {
                                Text("Channel settings")
                            }
                        }
                    }
                }
                Text(
                    "Alert pattern and volume apply to sounds played while the app is open. In the background the Android channel decides the sound; this app cannot change it.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This device", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                Row(
                    modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                        Text("Sound effects", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                        Text("Master switch for in-app foreground alert sounds. It never bypasses Android controls.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = preferences.soundEnabled, onCheckedChange = { v -> settingsRepository.updatePreferences { it.copy(soundEnabled = v) } })
                }
                OutlinedTextField(
                    value = preferences.statusFilter,
                    onValueChange = { v -> settingsRepository.updatePreferences { it.copy(statusFilter = v) } },
                    label = { Text("Filter the notification list") },
                    supportingText = { Text("Filters the list only; it never stops alerts or deletes history.") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        if (unsupported != null) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer), modifier = Modifier.fillMaxWidth()) {
                Text(
                    "The preference server stores an unsupported notification policy version. It is kept exactly as is, shown read-only, and no alert is delivered from it.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }

        AgentKind.entries.forEach { agent ->
            val agentPolicy = policy.agents.of(agent)
            val statusOnly = agent == AgentKind.CODEX
            val editable = unsupported == null
            val state = readiness[agent] ?: IntegrationReadinessState.UNKNOWN
            val canEnable = editable && !statusOnly && state == IntegrationReadinessState.VERIFIED
            fun update(transform: (TerminalAgentPolicy) -> TerminalAgentPolicy) {
                settingsRepository.updatePolicy { it.copy(agents = it.agents.with(agent, transform)) }
            }
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        when (agent) {
                            AgentKind.OMP -> "OMP"
                            AgentKind.CLAUDE -> "Claude"
                            AgentKind.CODEX -> "Codex"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = when {
                            statusOnly -> "Codex is status-only: its hooks show lifecycle status and never raise alerts, even if the server policy says enabled."
                            agent == AgentKind.CLAUDE -> "Alerts only for \"needs attention\" with a verified remote integration."
                            else -> "Alerts for turn ended or needs attention with a verified remote extension."
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (!statusOnly) {
                        Text(
                            text = when (state) {
                                IntegrationReadinessState.VERIFIED -> "Runtime integration verified."
                                IntegrationReadinessState.UNAVAILABLE -> "Runtime integration is unavailable; alerts cannot be enabled."
                                IntegrationReadinessState.UNKNOWN -> "Runtime integration is not verified yet. Verify it under Host administration > Agents; enabling stays disabled until then."
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (state == IntegrationReadinessState.VERIFIED) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                        )
                    }
                    PolicySwitch("Alerts enabled", agentPolicy.enabled, enabled = editable && !statusOnly && (agentPolicy.enabled || canEnable)) { v ->
                        update { it.copy(enabled = v) }
                    }
                    PolicySwitch("In-app alert (toast)", agentPolicy.toast, enabled = editable && !statusOnly) { v -> update { it.copy(toast = v) } }
                    PolicySwitch("System notifications (Android)", agentPolicy.browser, enabled = editable && !statusOnly) { v -> update { it.copy(browser = v) } }
                    PolicySwitch("Sound (in-app)", agentPolicy.sound, enabled = editable && !statusOnly) { v -> update { it.copy(sound = v) } }
                    Text("Volume ${(agentPolicy.volume * 100).roundToInt()}%", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
                    Slider(
                        value = agentPolicy.volume.toFloat(),
                        onValueChange = { v -> update { it.copy(volume = ((v * 100f).roundToInt() / 100.0).coerceIn(0.0, 1.0)) } },
                        valueRange = 0f..1f,
                        enabled = editable && !statusOnly,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                        TerminalAgentPolicy.PATTERNS.forEach { pattern ->
                            FilterChip(
                                selected = agentPolicy.pattern == pattern,
                                enabled = editable && !statusOnly,
                                onClick = { update { it.copy(pattern = pattern) } },
                                label = { Text(pattern) },
                            )
                        }
                    }
                    OutlinedButton(
                        enabled = audio != null && !statusOnly && preferences.soundEnabled,
                        onClick = {
                            audio?.play(agentPolicy.pattern, agentPolicy.volume)
                            previewNote = "Played the ${agentPolicy.pattern} pattern locally in the app."
                        },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) { Text("Preview pattern (in-app)") }
                    if (!preferences.soundEnabled) {
                        Text("Turn on Sound effects above to preview.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        previewNote?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun PolicySwitch(label: String, checked: Boolean, enabled: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
        Switch(checked = checked, enabled = enabled, onCheckedChange = onCheckedChange)
    }
}
