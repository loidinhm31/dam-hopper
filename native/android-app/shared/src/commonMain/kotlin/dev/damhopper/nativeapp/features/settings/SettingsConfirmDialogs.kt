package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Two-phase confirmation dialog for importing workspace TOML.
 * Freezes target profile, URL, generation, and payload byte size at invocation.
 */
@Composable
fun ImportTomlConfirmDialog(
    targetProfileName: String,
    targetProfileUrl: String,
    targetGeneration: Long?,
    payloadBytes: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Confirm Workspace TOML Import",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(10.dp))

                Text(
                    text = "Target Server: $targetProfileName ($targetProfileUrl)",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.Primary,
                    fontWeight = FontWeight.SemiBold,
                )

                if (targetGeneration != null) {
                    Text(
                        text = "Connection Generation: #$targetGeneration",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                }

                Text(
                    text = "Payload Size: $payloadBytes bytes (${payloadBytes / 1024} KB)",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(10.dp))

                Text(
                    text = "The server will validate TOML syntax, write a timestamped backup file, and atomically update the active workspace configuration. Stale connections will be safely rejected.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }

                    Button(
                        onClick = onConfirm,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Confirm & Apply", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/**
 * Confirmation dialog for clearing server-side query and index caches.
 */
@Composable
fun ClearCacheConfirmDialog(
    targetProfileName: String,
    targetGeneration: Long? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Clear Server Cache",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.Warning,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Are you sure you want to clear server-side caches and query indexes on '$targetProfileName'?",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                )
                if (targetGeneration != null) {
                    Text(
                        text = "Connection Generation: #$targetGeneration",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = "Active terminal connections will remain connected, but temporary search indexes and cached query metadata will be rebuilt.",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }

                    Button(
                        onClick = onConfirm,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Warning),
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Clear Cache", color = Color.Black, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/**
 * Two-phase destructive confirmation dialog for Nuclear Reset.
 * Requires explicit typed "RESET" confirmation before allowing execution.
 */
@Composable
fun NuclearResetConfirmDialog(
    targetProfileId: String = "",
    targetProfileName: String,
    targetProfileUrl: String,
    targetGeneration: Long? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    var confirmationText by remember(targetProfileId, targetGeneration) { mutableStateOf("") }
    val isConfirmed = confirmationText.trim().uppercase() == "RESET"

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .border(1.dp, DamHopperColors.Error, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Destructive Action: Nuclear Reset",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.Error,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Target: $targetProfileName ($targetProfileUrl)",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                )

                if (targetGeneration != null) {
                    Text(
                        text = "Connection Generation: #$targetGeneration",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = "Warning: This terminates all running terminal processes, unmounts managed sessions, and wipes active workspace runtime state on the server. Profile credentials in your local vault remain intact.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "Type 'RESET' below to confirm:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.Error,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(4.dp))

                OutlinedTextField(
                    value = confirmationText,
                    onValueChange = { confirmationText = it },
                    placeholder = { Text("RESET", color = DamHopperColors.TextSecondary) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                        focusedBorderColor = DamHopperColors.Error,
                        unfocusedBorderColor = DamHopperColors.Border,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(modifier = Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Cancel", color = DamHopperColors.TextSecondary)
                    }

                    Button(
                        onClick = onConfirm,
                        enabled = isConfirmed,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = DamHopperColors.Error,
                            disabledContainerColor = DamHopperColors.SurfaceVariant,
                        ),
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text(
                            "Execute Nuclear Reset",
                            color = if (isConfirmed) Color.White else DamHopperColors.TextSecondary,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}
