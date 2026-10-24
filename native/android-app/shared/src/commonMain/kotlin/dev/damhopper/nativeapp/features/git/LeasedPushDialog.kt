package dev.damhopper.nativeapp.features.git

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

@Composable
fun LeasedPushDialog(
    leasedController: LeasedPublishController,
    onDismiss: () -> Unit,
    onPublished: (PublishResult) -> Unit,
) {
    val state by leasedController.state.collectAsState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Publish Rewritten History", style = DamHopperTypography.titleMedium) },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Leased push protects remote branches from unintended overwrites by requiring exact expected remote OID match.",
                    style = DamHopperTypography.bodySmall,
                    color = DamHopperColors.TextSecondary
                )
                Spacer(modifier = Modifier.height(8.dp))

                when (val current = state) {
                    is LeasedPublishState.Preparing -> {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Text("Preparing publication lease preview...", style = DamHopperTypography.bodySmall)
                    }
                    is LeasedPublishState.Ready -> {
                        val snap = current.preview.snapshot!!
                        Text("Branch: ${snap.branch}", style = DamHopperTypography.labelSmall, color = DamHopperColors.Primary)
                        Text("Remote: ${snap.remoteName} -> ${snap.destinationRef}", style = DamHopperTypography.bodySmall)
                        Text("Source OID: ${snap.sourceOid.take(8)}", style = DamHopperTypography.bodySmall)
                        Text("Expected Remote OID: ${snap.expectedRemoteOid.take(8)}", style = DamHopperTypography.bodySmall)
                    }
                    is LeasedPublishState.Publishing -> {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Text("Publishing leased push to remote...", style = DamHopperTypography.bodySmall)
                    }
                    is LeasedPublishState.Blocked -> {
                        Text("Publication Blocked:", style = DamHopperTypography.labelSmall, color = DamHopperColors.Error)
                        Text(current.reason, style = DamHopperTypography.bodySmall, color = DamHopperColors.Error)
                    }
                    is LeasedPublishState.Success -> {
                        Text("Successfully published to remote!", style = DamHopperTypography.labelSmall, color = DamHopperColors.Success)
                    }
                    is LeasedPublishState.Error -> {
                        Text("Error: ${current.message}", style = DamHopperTypography.bodySmall, color = DamHopperColors.Error)
                    }
                    else -> {}
                }
            }
        },
        confirmButton = {
            if (state is LeasedPublishState.Ready) {
                Button(
                    onClick = {
                        leasedController.confirmPublish { res ->
                            if (res.isPublished) {
                                onPublished(res)
                                onDismiss()
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Success)
                ) {
                    Text("Confirm Leased Push")
                }
            } else if (state is LeasedPublishState.Success) {
                Button(onClick = onDismiss) { Text("Done") }
            } else if (state is LeasedPublishState.Blocked || state is LeasedPublishState.Error) {
                Button(onClick = onDismiss) { Text("Close") }
            }
        },
        dismissButton = {
            if (state !is LeasedPublishState.Success && state !is LeasedPublishState.Blocked && state !is LeasedPublishState.Error) {
                TextButton(onClick = {
                    leasedController.cancel()
                    onDismiss()
                }) {
                    Text("Cancel")
                }
            }
        }
    )
}
