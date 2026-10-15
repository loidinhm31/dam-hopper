package dev.damhopper.nativeapp.features.files

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun CreateItemDialog(
    isDirectory: Boolean,
    parentPath: String,
    errorMessage: String? = null,
    onConfirm: (name: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    val title = if (isDirectory) "Create Directory" else "Create File"

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(title, style = DamHopperTypography.titleMedium, color = DamHopperColors.TextPrimary)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "In: ${parentPath.ifBlank { "Project Root" }}",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(errorMessage, style = DamHopperTypography.labelSmall, color = DamHopperColors.Error)
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { if (name.isNotBlank()) onConfirm(name.trim()) },
                        enabled = name.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    ) {
                        Text("Create")
                    }
                }
            }
        }
    }
}

@Composable
fun RenameItemDialog(
    currentName: String,
    errorMessage: String? = null,
    onConfirm: (newName: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(currentName) }

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Rename Item", style = DamHopperTypography.titleMedium, color = DamHopperColors.TextPrimary)
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("New Name") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(errorMessage, style = DamHopperTypography.labelSmall, color = DamHopperColors.Error)
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = { if (name.isNotBlank()) onConfirm(name.trim()) },
                        enabled = name.isNotBlank() && name != currentName,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    ) {
                        Text("Rename")
                    }
                }
            }
        }
    }
}

@Composable
fun DeleteConfirmDialog(
    path: String,
    isDirectory: Boolean,
    errorMessage: String? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val title = if (isDirectory) "Delete Directory" else "Delete File"

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(title, style = DamHopperTypography.titleMedium, color = DamHopperColors.Error)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Are you sure you want to permanently delete '$path'?",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                )
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(errorMessage, style = DamHopperTypography.labelSmall, color = DamHopperColors.Error)
                }
                Spacer(modifier = Modifier.height(16.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Button(
                        onClick = onConfirm,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                    ) {
                        Text("Delete")
                    }
                }
            }
        }
    }
}
