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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.features.workspace.KnownWorkspace
import dev.damhopper.nativeapp.features.workspace.KnownWorkspacesResponse
import dev.damhopper.nativeapp.features.workspace.WorkspaceRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Global defaults and the known-workspace registry of ONE selected Settings target (G01-G05). Paths are
 * remote server paths and stay remote. Defaults Set/Clear go through [RemoteConfigEditor] (exact payloads);
 * the registry reuses [WorkspaceRepository] with a request-local guard captured from the selected target.
 * The currently open workspace cannot be removed here, and a server rejection is shown verbatim.
 */
@Composable
fun GlobalSettingsView(
    editor: RemoteConfigEditor?,
    workspaceRepository: WorkspaceRepository?,
    mutationAuthority: HostMutationAuthority?,
    targetLabel: String,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val defaults = editor?.defaults?.collectAsState()?.value
    var registry by remember(workspaceRepository) { mutableStateOf<KnownWorkspacesResponse?>(null) }
    var loadError by remember(workspaceRepository) { mutableStateOf<String?>(null) }
    var defaultDraft by remember(editor) { mutableStateOf("") }
    var addPath by remember { mutableStateOf("") }
    var addName by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var pendingRemoval by remember { mutableStateOf<Pair<KnownWorkspace, HostMutationTicket>?>(null) }

    suspend fun reloadRegistry() {
        val repo = workspaceRepository ?: return
        try {
            registry = repo.listKnownWorkspaces()
            loadError = null
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Exception) {
            loadError = t.message ?: "Could not load known workspaces"
        }
    }

    LaunchedEffect(editor, workspaceRepository) {
        editor?.loadGlobalDefaults()
        reloadRegistry()
    }

    suspend fun registryMutation(
        label: String,
        ticket: HostMutationTicket?,
        request: suspend (RequestGuardHolder) -> Boolean,
    ) {
        val repo = workspaceRepository
        if (repo == null || ticket == null) {
            message = SettingsOutcome.NotSubmitted("The selected Settings server is unavailable or read-only.").describe(label)
            return
        }
        busy = true
        try {
            val guard = ticket.newGuard()
            val outcome = guardedConfirmation(guard) { request(RequestGuardHolder(guard)) }
            message = outcome.describe(label)
            if (outcome !is SettingsOutcome.NotSubmitted) reloadRegistry() // read-only refresh, never a replay
        } finally {
            busy = false
        }
    }

    pendingRemoval?.let { (target, ticket) ->
        AlertDialog(
            onDismissRequest = { pendingRemoval = null },
            title = { Text("Remove known workspace?") },
            text = { Text("Removes ${target.path} from the known-workspace list on $targetLabel. The folder itself is not deleted.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingRemoval = null
                    scope.launch {
                        registryMutation("Removing ${target.name}", ticket) { holder ->
                            workspaceRepository!!.removeKnownWorkspace(target.path, holder.guard)
                        }
                    }
                }) { Text("Remove") }
            },
            dismissButton = { TextButton(onClick = { pendingRemoval = null }) { Text("Cancel") } },
        )
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Global settings", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        Text("Server: $targetLabel. Paths are server paths.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Default workspace", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Text(
                    text = when {
                        editor == null -> "Unavailable: no connected Settings server."
                        defaults?.loaded != true -> "Loading…"
                        defaults?.workspace == null -> "No default workspace is set."
                        else -> "Current default: ${defaults?.workspace}"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                defaults?.error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                OutlinedTextField(
                    value = defaultDraft,
                    onValueChange = { defaultDraft = it },
                    label = { Text("Server path of the default workspace") },
                    singleLine = true,
                    enabled = editor != null,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = editor != null && defaultDraft.isNotBlank() && defaults?.busy != true,
                        onClick = {
                            scope.launch {
                                message = editor!!.setGlobalDefaultWorkspace(defaultDraft).describe("Setting the default workspace")
                            }
                        },
                    ) { Text("Set default") }
                    OutlinedButton(
                        enabled = editor != null && defaults?.workspace != null && defaults?.busy != true,
                        onClick = {
                            scope.launch { message = editor!!.clearGlobalDefaultWorkspace().describe("Clearing the default workspace") }
                        },
                    ) { Text("Clear default") }
                }
                Text(
                    "Clearing the default does not change the known-workspace list below.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Known workspaces", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                loadError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                val current = registry?.current
                registry?.workspaces?.forEach { workspace ->
                    val isCurrent = workspace.path == current
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(workspace.name + if (isCurrent) " (current)" else "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                            Text(workspace.path, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        OutlinedButton(
                            enabled = !isCurrent && !busy && mutationAuthority != null,
                            onClick = {
                                scope.launch {
                                    val ticket = workspaceRepository?.let { mutationAuthority?.capture(it.apiClient.connection) }
                                    if (ticket == null) {
                                        message = "Read-only: no Settings authority is attached."
                                    } else {
                                        pendingRemoval = Pair(workspace, ticket)
                                    }
                                }
                            },
                        ) { Text(if (isCurrent) "In use" else "Remove") }
                    }
                }
                if (registry != null && registry?.workspaces.isNullOrEmpty()) {
                    Text("No known workspaces.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(
                    value = addPath,
                    onValueChange = { addPath = it },
                    label = { Text("Server path to add") },
                    singleLine = true,
                    enabled = workspaceRepository != null,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = addName,
                    onValueChange = { addName = it },
                    label = { Text("Display name (optional)") },
                    singleLine = true,
                    enabled = workspaceRepository != null,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    enabled = workspaceRepository != null && mutationAuthority != null && addPath.isNotBlank() && !busy,
                    onClick = {
                        val path = addPath.trim()
                        val name = addName.trim().ifEmpty { null }
                        scope.launch {
                            val ticket = workspaceRepository?.let { mutationAuthority?.capture(it.apiClient.connection) }
                            registryMutation("Adding $path", ticket) { holder ->
                                workspaceRepository!!.addKnownWorkspace(path, name, holder.guard)
                            }
                            addPath = ""
                            addName = ""
                        }
                    },
                ) { Text("Add workspace") }
                if (mutationAuthority == null) {
                    Text("Read-only: no Settings authority is attached.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                }
            }
        }
        message?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** Carries the single-use guard of one registry mutation into its request lambda. */
private class RequestGuardHolder(val guard: dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard)
