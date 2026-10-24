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
fun GitSquashDialog(
    selectedHashes: List<String>,
    viewedBranch: String?,
    rewriteController: GitRewriteActionController,
    onDismiss: () -> Unit,
    onSuccess: (GitActionResult) -> Unit,
) {
    val snapshot by rewriteController.frozenMessageSnapshot.collectAsState()
    val isMutating by rewriteController.isMutating.collectAsState()

    var combinedMessage by remember { mutableStateOf("") }
    var allowSignatureRemoval by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var requiresSignatureConsent by remember { mutableStateOf(false) }

    LaunchedEffect(selectedHashes, viewedBranch) {
        val oldest = selectedHashes.lastOrNull() ?: return@LaunchedEffect
        rewriteController.loadMessageSnapshot(
            hash = oldest,
            branch = viewedBranch,
            onLoaded = { combinedMessage = "Squash ${selectedHashes.size} commits\n\n${it.message}" },
            onError = { errorMessage = it }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Squash Commits", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text("Squashing ${selectedHashes.size} contiguous commits into one commit.", style = DamHopperTypography.bodySmall)
                if (snapshot != null) {
                    Text("Branch: ${snapshot!!.branch}", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                }
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = combinedMessage,
                    onValueChange = { combinedMessage = it },
                    label = { Text("Combined Message") },
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
                    rewriteController.squashCommits(
                        orderedHashes = selectedHashes,
                        combinedMessage = combinedMessage,
                        allowSignatureRemoval = allowSignatureRemoval,
                    ) { result ->
                        if (result.ok) {
                            onSuccess(result)
                            onDismiss()
                        } else if (result.blockedReason == "signature-consent-required") {
                            requiresSignatureConsent = true
                            errorMessage = result.recommendation ?: "Signatures will be removed. Check consent to proceed."
                        } else {
                            errorMessage = result.recommendation ?: result.message ?: "Squash failed"
                        }
                    }
                },
                enabled = !isMutating && snapshot != null && combinedMessage.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
            ) {
                Text("Confirm Squash")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
