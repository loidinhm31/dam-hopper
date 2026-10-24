package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitResetDialog(
    entry: GitLogEntry,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var mode by remember { mutableStateOf("mixed") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Reset to Commit", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text("Reset HEAD to commit ${entry.hash.take(7)}: ${entry.message}", style = DamHopperTypography.bodySmall)
                Spacer(modifier = Modifier.height(8.dp))
                Text("Mode:", style = DamHopperTypography.labelSmall)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("soft", "mixed", "hard").forEach { m ->
                        Button(
                            onClick = { mode = m },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (mode == m) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                            ),
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(m, fontSize = 11.sp)
                        }
                    }
                }
                if (mode == "hard") {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Warning: 'hard' reset discards all working tree and staged changes!", color = DamHopperColors.Error, style = DamHopperTypography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(mode) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (mode == "hard") DamHopperColors.Error else DamHopperColors.Primary
                )
            ) {
                Text("Reset")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
fun GitConfirmSimpleDialog(
    title: String,
    message: String,
    confirmLabel: String,
    isDestructive: Boolean = false,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = DamHopperTypography.titleMedium) },
        text = { Text(message, style = DamHopperTypography.bodySmall) },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isDestructive) DamHopperColors.Error else DamHopperColors.Primary
                )
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
