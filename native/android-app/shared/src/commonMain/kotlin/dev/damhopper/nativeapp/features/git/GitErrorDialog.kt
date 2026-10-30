package dev.damhopper.nativeapp.features.git

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitErrorDialog(
    error: GitActionResult,
    onDismiss: () -> Unit,
) {
    val titleText = if (error.blockedReason != null) "Blocked: ${error.blockedReason}" else if (error.conflict) "Conflict Detected" else "Git Operation Failed"
    val messageText = listOfNotNull(error.message, error.recommendation).joinToString("\n\n")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(titleText, style = DamHopperTypography.titleMedium, color = DamHopperColors.Error) },
        text = { Text(messageText.ifBlank { "Operation failed" }, style = DamHopperTypography.bodySmall) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } }
    )
}
