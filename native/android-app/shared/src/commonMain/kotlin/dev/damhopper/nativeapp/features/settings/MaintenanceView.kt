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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

/** A bounded, strict-UTF-8 validated TOML file waiting for the user's explicit confirmation. */
class PendingTomlImport(val operation: SettingsOperation, val bytes: ByteArray)

/** An expected picker callback: the exact captured operation and kind it must carry. */
data class PendingDocument(val kind: SettingsDocumentKind, val operation: SettingsOperation)

data class DocumentWorkflowState(
    /** operationId -> expected callback; a callback is handled only when kind AND full operation match. */
    val pending: Map<Long, PendingDocument> = emptyMap(),
    val awaitingImport: PendingTomlImport? = null,
    val message: String? = null,
    val messageIsError: Boolean = false,
    /** Owner the message belongs to (null for local diagnostics); views show it only for that owner. */
    val messageOwner: SettingsOwner? = null,
    /** Authoritative server answer of the last confirmed import (never inferred locally). */
    val lastImport: SettingsImportResult? = null,
    val lastImportOwner: SettingsOwner? = null,
)

/**
 * Retained owner of the system-document flows (C2): export -> CreateDocument TOML, OpenDocument -> bounded
 * strict-UTF-8 TOML -> explicit confirmation -> guarded import, and CreateDocument diagnostics. Results are
 * matched to the exact captured [SettingsOperation] (token, kind and full identity) and handled once;
 * cancel/error/stale/mismatched callbacks never masquerade as saved and clean only their own token. Nothing
 * is retried and no rollback is claimed. Create it in a retained scope (not in composition) so a rotation
 * cannot orphan an open picker.
 */
class SettingsDocumentWorkflow(
    private val repository: SettingsRepository,
    private val port: SettingsDocumentPort,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(DocumentWorkflowState())
    val state: StateFlow<DocumentWorkflowState> = _state.asStateFlow()
    private val localTokens = MutableStateFlow(LOCAL_TOKEN_BASE)

    init {
        scope.launch { port.results.collect { handle(it) } }
    }

    private fun note(text: String, error: Boolean, owner: SettingsOwner?) =
        _state.update { it.copy(message = text, messageIsError = error, messageOwner = owner) }

    private fun register(operation: SettingsOperation, kind: SettingsDocumentKind) =
        _state.update { it.copy(pending = it.pending + (operation.operationId to PendingDocument(kind, operation))) }

    private fun unregister(token: Long) = _state.update { it.copy(pending = it.pending - token) }

    /** Atomically removes the token iff [result] carries the expected kind and the exact captured operation. */
    private fun take(result: SettingsDocumentResult): Boolean {
        var taken = false
        _state.update {
            val expected = it.pending[result.operation.operationId]
            if (expected != null && expected.kind == result.kind && expected.operation == result.operation) {
                taken = true
                it.copy(pending = it.pending - result.operation.operationId)
            } else {
                taken = false
                it
            }
        }
        return taken
    }

    fun dismissMessage() = _state.update { it.copy(message = null, messageIsError = false, messageOwner = null) }

    private fun launchPicker(operation: SettingsOperation, kind: SettingsDocumentKind, label: String, launch: () -> Unit) {
        register(operation, kind)
        try {
            launch()
        } catch (ce: CancellationException) {
            unregister(operation.operationId)
            throw ce
        } catch (t: Exception) {
            // A picker that could not even start must not leave a pending token blocking future actions.
            unregister(operation.operationId)
            note("$label could not start the system file picker: ${t.message ?: "unknown error"}", error = true, owner = operation.owner)
        }
    }

    /** Exports the target's workspace TOML (bounded server read), then asks the user where to save it. */
    fun exportToml(operation: SettingsOperation) {
        scope.launch {
            _state.update { it.copy(message = null, messageIsError = false, messageOwner = null) }
            when (val outcome = repository.exportWorkspaceToml(operation)) {
                is SettingsOutcome.Confirmed ->
                    launchPicker(operation, SettingsDocumentKind.CREATE_TOML, "Saving the workspace TOML") {
                        port.createDocument(operation, "dam-hopper.toml", "application/toml", outcome.value)
                    }
                else -> note(outcome.describe("Exporting the workspace TOML"), error = true, owner = operation.owner)
            }
        }
    }

    /** Opens the system picker; the chosen file is only read by the platform up to the 1 MiB ceiling + 1. */
    fun importToml(operation: SettingsOperation) {
        _state.update { it.copy(message = null, messageIsError = false, messageOwner = null, awaitingImport = null) }
        launchPicker(operation, SettingsDocumentKind.OPEN_TOML, "Choosing a TOML file") { port.openToml(operation) }
    }

    /** Local diagnostics only (allowlisted bytes): no server operation is involved. */
    fun exportDiagnostics(bytes: ByteArray, fileName: String) {
        var token = 0L
        localTokens.update { token = it + 1; token }
        val local = SettingsOperation(
            scope = SettingsScope.PREFERENCE_SOURCE,
            owner = SettingsOwner(ConnectionRef("local-diagnostics", 0L), "local", "local"),
            selectionRevision = 0L,
            editRevision = 0L,
            operationId = token,
        )
        _state.update { it.copy(message = null, messageIsError = false, messageOwner = null) }
        launchPicker(local, SettingsDocumentKind.CREATE_DIAGNOSTICS, "Saving diagnostics") {
            port.createDocument(local, fileName, SettingsDiagnostics.MIME_TYPE, bytes)
        }
    }

    fun cancelImport() = _state.update { it.copy(awaitingImport = null) }

    /** Submits the confirmed import through the request-local guard; shows only the authoritative answer. */
    fun confirmImport() {
        // Atomic single consumption: concurrent confirms can never both submit the same payload.
        var taken: PendingTomlImport? = null
        _state.update {
            taken = it.awaitingImport
            it.copy(awaitingImport = null)
        }
        val pending = taken ?: return
        scope.launch {
            val outcome = repository.importWorkspaceToml(pending.operation, pending.bytes)
            if (outcome is SettingsOutcome.Confirmed) {
                val result = outcome.value
                _state.update {
                    it.copy(
                        lastImport = result,
                        lastImportOwner = pending.operation.owner,
                        message = "Import confirmed by the server: ${result.fileName}; backup ${result.backupFileName}" +
                            (result.workspaceName?.let { name -> "; workspace $name" } ?: "") + ".",
                        messageIsError = false,
                        messageOwner = pending.operation.owner,
                    )
                }
            } else {
                note(outcome.describe("Importing the workspace TOML"), error = true, owner = pending.operation.owner)
            }
        }
    }

    private suspend fun handle(result: SettingsDocumentResult) {
        if (!take(result)) return // stale/duplicate/mismatched/unknown callback: discarded
        when (result.kind) {
            SettingsDocumentKind.OPEN_TOML -> handleOpen(result)
            SettingsDocumentKind.CREATE_TOML ->
                reportCreate(result, "The workspace TOML was saved to the file you chose.", "Saving the workspace TOML", result.operation.owner)
            SettingsDocumentKind.CREATE_DIAGNOSTICS ->
                reportCreate(result, "Local diagnostics were saved to the file you chose.", "Saving diagnostics", null)
        }
    }

    private fun reportCreate(result: SettingsDocumentResult, success: String, label: String, owner: SettingsOwner?) {
        when {
            result.cancelled -> note("$label was cancelled; nothing was saved.", error = false, owner = owner)
            result.error != null -> note("$label failed: ${result.error}", error = true, owner = owner)
            result.saved -> note(success, error = false, owner = owner)
            else -> note("$label did not complete; nothing is reported as saved.", error = true, owner = owner)
        }
    }

    private suspend fun handleOpen(result: SettingsDocumentResult) {
        val bytes = result.bytes
        val owner = result.operation.owner
        when {
            result.cancelled -> note("Choosing a file was cancelled; nothing was sent.", error = false, owner = owner)
            result.error != null -> note("Could not read the file: ${result.error}", error = true, owner = owner)
            bytes == null -> note("The file could not be read; nothing was sent.", error = true, owner = owner)
            bytes.size > MAX_CONFIG_IMPORT_BYTES -> note("The file is larger than the 1 MiB import limit; nothing was sent.", error = true, owner = owner)
            !isStrictUtf8(bytes) -> note("The file is not valid UTF-8 text; nothing was sent.", error = true, owner = owner)
            !repository.isCurrent(result.operation) -> note("The Settings server changed while choosing the file; nothing was sent.", error = true, owner = owner)
            else -> _state.update { it.copy(awaitingImport = PendingTomlImport(result.operation, bytes)) }
        }
    }

    private fun isStrictUtf8(bytes: ByteArray): Boolean = try {
        bytes.decodeToString(throwOnInvalidSequence = true)
        true
    } catch (_: Exception) {
        false
    }

    private companion object {
        const val LOCAL_TOKEN_BASE = 1L shl 52
    }
}

@Composable
private fun ActionCard(title: String, description: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}

/**
 * Import/Export and maintenance of the selected Settings target (S01, M01-M06). The target is an independent
 * selection (never the currently viewed workspace). Cache revalidation and reset are target-qualified;
 * [departureGuard] is the app's dirty-state guard and runs BEFORE a reset is admitted; an Unknown reset never
 * navigates. [onTargetRevalidated] lets retained consumers refetch only that target's queries.
 */
@Composable
fun MaintenanceView(
    settingsRepository: SettingsRepository,
    availableProfiles: List<ServerProfile>,
    workflow: SettingsDocumentWorkflow?,
    diagnosticsInput: () -> SettingsDiagnosticsInput,
    departureGuard: suspend () -> Boolean,
    onTargetRevalidated: (profileId: String) -> Unit,
    onResetConfirmed: (profileId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val sourceTarget by settingsRepository.sourceTargetState.collectAsState()
    val busy by settingsRepository.busy.collectAsState()
    val ownerStatus by settingsRepository.ownerStatus.collectAsState()
    val importExport by settingsRepository.importExportState.collectAsState()
    val docs = workflow?.state?.collectAsState()?.value
    val scope = rememberCoroutineScope()
    var cachePending by remember { mutableStateOf<SettingsOperation?>(null) }
    var resetPending by remember { mutableStateOf<SettingsOperation?>(null) }
    var confirmDiagnostics by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    val targetId = sourceTarget.settingsProfileId
    val target = availableProfiles.firstOrNull { it.id == targetId }
    val targetLabel = target?.name ?: "none selected"
    val targetEndpoint = target?.baseUrl ?: ""
    val anyBusy = busy.keys.any { it.scope == SettingsScope.SETTINGS_TARGET } || docs?.pending?.isNotEmpty() == true
    val hasTarget = target != null
    val lastStatus = ownerStatus.entries.filter { it.key.connection.profileId == targetId }
        .map { it.value }.maxByOrNull { it.operationId }

    suspend fun captureTarget(label: String): SettingsOperation? {
        val op = settingsRepository.captureOperation(SettingsScope.SETTINGS_TARGET)
        if (op == null) message = SettingsOutcome.NotSubmitted("The selected server is not connected.").describe(label)
        return op
    }

    docs?.awaitingImport?.let { pending ->
        ImportTomlConfirmDialog(
            targetLabel = availableProfiles.firstOrNull { it.id == pending.operation.owner.connection.profileId }?.name ?: "server",
            targetEndpoint = pending.operation.owner.endpoint,
            payloadBytes = pending.bytes.size,
            onConfirm = { workflow?.confirmImport() },
            onDismiss = { workflow?.cancelImport() },
        )
    }
    cachePending?.let { op ->
        ClearCacheConfirmDialog(
            targetLabel = availableProfiles.firstOrNull { it.id == op.owner.connection.profileId }?.name ?: "server",
            onConfirm = {
                cachePending = null
                scope.launch {
                    // The SAME captured operation is submitted; a reconnect/account change while the dialog was
                    // open makes admission reject it (NotSubmitted) instead of authorizing a new owner.
                    val outcome = settingsRepository.clearCache(op)
                    message = outcome.describe("Revalidating the server cache")
                    if (outcome is SettingsOutcome.Confirmed && settingsRepository.isCurrent(op)) {
                        onTargetRevalidated(op.owner.connection.profileId)
                    }
                }
            },
            onDismiss = { cachePending = null },
        )
    }
    resetPending?.let { op ->
        NuclearResetConfirmDialog(
            targetLabel = availableProfiles.firstOrNull { it.id == op.owner.connection.profileId }?.name ?: "server",
            targetEndpoint = op.owner.endpoint,
            onConfirm = {
                resetPending = null
                scope.launch {
                    val outcome = settingsRepository.nuclearReset(op)
                    message = outcome.describe("Resetting the server runtime state")
                    // Only a confirmed reset of the still-current target may navigate; Unknown never does.
                    if (outcome is SettingsOutcome.Confirmed && settingsRepository.isCurrent(op)) {
                        onResetConfirmed(op.owner.connection.profileId)
                    }
                }
            },
            onDismiss = { resetPending = null },
        )
    }
    if (confirmDiagnostics) {
        DiagnosticsExportConfirmDialog(
            scopeDescription = "this device's preferences, shortcuts, notification policy and notification status",
            onConfirm = {
                confirmDiagnostics = false
                val input = diagnosticsInput()
                workflow?.exportDiagnostics(SettingsDiagnostics.build(input), SettingsDiagnostics.suggestedFileName(input.generatedAtMs))
            },
            onDismiss = { confirmDiagnostics = false },
        )
    }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ActionCard(
            "Target server",
            "Administrative actions below go to this server only. It is independent of the preference source and of the workspace you are viewing.",
        ) {
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                availableProfiles.forEach { profile ->
                    FilterChip(
                        selected = targetId == profile.id,
                        onClick = { settingsRepository.setSettingsTarget(profile.id) },
                        label = { Text(profile.name) },
                    )
                }
            }
            if (targetId != null && target == null) {
                Text("The selected server no longer exists. Choose another.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            if (!hasTarget) {
                Text("Select a server to enable these actions.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            lastStatus?.let {
                Text(
                    "Last action on this server: ${it.outcome.name.lowercase().replace('_', ' ')} - ${it.message}",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (it.outcome == SettingsOutcomeKind.UNKNOWN) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        ActionCard(
            "Workspace configuration file",
            "Export saves the server's TOML to a file you choose (max 1 MiB). Import validates a chosen UTF-8 file locally, asks you to confirm, then the server writes a backup and applies it.",
        ) {
            val pickerAvailable = workflow != null
            if (!pickerAvailable) {
                Text("The system document picker is not available in this view.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                Button(
                    enabled = hasTarget && pickerAvailable && !anyBusy,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    onClick = { scope.launch { captureTarget("Exporting the workspace TOML")?.let { workflow?.exportToml(it) } } },
                ) { Text(if (importExport.isExporting) "Exporting…" else "Export TOML") }
                OutlinedButton(
                    enabled = hasTarget && pickerAvailable && !anyBusy,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    onClick = { scope.launch { captureTarget("Choosing a TOML file")?.let { workflow?.importToml(it) } } },
                ) { Text(if (importExport.isImporting) "Importing…" else "Import TOML...") }
            }
            val shown = docs
            val ownedByTarget: (SettingsOwner?) -> Boolean = { it == null || it.connection.profileId == targetId }
            if (shown?.lastImport != null && ownedByTarget(shown.lastImportOwner)) {
                Text(
                    "Last confirmed import: ${shown.lastImport.fileName} (backup ${shown.lastImport.backupFileName})",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (shown?.message != null && ownedByTarget(shown.messageOwner)) {
                Text(
                    shown.message,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (shown.messageIsError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            importExport.lastError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
        }

        ActionCard("Server cache", "Revalidates the selected server's cached data and refetches only that server's queries on this device.") {
            OutlinedButton(
                enabled = hasTarget && !anyBusy,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                onClick = { scope.launch { cachePending = captureTarget("Revalidating the server cache") } },
            ) { Text(if (busy.containsKey(SettingsBusyKind.CLEAR_CACHE)) "Revalidating…" else "Revalidate cache...") }
        }

        ActionCard(
            "Reset server runtime state",
            "Ends every running terminal and clears live runtime workspace state on the selected server. Saved preferences are not reset.",
        ) {
            OutlinedButton(
                enabled = hasTarget && !anyBusy,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                onClick = {
                    scope.launch {
                        // The dirty-state guard runs before anything is admitted; Cancel stops here.
                        val proceed = departureGuard()
                        if (proceed) resetPending = captureTarget("Resetting the server")
                    }
                },
            ) { Text(if (busy.containsKey(SettingsBusyKind.RESET)) "Resetting…" else "Reset...") }
        }

        ActionCard(
            "Local diagnostics",
            "Saves an allowlisted JSON file of this device's settings state. No server data, secrets, private paths, command history or terminal output.",
        ) {
            OutlinedButton(
                enabled = workflow != null && docs?.pending?.isNotEmpty() != true,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                onClick = { confirmDiagnostics = true },
            ) { Text("Save diagnostics...") }
        }

        message?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
