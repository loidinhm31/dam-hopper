package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun GitCommitMessageEditDialog(
    targetEntry: GitLogEntry,
    viewedBranch: String?,
    rewriteController: GitRewriteActionController,
    onDismiss: () -> Unit,
    onSuccess: (GitActionResult) -> Unit,
) {
    val snapshot by rewriteController.frozenMessageSnapshot.collectAsState()
    val isMutating by rewriteController.isMutating.collectAsState()

    var messageText by remember { mutableStateOf(targetEntry.message) }
    var allowSignatureRemoval by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var requiresSignatureConsent by remember { mutableStateOf(false) }

    LaunchedEffect(targetEntry.hash, viewedBranch) {
        rewriteController.loadMessageSnapshot(
            hash = targetEntry.hash,
            branch = viewedBranch,
            onLoaded = { messageText = it.message },
            onError = { errorMessage = it }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit Commit Message", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (snapshot != null) {
                    Text("Branch: ${snapshot!!.branch}", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                }
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = messageText,
                    onValueChange = { messageText = it },
                    label = { Text("Commit Message") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 100.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                        focusedBorderColor = DamHopperColors.Primary,
                        unfocusedBorderColor = DamHopperColors.Border,
                    )
                )

                if (requiresSignatureConsent) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                        Checkbox(
                            checked = allowSignatureRemoval,
                            onCheckedChange = { allowSignatureRemoval = it },
                            colors = CheckboxDefaults.colors(checkedColor = DamHopperColors.Primary)
                        )
                        Text("Consent to GPG signature removal", style = DamHopperTypography.bodySmall, color = DamHopperColors.Warning)
                    }
                }

                if (errorMessage != null) {
                    Text(errorMessage!!, color = DamHopperColors.Error, style = DamHopperTypography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    rewriteController.editCommitMessage(
                        hash = targetEntry.hash,
                        newMessage = messageText,
                        allowSignatureRemoval = allowSignatureRemoval,
                    ) { result ->
                        if (result.ok) {
                            onSuccess(result)
                            onDismiss()
                        } else if (result.blockedReason == "signature-consent-required") {
                            requiresSignatureConsent = true
                            errorMessage = result.recommendation ?: "Commit signature will be invalidated. Check consent to proceed."
                        } else {
                            errorMessage = result.recommendation ?: result.message ?: "Failed to rewrite message"
                        }
                    }
                },
                enabled = !isMutating && snapshot != null && messageText.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
