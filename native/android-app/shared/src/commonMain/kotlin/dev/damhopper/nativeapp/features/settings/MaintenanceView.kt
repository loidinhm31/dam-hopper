package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

/**
 * Screen presenting Import / Export, Configuration synchronization, and Server Maintenance controls.
 * Strictly adheres to 0 FABs, zero browser engines, 1 MiB import ceiling, and DamHopperColors dark workbench theme.
 */
@Composable
fun MaintenanceView(
    settingsRepository: SettingsRepository,
    availableProfiles: List<ServerProfile>,
    modifier: Modifier = Modifier,
) {
    val sourceTargetState by settingsRepository.sourceTargetState.collectAsState()
    val importExportState by settingsRepository.importExportState.collectAsState()
    val coroutineScope = rememberCoroutineScope()
    val clipboardManager = LocalClipboardManager.current
    val scrollState = rememberScrollState()

    var tomlInputText by remember { mutableStateOf("") }
    var operationFeedback by remember { mutableStateOf<String?>(null) }
    var isFeedbackError by remember { mutableStateOf(false) }

    // Immutable captured confirmation contexts
    var pendingImportContext by remember { mutableStateOf<CapturedConfirmationContext?>(null) }
    var pendingClearCacheContext by remember { mutableStateOf<CapturedConfirmationContext?>(null) }
    var pendingNuclearResetContext by remember { mutableStateOf<CapturedConfirmationContext?>(null) }
    // Target Server Profile resolution
    val currentTargetId = sourceTargetState.settingsProfileId
    val currentTargetProfile = availableProfiles.firstOrNull { it.id == currentTargetId }

    val tomlBytes = tomlInputText.encodeToByteArray().size
    val isTomlOverLimit = tomlBytes > MAX_CONFIG_IMPORT_BYTES

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .verticalScroll(scrollState)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Feedback Banner
        if (operationFeedback != null) {
            Card(
                shape = RoundedCornerShape(6.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (isFeedbackError) DamHopperColors.Error.copy(alpha = 0.15f) else DamHopperColors.Success.copy(alpha = 0.15f),
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, if (isFeedbackError) DamHopperColors.Error else DamHopperColors.Success, RoundedCornerShape(6.dp)),
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = operationFeedback!!,
                        color = if (isFeedbackError) DamHopperColors.Error else DamHopperColors.Success,
                        style = DamHopperTypography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = { operationFeedback = null },
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Dismiss", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
                    }
                }
            }
        }

        // 1. Settings Target Server Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Settings Target Server",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Select the server whose workspace configuration, TOML import/export, and maintenance operations are controlled.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    availableProfiles.forEach { profile ->
                        val isSelected = currentTargetId == profile.id
                        Box(
                            modifier = Modifier
                                .defaultMinSize(minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    settingsRepository.setSettingsTarget(profile.id)
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column {
                                Text(
                                    text = profile.name,
                                    color = if (isSelected) Color.Black else DamHopperColors.TextPrimary,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 12.sp,
                                )
                                Text(
                                    text = profile.baseUrl,
                                    color = if (isSelected) Color.DarkGray else DamHopperColors.TextSecondary,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }
                    }
                }

                if (currentTargetProfile != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Active Target: ${currentTargetProfile.name} • ${currentTargetProfile.baseUrl}",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Primary,
                    )
                } else {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "No target selected. Select a profile above to perform configuration or maintenance actions.",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.Warning,
                    )
                }
            }
        }

        // 2. Export Workspace TOML Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Export Workspace Configuration (TOML)",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Download or inspect raw workspace.toml configuration from the selected target server.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Button(
                    onClick = {
                        val profileId = currentTargetId
                        if (profileId == null) {
                            operationFeedback = "Please select a target server first."
                            isFeedbackError = true
                            return@Button
                        }
                        coroutineScope.launch {
                            val result = settingsRepository.exportWorkspaceToml(profileId)
                            if (result.isSuccess) {
                                operationFeedback = "Workspace TOML exported successfully (${result.getOrNull()?.length ?: 0} characters)."
                                isFeedbackError = false
                            } else {
                                operationFeedback = "Export failed: ${result.exceptionOrNull()?.message}"
                                isFeedbackError = true
                            }
                        }
                    },
                    enabled = currentTargetId != null && !importExportState.isExporting,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(
                        text = if (importExportState.isExporting) "Exporting from server..." else "Export Workspace TOML",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }

                if (importExportState.lastExportedToml != null) {
                    Spacer(modifier = Modifier.height(14.dp))
                    val exportedToml = importExportState.lastExportedToml!!
                    val lineCount = exportedToml.lines().size
                    val byteCount = exportedToml.encodeToByteArray().size

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Exported TOML ($lineCount lines • $byteCount bytes):",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.TextPrimary,
                        )

                        TextButton(
                            onClick = {
                                clipboardManager.setText(AnnotatedString(exportedToml))
                                operationFeedback = "TOML copied to clipboard."
                                isFeedbackError = false
                            },
                            modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                        ) {
                            Text("Copy TOML", color = DamHopperColors.Primary, fontSize = 12.sp)
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(DamHopperColors.Background)
                            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                            .verticalScroll(rememberScrollState())
                            .padding(10.dp),
                    ) {
                        Text(
                            text = exportedToml,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            color = DamHopperColors.TextPrimary,
                        )
                    }
                }
            }
        }

        // 3. Import Workspace TOML Card (1 MiB Ceiling & Confirmation)
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Import Workspace Configuration (TOML)",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Imports configuration to the target server. Enforces a strict 1 MiB boundary (1,048,576 bytes). Server validates syntax, creates a backup file, and atomically updates settings.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(12.dp))

                // TOML Text Input
                OutlinedTextField(
                    value = tomlInputText,
                    onValueChange = { tomlInputText = it },
                    placeholder = {
                        Text(
                            text = "# Paste workspace.toml content here\n[workspace]\nname = \"DamHopper Project\"\n",
                            color = DamHopperColors.TextSecondary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                        )
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(160.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                        focusedBorderColor = if (isTomlOverLimit) DamHopperColors.Error else DamHopperColors.Primary,
                        unfocusedBorderColor = if (isTomlOverLimit) DamHopperColors.Error else DamHopperColors.Border,
                    ),
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                    ),
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Live Byte Counter & Meter
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Size: $tomlBytes / $MAX_CONFIG_IMPORT_BYTES bytes",
                        style = DamHopperTypography.labelSmall,
                        color = if (isTomlOverLimit) DamHopperColors.Error else DamHopperColors.TextSecondary,
                        fontWeight = if (isTomlOverLimit) FontWeight.Bold else FontWeight.Normal,
                    )

                    if (isTomlOverLimit) {
                        Text(
                            text = "⚠ EXCEEDS 1 MiB CEILING",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.Error,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Import Button with Confirmation Trigger
                Button(
                    onClick = {
                        val target = currentTargetProfile
                        if (target == null) {
                            operationFeedback = "Please select a target server first."
                            isFeedbackError = true
                            return@Button
                        }
                        if (tomlInputText.isBlank()) {
                            operationFeedback = "Please enter or paste TOML content."
                            isFeedbackError = true
                            return@Button
                        }
                        if (isTomlOverLimit) {
                            operationFeedback = "File exceeds 1 MiB limit."
                            isFeedbackError = true
                            return@Button
                        }
                        val gen = settingsRepository.getTargetConnectionGeneration(target.id)
                        pendingImportContext = CapturedConfirmationContext(
                            profileId = target.id,
                            profileName = target.name,
                            profileUrl = target.baseUrl,
                            generation = gen,
                            tomlPayload = tomlInputText,
                            payloadBytes = tomlBytes,
                        )
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(
                        text = if (importExportState.isImporting) "Importing configuration..." else "Import Configuration...",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }

                // Import Result Display
                if (importExportState.lastImportResult != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    val res = importExportState.lastImportResult!!
                    Card(
                        shape = RoundedCornerShape(6.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (res.ok) DamHopperColors.Success.copy(alpha = 0.15f) else DamHopperColors.Error.copy(alpha = 0.15f),
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, if (res.ok) DamHopperColors.Success else DamHopperColors.Error, RoundedCornerShape(6.dp))
                            .padding(8.dp),
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Text(
                                text = if (res.ok) "Import Succeeded" else "Import Failed",
                                color = if (res.ok) DamHopperColors.Success else DamHopperColors.Error,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                            )
                            if (res.backupFileName != null) {
                                Text(
                                    text = "Backup created: ${res.backupFileName}",
                                    style = DamHopperTypography.labelSmall,
                                    color = DamHopperColors.TextPrimary,
                                )
                            }
                            if (res.error != null) {
                                Text(
                                    text = "Error: ${res.error}",
                                    style = DamHopperTypography.labelSmall,
                                    color = DamHopperColors.Error,
                                )
                            }
                        }
                    }
                }
            }
        }

        // 4. Server Maintenance (Clear Cache) Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Server Cache Maintenance",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Clears server-side query caches, file search indexes, and syntax symbol caches on the target server.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Button(
                    onClick = {
                        val target = currentTargetProfile
                        if (target == null) {
                            operationFeedback = "Please select a target server first."
                            isFeedbackError = true
                            return@Button
                        }
                        val gen = settingsRepository.getTargetConnectionGeneration(target.id)
                        pendingClearCacheContext = CapturedConfirmationContext(
                            profileId = target.id,
                            profileName = target.name,
                            profileUrl = target.baseUrl,
                            generation = gen,
                        )
                    },
                    enabled = currentTargetId != null,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Warning),
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(
                        text = "Clear Server Cache",
                        color = Color.Black,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        // 5. Destructive Action Card (Nuclear Reset)
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Error.copy(alpha = 0.08f)),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Error, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Nuclear Reset (Destructive)",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.Error,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Terminates all running terminal processes, unmounts managed sessions, and wipes active workspace runtime state on the target server. Server profile credentials in your vault remain intact.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(14.dp))

                Button(
                    onClick = {
                        val target = currentTargetProfile
                        if (target == null) {
                            operationFeedback = "Please select a target server first."
                            isFeedbackError = true
                            return@Button
                        }
                        val gen = settingsRepository.getTargetConnectionGeneration(target.id)
                        pendingNuclearResetContext = CapturedConfirmationContext(
                            profileId = target.id,
                            profileName = target.name,
                            profileUrl = target.baseUrl,
                            generation = gen,
                        )
                    },
                    enabled = currentTargetId != null,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error),
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(
                        text = "⚠️ Nuclear Reset Target Server",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }

    // Confirmation Dialogs
    // Confirmation Dialogs bound to captured immutable contexts
    pendingImportContext?.let { ctx ->
        ImportTomlConfirmDialog(
            targetProfileName = ctx.profileName,
            targetProfileUrl = ctx.profileUrl,
            targetGeneration = ctx.generation,
            payloadBytes = ctx.payloadBytes,
            onConfirm = {
                pendingImportContext = null
                coroutineScope.launch {
                    val result = settingsRepository.importWorkspaceToml(
                        profileId = ctx.profileId,
                        tomlContent = ctx.tomlPayload,
                        expectedGeneration = ctx.generation,
                    )
                    if (result.isSuccess) {
                        operationFeedback = "Workspace TOML imported successfully on ${ctx.profileName}."
                        isFeedbackError = false
                    } else {
                        operationFeedback = "Import failed: ${result.exceptionOrNull()?.message}"
                        isFeedbackError = true
                    }
                }
            },
            onDismiss = { pendingImportContext = null },
        )
    }

    pendingClearCacheContext?.let { ctx ->
        ClearCacheConfirmDialog(
            targetProfileName = ctx.profileName,
            targetGeneration = ctx.generation,
            onConfirm = {
                pendingClearCacheContext = null
                coroutineScope.launch {
                    val result = settingsRepository.clearCache(
                        profileId = ctx.profileId,
                        expectedGeneration = ctx.generation,
                    )
                    if (result.isSuccess && result.getOrNull() == true) {
                        operationFeedback = "Server cache cleared on ${ctx.profileName}."
                        isFeedbackError = false
                    } else {
                        operationFeedback = "Failed to clear cache: ${result.exceptionOrNull()?.message}"
                        isFeedbackError = true
                    }
                }
            },
            onDismiss = { pendingClearCacheContext = null },
        )
    }

    pendingNuclearResetContext?.let { ctx ->
        NuclearResetConfirmDialog(
            targetProfileId = ctx.profileId,
            targetProfileName = ctx.profileName,
            targetProfileUrl = ctx.profileUrl,
            targetGeneration = ctx.generation,
            onConfirm = {
                pendingNuclearResetContext = null
                coroutineScope.launch {
                    val result = settingsRepository.nuclearReset(
                        profileId = ctx.profileId,
                        expectedGeneration = ctx.generation,
                    )
                    if (result.isSuccess && result.getOrNull() == true) {
                        operationFeedback = "Nuclear reset executed successfully on ${ctx.profileName}."
                        isFeedbackError = false
                    } else {
                        operationFeedback = "Nuclear reset failed: ${result.exceptionOrNull()?.message}"
                        isFeedbackError = true
                    }
                }
            },
            onDismiss = { pendingNuclearResetContext = null },
        )
    }
}

/**
 * Immutable context captured when a confirmation dialog is opened.
 */
data class CapturedConfirmationContext(
    val profileId: String,
    val profileName: String,
    val profileUrl: String,
    val generation: Long?,
    val tomlPayload: String = "",
    val payloadBytes: Int = 0,
)
