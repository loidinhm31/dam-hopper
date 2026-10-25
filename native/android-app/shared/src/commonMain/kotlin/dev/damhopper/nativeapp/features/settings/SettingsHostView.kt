package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.host.IdleConsentController
import dev.damhopper.nativeapp.features.host.IdleSuspendTabScreen
import dev.damhopper.nativeapp.features.host.UsageController
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository

/**
 * Retained services of ONE exact Settings target [owner], created by the integration layer from that owner's
 * binding. Nothing here falls back to the currently viewed workspace: if the selected target has no services
 * (disconnected/retiring) the host view shows a read-only explanation.
 */
class SettingsTargetServices(
    val owner: SettingsOwner,
    val configEditor: RemoteConfigEditor,
    val workspaceRepository: WorkspaceRepository,
    val agentIntegration: AgentIntegrationRepository,
    val usageController: UsageController?,
    val idleController: IdleConsentController?,
    val mutationAuthority: HostMutationAuthority,
)

enum class HostSettingsSection(val title: String) {
    IDLE("Idle suspend"),
    GLOBAL("Global"),
    CONFIG("Config"),
    AGENTS("Agents"),
}

/**
 * Remote administration of the selected Settings target (H01-H12, G01-G05, C01-C09, A01-A13). All mutations go
 * through request-local guards captured from [SettingsRepository]; remote failure and read-only states stay visible.
 */
@Composable
fun SettingsHostView(
    settingsRepository: SettingsRepository,
    services: SettingsTargetServices?,
    targetLabel: String?,
    sourceLabel: String,
    /** Why administration is read-only even though services exist (e.g. no-auth server); null when editable. */
    adminBlockedReason: String? = null,
    /** Why idle-suspend mutations cannot be submitted (e.g. no-auth/dev-mode server); null when allowed. */
    idleBlockedReason: String? = null,
    initialSection: HostSettingsSection = HostSettingsSection.IDLE,
    onSectionChanged: (HostSettingsSection) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var section by remember { mutableStateOf(initialSection) }
    val authority = services?.mutationAuthority?.takeIf { adminBlockedReason == null }
    val label = targetLabel ?: "No server selected"

    Column(modifier = modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Host administration", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        Text("Target server: $label", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            HostSettingsSection.entries.forEach { entry ->
                FilterChip(
                    selected = entry == section,
                    onClick = {
                        section = entry
                        onSectionChanged(entry)
                    },
                    label = { Text(entry.title) },
                )
            }
        }

        if (services == null) {
            Text(
                "The selected Settings server is not connected. Remote administration is read-only until it reconnects; nothing is sent to any other server.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            return@Column
        }
        adminBlockedReason?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        }

        // Lazy lists (idle, usage data) must not sit inside a vertical scroll container.
        val lazySection = section == HostSettingsSection.IDLE
        val sectionModifier = Modifier.fillMaxWidth().weight(1f)
        Column(modifier = if (lazySection) sectionModifier else sectionModifier.verticalScroll(rememberScrollState())) {
            when (section) {
                HostSettingsSection.IDLE -> {
                    val idle = services.idleController
                    if (idle == null) {
                        Text("Idle suspend status is unavailable on this server.", style = MaterialTheme.typography.bodyMedium)
                    } else {
                        IdleSuspendTabScreen(idle, authority, idleBlockedReason)
                    }
                }
                HostSettingsSection.GLOBAL -> GlobalSettingsView(
                    editor = services.configEditor.takeIf { authority != null },
                    workspaceRepository = services.workspaceRepository,
                    mutationAuthority = authority,
                    targetLabel = label,
                )
                HostSettingsSection.CONFIG -> RemoteConfigScreen(
                    editor = services.configEditor,
                    targetLabel = label,
                    readOnlyReason = adminBlockedReason,
                )
                HostSettingsSection.AGENTS -> AgentIntegrationView(
                    settingsRepository = settingsRepository,
                    integration = services.agentIntegration.takeIf { authority != null },
                    targetLabel = label,
                    sourceLabel = sourceLabel,
                )
            }
        }
    }
}
