package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The literal the user must type to enable a nuclear reset. */
const val NUCLEAR_RESET_CONFIRMATION = "RESET"

/** True only for the exact (trimmed, case-insensitive) confirmation literal. */
fun isNuclearResetConfirmed(typed: String): Boolean = typed.trim().uppercase() == NUCLEAR_RESET_CONFIRMATION

/**
 * Confirmation for importing workspace TOML. It names the exact captured target and payload size; the server
 * validates TOML, writes a timestamped backup and replaces the active configuration. The result is only
 * reported from the server's authoritative response.
 */
@Composable
fun ImportTomlConfirmDialog(
    targetLabel: String,
    targetEndpoint: String,
    payloadBytes: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Import workspace TOML?") },
        text = {
            Column {
                Text("Target server: $targetLabel ($targetEndpoint)", style = MaterialTheme.typography.bodyMedium)
                Text("File size: $payloadBytes bytes", style = MaterialTheme.typography.labelSmall)
                Text(
                    "The server validates the file, writes a timestamped backup and replaces the active workspace configuration. " +
                        "If the answer is lost or unclear the result is shown as unknown; nothing is retried automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Import") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Confirmation for clearing the selected target's server cache and re-validating its client queries. */
@Composable
fun ClearCacheConfirmDialog(
    targetLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Revalidate server cache?") },
        text = {
            Text(
                "Asks '$targetLabel' to reload its configuration and drops its cached query data. Open terminals stay connected; " +
                    "only this server's cached data is refetched.",
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Revalidate") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Destructive confirmation for the nuclear reset. It states precisely what is destroyed (running terminals and
 * live runtime workspace state on the server) and what is NOT (your saved preferences and credentials).
 */
@Composable
fun NuclearResetConfirmDialog(
    targetLabel: String,
    targetEndpoint: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    var typed by remember(targetLabel, targetEndpoint) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Reset server runtime state?", color = MaterialTheme.colorScheme.error) },
        text = {
            Column {
                Text("Target server: $targetLabel ($targetEndpoint)", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "This ends every running terminal process and clears the live runtime workspace state on that server. " +
                        "Your saved preferences and stored credentials are NOT reset. It cannot be undone; if the answer is lost " +
                        "the result is unknown and the reset is never repeated automatically.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text("Type $NUCLEAR_RESET_CONFIRMATION to confirm:", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
                OutlinedTextField(value = typed, onValueChange = { typed = it }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(enabled = isNuclearResetConfirmed(typed), onClick = onConfirm) {
                Text("Reset", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Scope confirmation before saving the LOCAL diagnostics document. */
@Composable
fun DiagnosticsExportConfirmDialog(
    scopeDescription: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Save local diagnostics?") },
        text = {
            Text(
                "Saves a JSON file you choose with: $scopeDescription. It contains no tokens, passwords, private paths, " +
                    "command history, raw commands or terminal output, and nothing is uploaded.",
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Choose file") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
