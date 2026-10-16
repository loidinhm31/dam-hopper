package dev.damhopper.nativeapp.features.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun SaveConflictDialog(
    filename: String,
    onReload: () -> Unit,
    onForceOverwrite: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier.fillMaxWidth().padding(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Save Conflict",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.Warning
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "The file '$filename' was modified on the server since you loaded it. Saving will overwrite the remote changes.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary
                )
                Spacer(modifier = Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = onReload,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
                    ) {
                        Text("Discard & Reload", color = DamHopperColors.Primary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = onForceOverwrite,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                    ) {
                        Text("Force Overwrite", color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }
    }
}
