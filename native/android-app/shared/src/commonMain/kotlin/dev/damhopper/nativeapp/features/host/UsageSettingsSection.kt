package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** Receiver lifecycle as the web shows it: disabled / paused / active / unavailable (unknown until loaded). */
enum class UsageReceiverState { UNKNOWN, DISABLED, PAUSED, ACTIVE, UNAVAILABLE }

private fun JsonElement?.objectOrNull(key: String): JsonElement? = (this as? JsonObject)?.get(key)
private fun JsonElement?.boolOrNull(): Boolean? =
    (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

/** Derives the receiver state from the authoritative server setup/settings response (never from local guesses). */
fun usageReceiverState(uiState: UsageUiState): UsageReceiverState {
    val enabled = uiState.setup?.enabled ?: uiState.settings?.enabled ?: return UsageReceiverState.UNKNOWN
    val paused = uiState.setup?.paused ?: uiState.settings?.paused ?: false
    val runtime = uiState.setup?.runtime ?: uiState.settings?.runtime
    return when {
        !enabled -> UsageReceiverState.DISABLED
        paused -> UsageReceiverState.PAUSED
        runtime.objectOrNull("active").boolOrNull() == true -> UsageReceiverState.ACTIVE
        else -> UsageReceiverState.UNAVAILABLE
    }
}

/** The patch for the single primary receiver action of [state] (same semantics as the web Usage insights row). */
sealed interface UsageReceiverAction {
    val label: String

    data class Setup(override val label: String, val patch: SetupPatchRequest) : UsageReceiverAction
    data class Settings(override val label: String, val patch: SettingsPatchRequest) : UsageReceiverAction
}

fun usageReceiverPrimaryAction(state: UsageReceiverState): UsageReceiverAction? = when (state) {
    UsageReceiverState.UNKNOWN -> null
    UsageReceiverState.ACTIVE -> UsageReceiverAction.Setup("Disable", SetupPatchRequest(enabled = false))
    UsageReceiverState.PAUSED -> UsageReceiverAction.Settings("Resume", SettingsPatchRequest(paused = false))
    UsageReceiverState.UNAVAILABLE ->
        UsageReceiverAction.Setup("Retry receiver", SetupPatchRequest(enabled = true, retryCollector = true))
    UsageReceiverState.DISABLED -> UsageReceiverAction.Setup("Enable Codex Usage", SetupPatchRequest(enabled = true))
}

/**
 * Native Usage controls for ONE selected target server (receiver enable/disable/resume/retry, Codex exporter
 * setup toggle/status, retention and the usage-data destination). Every control is disabled with a visible
 * reason when [readOnlyReason] is set (disconnected/read-only capability); the last remote outcome is always
 * shown, including Unknown.
 */
@Composable
fun UsageSettingsSection(
    uiState: UsageUiState,
    targetLabel: String,
    readOnlyReason: String?,
    busy: Boolean,
    lastMessage: String?,
    onUpdateSettings: (SettingsPatchRequest) -> Unit,
    onUpdateSetup: (SetupPatchRequest) -> Unit,
    onOpenData: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val state = usageReceiverState(uiState)
    val setup = uiState.setup
    val settings = uiState.settings
    val exporter = setup?.collectorSetup?.codexExporter ?: settings?.collectorSetup?.codexExporter
    val restartRequired = (setup?.collectorSetup?.restartRequired ?: settings?.collectorSetup?.restartRequired) == true
    val enabledControls = readOnlyReason == null && !busy
    val collectorError = (setup?.runtime ?: settings?.runtime).objectOrNull("collectorError")
        .let { (it as? JsonPrimitive)?.contentOrNull }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Codex Usage telemetry", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Text("Server: $targetLabel", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (readOnlyReason != null) {
                Text(readOnlyReason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
            Text(
                text = when (state) {
                    UsageReceiverState.UNKNOWN -> "Receiver state is unknown until the server answers."
                    UsageReceiverState.DISABLED -> "Codex Usage is off on this server."
                    UsageReceiverState.PAUSED -> "Codex Usage is paused. Existing data remains available."
                    UsageReceiverState.ACTIVE -> "Codex Usage is active on this server."
                    UsageReceiverState.UNAVAILABLE -> "The Codex receiver is unavailable. Retry is explicit and manual."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (collectorError != null) {
                Text("Receiver error: $collectorError", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                usageReceiverPrimaryAction(state)?.let { action ->
                    Button(
                        enabled = enabledControls,
                        onClick = {
                            when (action) {
                                is UsageReceiverAction.Setup -> onUpdateSetup(action.patch)
                                is UsageReceiverAction.Settings -> onUpdateSettings(action.patch)
                            }
                        },
                    ) { Text(if (busy) "Updating…" else action.label) }
                }
                if (state == UsageReceiverState.ACTIVE) {
                    OutlinedButton(
                        enabled = enabledControls,
                        onClick = { onUpdateSetup(SetupPatchRequest(enabled = true, retryCollector = true)) },
                    ) { Text("Retry receiver") }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Codex exporter", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        text = when (exporter) {
                            CodexExporterStatus.MANAGED -> "Managed by DamHopper"
                            CodexExporterStatus.CONFLICT -> "Conflict: an unmanaged exporter is configured"
                            CodexExporterStatus.NOT_CONFIGURED -> "Not configured"
                            null -> "Unknown"
                        } + if (restartRequired) " - Codex restart required" else "",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = exporter == CodexExporterStatus.MANAGED,
                    enabled = enabledControls && exporter != null,
                    onCheckedChange = { on ->
                        onUpdateSetup(
                            if (on) SetupPatchRequest(enabled = true, codexExporter = true)
                            else SetupPatchRequest(codexExporter = false),
                        )
                    },
                )
            }

            Text(
                "Detail retention: ${settings?.detailRetentionDays?.let { "$it days" } ?: "unknown"}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(7, 30, 90, 180).forEach { days ->
                    val current = settings?.detailRetentionDays == days
                    OutlinedButton(
                        enabled = enabledControls && settings != null && !current,
                        onClick = { onUpdateSettings(SettingsPatchRequest(detailRetentionDays = days)) },
                        colors = ButtonDefaults.outlinedButtonColors(),
                    ) { Text("${days}d") }
                }
            }

            if (onOpenData != null) {
                OutlinedButton(onClick = onOpenData) { Text("Open usage data and deletion") }
            }
            if (lastMessage != null) {
                Text(lastMessage, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
