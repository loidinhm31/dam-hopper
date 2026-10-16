package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

/**
 * Screen for viewing and editing remote server configuration and allowlisted UI preferences.
 */
@Composable
fun RemoteConfigScreen(
    editor: RemoteConfigEditor,
    modifier: Modifier = Modifier,
) {
    val state by editor.state.collectAsState()
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .verticalScroll(scrollState)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Section Header
        Text(
            text = "Remote Configuration & UI Preferences",
            color = DamHopperColors.TextPrimary,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold
        )

        // Conflict Warning Banner
        if (state.hasConflict) {
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Error.copy(alpha = 0.15f)),
                shape = RoundedCornerShape(6.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "External Conflict Detected",
                        color = DamHopperColors.Error,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp
                    )
                    Text(
                        text = "The server configuration was updated externally while you had unsaved edits. Discard your draft to reload, or overwrite to force your changes.",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 11.sp
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { editor.discardDraft() },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
                        ) {
                            Text("Discard Local Draft", color = DamHopperColors.TextPrimary, fontSize = 11.sp)
                        }
                        Button(
                            onClick = { scope.launch { editor.saveFullConfig() } },
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                        ) {
                            Text("Overwrite Server", fontSize = 11.sp)
                        }
                    }
                }
            }
        }

        // Section 1: UI Preferences
        Card(
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Global UI Preferences",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )

                val prefs = state.uiPreferencesDraft
                OutlinedTextField(
                    value = prefs.terminalFontSize?.toString() ?: "",
                    onValueChange = {
                        val num = it.toIntOrNull()
                        editor.updateUiPreferencesDraft(prefs.copy(terminalFontSize = num))
                    },
                    label = { Text("Terminal Font Size (pt)") },
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = prefs.editorFontSize?.toString() ?: "",
                    onValueChange = {
                        val num = it.toIntOrNull()
                        editor.updateUiPreferencesDraft(prefs.copy(editorFontSize = num))
                    },
                    label = { Text("Editor Font Size (pt)") },
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = prefs.systemFontSize?.toString() ?: "",
                    onValueChange = {
                        val num = it.toIntOrNull()
                        editor.updateUiPreferencesDraft(prefs.copy(systemFontSize = num))
                    },
                    label = { Text("System Font Size (pt)") },
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = prefs.cognitoModeStyle ?: "heavy-blur",
                    onValueChange = {
                        editor.updateUiPreferencesDraft(prefs.copy(cognitoModeStyle = it))
                    },
                    label = { Text("Cognito Mode Style ('heavy-blur' | 'black-screen')") },
                    modifier = Modifier.fillMaxWidth()
                )

                Button(
                    onClick = { scope.launch { editor.saveUiPreferences() } },
                    enabled = state.isUiPreferencesDirty && !state.isSaving,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Accent),
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text(if (state.isUiPreferencesDirty) "Save UI Preferences *" else "UI Preferences Saved")
                }
            }
        }

        // Section 2: Complete Config Document
        Card(
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "dam-hopper.toml (Server Configuration)",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (state.isDirty) {
                        Text(
                            text = "[MODIFIED]",
                            color = DamHopperColors.Warning,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                OutlinedTextField(
                    value = state.draftConfigJson ?: "",
                    onValueChange = { editor.updateConfigDraft(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(280.dp),
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = DamHopperColors.TextPrimary
                    )
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (state.isDirty) {
                        OutlinedButton(
                            onClick = { editor.discardDraft() },
                            modifier = Modifier.padding(end = 8.dp)
                        ) {
                            Text("Discard")
                        }
                    }
                    Button(
                        onClick = { scope.launch { editor.saveFullConfig() } },
                        enabled = state.isDirty && !state.isSaving && !state.hasConflict,
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Accent)
                    ) {
                        Text(if (state.isSaving) "Saving..." else "Save Full Config")
                    }
                }
            }
        }
    }
}
