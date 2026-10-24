package dev.damhopper.nativeapp.features.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.logging.AppLogger
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val jsonFormatter = Json {
    prettyPrint = true
    ignoreUnknownKeys = true
}

/**
 * Mobile-friendly diagnostics dialog displaying recent terminal & transport events.
 * Scoped strictly to the active profile and session. Never reveals terminal contents.
 */
@Composable
fun TerminalDiagnosticsDialog(
    profileId: String?,
    generation: Long? = null,
    sessionId: String?,
    onDismiss: () -> Unit,
) {
    val clipboardManager = LocalClipboardManager.current
    var copiedNotice by remember { mutableStateOf(false) }
    var refreshEpoch by remember { mutableStateOf(0) }

    val snapshot = remember(profileId, generation, sessionId, refreshEpoch) {
        AppLogger.getDiagnosticsSnapshot(profileId, generation, sessionId)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(
                    text = "Terminal Diagnostics",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "Profile: ${profileId ?: "all"}${if (generation != null) " (gen $generation)" else ""} | Session: ${sessionId ?: "all"} | Events: ${snapshot.entries.size}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                )
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(360.dp),
            ) {
                if (copiedNotice) {
                    Text(
                        text = "Diagnostics JSON copied to clipboard!",
                        color = DamHopperColors.Success,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }

                if (snapshot.entries.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No diagnostic events recorded yet.",
                            color = DamHopperColors.TextSecondary,
                            fontSize = 12.sp,
                        )
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.Background)
                            .padding(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(snapshot.entries.reversed()) { entry ->
                            DiagnosticEntryRow(entry)
                        }
                    }
                }
            }
        },
        confirmButton = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(
                    onClick = { refreshEpoch++ },
                ) {
                    Text("Refresh", color = DamHopperColors.Secondary, fontSize = 12.sp)
                }

                TextButton(
                    onClick = {
                        val jsonText = jsonFormatter.encodeToString(snapshot)
                        clipboardManager.setText(AnnotatedString(jsonText))
                        copiedNotice = true
                    },
                ) {
                    Text("Copy JSON", color = DamHopperColors.Primary, fontSize = 12.sp)
                }

                TextButton(
                    onClick = {
                        AppLogger.clearDiagnostics(profileId)
                        refreshEpoch++
                    },
                ) {
                    Text("Clear", color = DamHopperColors.Warning, fontSize = 12.sp)
                }

                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                ) {
                    Text("Close", color = DamHopperColors.Background, fontSize = 12.sp)
                }
            }
        },
    )
}
