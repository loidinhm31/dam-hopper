package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.terminal.AgentKind
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

private sealed interface PendingIntegrationAction {
    val title: String
    val body: String

    data object OmpInstall : PendingIntegrationAction {
        override val title = "Install OMP extension?"
        override val body = "Installs or upgrades the DamHopper OMP extension in the remote OMP agent directory on the selected server."
    }
    data object OmpUninstall : PendingIntegrationAction {
        override val title = "Uninstall OMP extension?"
        override val body = "Removes the managed OMP extension from the remote server. OMP alerts stop being qualified."
    }
    data class HookInstall(val agent: AgentKind) : PendingIntegrationAction {
        override val title = "Install ${agent.name.lowercase()} hooks?"
        override val body = "Installs the managed ${agent.name.lowercase()} hook launcher on the remote server. It does not enable any notification."
    }
    data class HookUninstall(val agent: AgentKind) : PendingIntegrationAction {
        override val title = "Uninstall ${agent.name.lowercase()} hooks?"
        override val body = "Removes the managed ${agent.name.lowercase()} hook files from the remote server."
    }
}

/**
 * Remote Agent Integration (A01-A13). Paths are REMOTE server paths of the preference source (edit/reset
 * writes `ui.agentSettingsPaths`); verification/status/install/uninstall run against the Settings target through
 * the reused terminal endpoints. Status evidence is owner+path-revision qualified; it never certifies a
 * runtime owner and never enables a notification.
 */
@Composable
fun AgentIntegrationView(
    settingsRepository: SettingsRepository,
    integration: AgentIntegrationRepository?,
    targetLabel: String,
    sourceLabel: String,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val storedPaths by settingsRepository.agentSettingsPaths.collectAsState()
    val pathsRevision by settingsRepository.agentPathsRevision.collectAsState()
    val busyMap by settingsRepository.busy.collectAsState()
    val integrationState = integration?.state?.collectAsState()?.value
    var pending by remember { mutableStateOf<CapturedIntegrationExecution?>(null) }
    var pathMessage by remember { mutableStateOf<String?>(null) }
    val drafts = remember { mutableStateOf(emptyMap<AgentPathKey, String>()) }

    fun stored(key: AgentPathKey): String =
        (storedPaths?.get(key.wire) as? JsonPrimitive)?.takeIf { it.isString }?.content ?: key.defaultPath

    fun draft(key: AgentPathKey): String = drafts.value[key] ?: stored(key)

    fun inputs() = AgentPathInputs(
        omp = stored(AgentPathKey.OMP),
        codex = stored(AgentPathKey.CODEX),
        claude = stored(AgentPathKey.CLAUDE),
    )

    fun savePath(key: AgentPathKey, value: String, label: String) {
        scope.launch {
            pathMessage = null
            val op = settingsRepository.captureOperation(SettingsScope.PREFERENCE_SOURCE)
            if (op == null) {
                pathMessage = SettingsOutcome.NotSubmitted("No connected preference source is selected.").describe(label)
                return@launch
            }
            val outcome = settingsRepository.updateAgentSettingsPath(op, key, value)
            pathMessage = outcome.describe(label)
            if (outcome is SettingsOutcome.Confirmed) drafts.value = drafts.value - key
        }
    }

    pending?.let { execution ->
        AlertDialog(
            onDismissRequest = { pending = null },
            title = { Text(execution.action.title) },
            text = { Text(execution.action.body + "\n\nTarget server: $targetLabel. Nothing runs on this device.") },
            confirmButton = {
                TextButton(onClick = {
                    val exec = execution
                    pending = null
                    scope.launch {
                        if (settingsRepository.targetSelectionRevision != exec.openingRevision ||
                            !settingsRepository.targetAuthority().isCurrent(exec.openingTarget)
                        ) {
                            pathMessage = "The Settings target changed; the action was not sent."
                            return@launch
                        }
                        val repo = exec.repository
                        when (exec.action) {
                            PendingIntegrationAction.OmpInstall -> repo.installOmp(exec.agentDir)
                            PendingIntegrationAction.OmpUninstall -> repo.uninstallOmp(exec.agentDir)
                            is PendingIntegrationAction.HookInstall ->
                                repo.installIntegration(exec.action.agent, exec.agentDir)
                            is PendingIntegrationAction.HookUninstall ->
                                repo.uninstallIntegration(exec.action.agent, exec.agentDir)
                        }
                    }
                }) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text("Cancel") } },
        )
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Remote Agent Integration", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        Text(
            "Paths are remote server paths saved to the preference source ($sourceLabel). Verification and install run on the Settings target ($targetLabel). Neither certifies the live runtime; alerts need runtime verification.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        AgentPathKey.entries.forEach { key ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val label = when (key) {
                        AgentPathKey.OMP -> "OMP agent directory"
                        AgentPathKey.CODEX -> "Codex directory (status only)"
                        AgentPathKey.CLAUDE -> "Claude directory"
                    }
                    OutlinedTextField(
                        value = draft(key),
                        onValueChange = { drafts.value = drafts.value + (key to it) },
                        label = { Text(label) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            enabled = draft(key).isNotBlank() && busyMap[SettingsBusyKind.AGENT_PATHS] == null,
                            onClick = { savePath(key, draft(key).trim(), "$label save") },
                        ) { Text("Save path") }
                        OutlinedButton(
                            enabled = busyMap[SettingsBusyKind.AGENT_PATHS] == null,
                            onClick = { savePath(key, key.defaultPath, "$label reset") },
                        ) { Text("Reset to ${key.defaultPath}") }
                    }
                }
            }
        }
        pathMessage?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

        if (integration == null || integrationState == null) {
            Text(
                "No connected Settings target: verification and install are unavailable.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            return@Column
        }

        val snapshot = integrationState.snapshot
        val stale = snapshot != null && snapshot.pathRevision != pathsRevision
        val busy = integrationState.busy != null
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !busy, onClick = { scope.launch { integration.refresh(inputs()) } }) {
                Text(if (integrationState.busy == AgentIntegrationAction.REFRESH) "Verifying…" else "Verify paths and status")
            }
        }
        if (stale || integrationState.needsRefresh) {
            Text(
                "Earlier verification is out of date (paths or remote state changed). Verify again before installing.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        integrationState.message?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (snapshot == null || stale) {
            Text("Status unknown until verified.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }

        val paths = snapshot.paths
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Path verification (${snapshot.owner.connection.profileId})", style = MaterialTheme.typography.titleSmall)
                Text("OMP: ${paths.ompStatus} - ${if (paths.ompCanEnable) "can enable" else paths.ompReason ?: "cannot enable"}", style = MaterialTheme.typography.bodyMedium)
                Text("Codex: ${if (paths.codexCanEnable) "config readable" else paths.codexReason ?: "not usable"} (status only)", style = MaterialTheme.typography.bodyMedium)
                Text("Claude: ${if (paths.claudeCanEnable == true) "can enable" else paths.claudeReason ?: "not usable"}", style = MaterialTheme.typography.bodyMedium)
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("OMP extension", style = MaterialTheme.typography.titleSmall)
                Text("${snapshot.omp.status} - installed ${snapshot.omp.version ?: "none"}, bundled ${snapshot.omp.bundledVersion}", style = MaterialTheme.typography.bodyMedium)
                snapshot.omp.details?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy && integration != null, onClick = { integration?.let { pending = CapturedIntegrationExecution(it, PendingIntegrationAction.OmpInstall, inputs().omp, it.owner, settingsRepository.targetSelectionRevision) } }) { Text("Install") }
                    OutlinedButton(enabled = !busy && integration != null, onClick = { integration?.let { pending = CapturedIntegrationExecution(it, PendingIntegrationAction.OmpUninstall, inputs().omp, it.owner, settingsRepository.targetSelectionRevision) } }) { Text("Uninstall") }
                }
            }
        }

        listOf(AgentKind.CLAUDE to snapshot.claude, AgentKind.CODEX to snapshot.codex).forEach { (agent, report) ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${agent.name.lowercase().replaceFirstChar { it.uppercase() }} hooks", style = MaterialTheme.typography.titleSmall)
                    Text("${report.status} (${report.readiness}) - installed ${report.version ?: "none"}, bundled ${report.bundledVersion}", style = MaterialTheme.typography.bodyMedium)
                    if (agent == AgentKind.CODEX) {
                        Text("Codex hooks show lifecycle status only; they never enable terminal alerts.", style = MaterialTheme.typography.labelSmall)
                    }
                    report.details?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !busy && integration != null, onClick = { integration?.let { pending = CapturedIntegrationExecution(it, PendingIntegrationAction.HookInstall(agent), if (agent == AgentKind.CLAUDE) inputs().claude else inputs().codex, it.owner, settingsRepository.targetSelectionRevision) } }) { Text("Install") }
                        OutlinedButton(enabled = !busy && integration != null, onClick = { integration?.let { pending = CapturedIntegrationExecution(it, PendingIntegrationAction.HookUninstall(agent), if (agent == AgentKind.CLAUDE) inputs().claude else inputs().codex, it.owner, settingsRepository.targetSelectionRevision) } }) { Text("Uninstall") }
                    }
                }
            }
        }
    }
}

private data class CapturedIntegrationExecution(
    val repository: AgentIntegrationRepository,
    val action: PendingIntegrationAction,
    val agentDir: String?,
    val openingTarget: SettingsOwner,
    val openingRevision: Long,
)
