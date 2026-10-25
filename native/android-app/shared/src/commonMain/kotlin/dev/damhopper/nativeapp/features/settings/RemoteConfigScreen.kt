package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Structured editor of the selected Settings server's configuration (C01-C09): workspace name (root is
 * authoritative read-only), project rows with stable identity, type, env file, tags, services, custom commands
 * and terminal profiles, with required/duplicate validation. The raw JSON draft is supplemental. Editing never
 * executes anything; unknown config keys are preserved by the editor.
 */
@Composable
fun RemoteConfigScreen(
    editor: RemoteConfigEditor?,
    targetLabel: String,
    readOnlyReason: String?,
    modifier: Modifier = Modifier,
) {
    if (editor == null) {
        Text(
            readOnlyReason ?: "No connected Settings server; configuration is unavailable.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
        return
    }
    val state by editor.state.collectAsState()
    val structured by editor.structured.collectAsState()
    val loading by editor.isLoading.collectAsState()
    val outcome by editor.lastOutcome.collectAsState()
    val scope = rememberCoroutineScope()
    var showRaw by remember(editor) { mutableStateOf(false) }
    var message by remember(editor) { mutableStateOf<String?>(null) }

    LaunchedEffect(editor) {
        if (editor.state.value.baseConfigJson.isNullOrEmpty()) {
            editor.load()
        } else {
            editor.refresh()
        }
    }

    val editable = readOnlyReason == null && !state.isSaving
    val config = structured.config

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Server configuration", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        Text("Server: $targetLabel", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        readOnlyReason?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
        if (loading) Text("Loading…", style = MaterialTheme.typography.labelSmall)

        if (state.hasConflict) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("The server configuration changed while you had unsaved edits.", style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                        OutlinedButton(onClick = { editor.discardDraft() }) { Text("Reload server version") }
                        OutlinedButton(onClick = { editor.keepLocalDraft() }) { Text("Keep my draft") }
                        Button(enabled = editable && structured.canSave, onClick = {
                            scope.launch { message = editor.saveFullConfig(overwriteConflict = true).describe("Overwriting the server config") }
                        }) { Text("Overwrite server") }
                    }
                }
            }
        }

        structured.parseError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }

        if (config != null) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Workspace", style = MaterialTheme.typography.titleSmall)
                    ConfigField("Workspace name", config.workspaceName, editable, structured.issues.firstOrNull { it.field == "workspace.name" }?.message) { v ->
                        editor.updateStructured { it.copy(workspaceName = v) }
                    }
                    ConfigField("Workspace root (server-owned)", config.workspaceRoot, false, null) {}
                }
            }

            config.projects.forEach { project ->
                ProjectCard(editor, project, structured, editable, state.hasConflict) { label, outcomeText ->
                    message = "$label: $outcomeText"
                }
            }

            OutlinedButton(enabled = editable, onClick = {
                editor.updateStructured { cfg ->
                    cfg.copy(projects = cfg.projects + ConfigProject(editor.newRowId(), "", "", "custom"))
                }
            }) { Text("Add project") }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            Button(
                enabled = editable && state.isDirty && structured.canSave && !state.hasConflict,
                onClick = { scope.launch { message = editor.saveFullConfig().describe("Saving the server config") } },
            ) { Text(if (state.isSaving) "Saving…" else if (state.isDirty) "Save all *" else "Saved") }
            OutlinedButton(enabled = state.isDirty && !state.isSaving, onClick = { editor.discardDraft() }) { Text("Discard") }
            OutlinedButton(enabled = !state.isSaving && !loading, onClick = { scope.launch { editor.refresh() } }) { Text("Reload") }
        }
        if (structured.issues.isNotEmpty()) {
            Text("${structured.issues.size} field(s) need attention before saving.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
        (message ?: outcome?.describe("The last config action"))?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.lastError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }

        TextButton(onClick = { showRaw = !showRaw }) { Text(if (showRaw) "Hide raw JSON" else "Show raw JSON (advanced)") }
        if (showRaw) {
            OutlinedTextField(
                value = state.draftConfigJson ?: "",
                onValueChange = { editor.updateConfigDraft(it) },
                enabled = editable,
                modifier = Modifier.fillMaxWidth().height(280.dp),
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurface),
            )
        }
    }
}

@Composable
private fun ConfigField(label: String, value: String, enabled: Boolean, error: String?, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ProjectCard(
    editor: RemoteConfigEditor,
    project: ConfigProject,
    structured: StructuredConfigState,
    editable: Boolean,
    hasConflict: Boolean,
    report: (label: String, text: String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    fun issue(rowId: Long?, field: String) = structured.issues.firstOrNull { it.rowId == rowId && it.field == field }?.message

    fun edit(transform: (ConfigProject) -> ConfigProject) {
        editor.updateStructured { cfg ->
            cfg.copy(projects = cfg.projects.map { if (it.rowId == project.rowId) transform(it) else it })
        }
    }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(project.name.ifBlank { "New project" }, style = MaterialTheme.typography.titleSmall)
            ConfigField("Name", project.name, editable, issue(project.rowId, "name")) { v -> edit { it.copy(name = v) } }
            ConfigField("Path (server)", project.path, editable, issue(project.rowId, "path")) { v -> edit { it.copy(path = v) } }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                CONFIG_PROJECT_TYPES.forEach { type ->
                    FilterChip(
                        selected = project.type == type,
                        enabled = editable,
                        onClick = { edit { it.copy(type = type) } },
                        label = { Text(type) },
                    )
                }
            }
            issue(project.rowId, "type")?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
            ConfigField("Env file (optional, server path)", project.envFile, editable, null) { v -> edit { it.copy(envFile = v) } }

            Text("Tags", style = MaterialTheme.typography.labelMedium)
            project.tags.forEach { tag ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = tag.value,
                        onValueChange = { v -> edit { p -> p.copy(tags = p.tags.map { if (it.rowId == tag.rowId) it.copy(value = v) else it }) } },
                        singleLine = true,
                        enabled = editable,
                        isError = issue(tag.rowId, "tag") != null,
                        supportingText = issue(tag.rowId, "tag")?.let { { Text(it) } },
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(enabled = editable, onClick = { edit { p -> p.copy(tags = p.tags.filter { it.rowId != tag.rowId }) } }) { Text("Remove") }
                }
            }
            TextButton(enabled = editable, onClick = { edit { p -> p.copy(tags = p.tags + ConfigTag(editor.newRowId(), "")) } }) { Text("Add tag") }

            Text("Services", style = MaterialTheme.typography.labelMedium)
            project.services.forEach { svc ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    fun editSvc(t: (ConfigService) -> ConfigService) =
                        edit { p -> p.copy(services = p.services.map { if (it.rowId == svc.rowId) t(it) else it }) }
                    ConfigField("Service name", svc.name, editable, issue(svc.rowId, "service.name")) { v -> editSvc { it.copy(name = v) } }
                    ConfigField("Build command", svc.buildCommand, editable, null) { v -> editSvc { it.copy(buildCommand = v) } }
                    ConfigField("Run command", svc.runCommand, editable, null) { v -> editSvc { it.copy(runCommand = v) } }
                    TextButton(enabled = editable, onClick = { edit { p -> p.copy(services = p.services.filter { it.rowId != svc.rowId }) } }) { Text("Remove service") }
                }
            }
            TextButton(enabled = editable, onClick = { edit { p -> p.copy(services = p.services + ConfigService(editor.newRowId(), "")) } }) { Text("Add service") }

            Text("Custom commands (not run from here)", style = MaterialTheme.typography.labelMedium)
            project.commands.forEach { cmd ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    fun editCmd(t: (ConfigCommand) -> ConfigCommand) =
                        edit { p -> p.copy(commands = p.commands.map { if (it.rowId == cmd.rowId) t(it) else it }) }
                    ConfigField("Command name", cmd.name, editable, issue(cmd.rowId, "command.name")) { v -> editCmd { it.copy(name = v) } }
                    ConfigField("Command", cmd.command, editable, issue(cmd.rowId, "command.value")) { v -> editCmd { it.copy(command = v) } }
                    TextButton(enabled = editable, onClick = { edit { p -> p.copy(commands = p.commands.filter { it.rowId != cmd.rowId }) } }) { Text("Remove command") }
                }
            }
            TextButton(enabled = editable, onClick = { edit { p -> p.copy(commands = p.commands + ConfigCommand(editor.newRowId(), "", "")) } }) { Text("Add command") }

            Text("Terminal profiles (editing never starts a terminal)", style = MaterialTheme.typography.labelMedium)
            project.terminals.forEach { profile ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    fun editProfile(t: (ConfigTerminalProfile) -> ConfigTerminalProfile) =
                        edit { p -> p.copy(terminals = p.terminals.map { if (it.rowId == profile.rowId) t(it) else it }) }
                    ConfigField("Profile name", profile.name, editable, issue(profile.rowId, "terminal.name")) { v -> editProfile { it.copy(name = v) } }
                    ConfigField("Command", profile.command, editable, issue(profile.rowId, "terminal.command")) { v -> editProfile { it.copy(command = v) } }
                    ConfigField("Working directory (server)", profile.cwd, editable, issue(profile.rowId, "terminal.cwd")) { v -> editProfile { it.copy(cwd = v) } }
                    TextButton(enabled = editable, onClick = { edit { p -> p.copy(terminals = p.terminals.filter { it.rowId != profile.rowId }) } }) { Text("Remove profile") }
                }
            }
            TextButton(enabled = editable, onClick = { edit { p -> p.copy(terminals = p.terminals + ConfigTerminalProfile(editor.newRowId(), "", "", "")) } }) { Text("Add profile") }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                val originalName = structured.originalNames[project.rowId]
                OutlinedButton(
                    enabled = editable && !hasConflict && originalName != null && originalName == project.name &&
                        structured.issues.none { it.rowId == project.rowId },
                    onClick = { scope.launch { report("Saving project ${project.name}", editor.saveProject(project.rowId).describe("Save")) } },
                ) { Text("Save this project") }
                OutlinedButton(
                    enabled = editable,
                    onClick = { editor.updateStructured { cfg -> cfg.copy(projects = cfg.projects.filter { it.rowId != project.rowId }) } },
                ) { Text("Remove project") }
            }
            Text("A new, renamed or removed project is saved with Save all.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
