package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun ManualForceSuspendDialog(
    isSubmitting: Boolean,
    activeFleetConflict: IdleSuspendConflictResponse?,
    fleetChangedConflict: IdleSuspendConflictResponse?,
    onDismiss: () -> Unit,
    onConfirm: (wakeAfterSeconds: Int, force: Boolean) -> Unit
) {
    var wakeSecondsText by remember { mutableStateOf("0") }
    var force by remember(activeFleetConflict, fleetChangedConflict) {
        mutableStateOf(activeFleetConflict != null || fleetChangedConflict != null)
    }

    val wakeVal = wakeSecondsText.toIntOrNull()
    val isWakeValid = wakeVal != null && (wakeVal == 0 || wakeVal in 60..86400)
    val canSubmit = isWakeValid && !isSubmitting

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DamHopperColors.Surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Manual Host Force Suspend",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
            Text(
                text = "Initiates an audited host sleep handoff. Coordinator admits the request without blocking for sleep or resume.",
                fontSize = 12.sp,
                color = DamHopperColors.TextSecondary
            )

            // Conflict warnings if any
            if (activeFleetConflict != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Warning.copy(alpha = 0.2f))
                        .padding(8.dp)
                ) {
                    Text(
                        text = "Active fleet warning: ${activeFleetConflict.activeSessionCount ?: 0} active terminal sessions are running. Force flag required to proceed.",
                        fontSize = 11.sp,
                        color = DamHopperColors.Warning
                    )
                }
            } else if (fleetChangedConflict != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Warning.copy(alpha = 0.2f))
                        .padding(8.dp)
                ) {
                    Text(
                        text = "Fleet changed warning: session snapshot changed concurrently. Please confirm with force flag.",
                        fontSize = 11.sp,
                        color = DamHopperColors.Warning
                    )
                }
            }

            OutlinedTextField(
                value = wakeSecondsText,
                onValueChange = { wakeSecondsText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Wake timer in seconds (0 = indefinite, or 60-86400)", fontSize = 11.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Checkbox(checked = force, onCheckedChange = { force = it })
                Text(
                    text = "Force suspend (bypass active fleet check)",
                    fontSize = 12.sp,
                    color = DamHopperColors.TextPrimary
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = onDismiss, enabled = !isSubmitting) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = {
                        if (canSubmit && wakeVal != null) {
                            onConfirm(wakeVal, force)
                        }
                    },
                    enabled = canSubmit,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                ) {
                    if (isSubmitting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Admitting...")
                    } else {
                        Text("Confirm Suspend")
                    }
                }
            }
        }
    }
}

@Composable
fun LoadSshKeyDialog(
    keyName: String,
    keyPath: String,
    isLoading: Boolean,
    onDismiss: () -> Unit,
    onLoad: (passphrase: String, saveForLater: Boolean) -> Unit
) {
    var passphrase by remember { mutableStateOf("") }
    var saveForLater by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DamHopperColors.Surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Load SSH Key",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
            Text(
                text = "Load '$keyName' on the remote server for Git and terminal operations. Passphrase is kept in server custody and never saved locally.",
                fontSize = 12.sp,
                color = DamHopperColors.TextSecondary
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(8.dp)
            ) {
                Text(
                    text = keyPath,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = DamHopperColors.TextPrimary
                )
            }

            OutlinedTextField(
                value = passphrase,
                onValueChange = { passphrase = it },
                label = { Text("Passphrase (leave empty if unencrypted)", fontSize = 11.sp) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Checkbox(checked = saveForLater, onCheckedChange = { saveForLater = it })
                Text(
                    text = "Save in server OS keyring for later",
                    fontSize = 12.sp,
                    color = DamHopperColors.TextPrimary
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = onDismiss, enabled = !isLoading) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = { onLoad(passphrase, saveForLater) },
                    enabled = !isLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Loading...")
                    } else {
                        Text("Load Key")
                    }
                }
            }
        }
    }
}

/**
 * Workbench-level Sleep Consent Banner, visible on top across ALL panels when consent is pending.
 */
@Composable
fun WorkbenchSleepConsentBanner(
    consent: SleepConsentStatus,
    hasLiveReceipt: Boolean,
    isSubmitting: Boolean,
    onDecision: (SleepConsentDecision) -> Unit
) {
    var remainingSeconds by remember(consent.expiresAtMs) {
        val now = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
        mutableStateOf(((consent.expiresAtMs - now) / 1000).coerceAtLeast(0))
    }

    LaunchedEffect(consent.expiresAtMs) {
        while (remainingSeconds > 0) {
            kotlinx.coroutines.delay(1000)
            val now = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
            remainingSeconds = ((consent.expiresAtMs - now) / 1000).coerceAtLeast(0)
        }
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(DamHopperColors.Warning.copy(alpha = 0.25f))
            .padding(10.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "HOST SLEEP CONSENT REQUESTED",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = DamHopperColors.Warning
                    )
                    Text(
                        text = "(${remainingSeconds}s remaining)",
                        fontSize = 11.sp,
                        color = DamHopperColors.TextSecondary
                    )
                }

                // Live capability indicator
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(if (hasLiveReceipt) DamHopperColors.Success else DamHopperColors.Error)
                    )
                    Text(
                        text = if (hasLiveReceipt) "Live WS Verified" else "No Live WS",
                        fontSize = 9.sp,
                        color = if (hasLiveReceipt) DamHopperColors.Success else DamHopperColors.Error
                    )
                }
            }

            Text(
                text = "Server policy requests sleep (wake after ${consent.wakeAfterSeconds}s). Unanswered request will time out.",
                fontSize = 11.sp,
                color = DamHopperColors.TextPrimary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Error.copy(alpha = 0.2f))
                        .clickable(enabled = hasLiveReceipt && !isSubmitting && remainingSeconds > 0) {
                            onDecision(SleepConsentDecision.DENY)
                        }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                ) {
                    Text(
                        text = "Deny Sleep",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (hasLiveReceipt && !isSubmitting && remainingSeconds > 0) DamHopperColors.Error else DamHopperColors.TextSecondary
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Success.copy(alpha = 0.2f))
                        .clickable(enabled = hasLiveReceipt && !isSubmitting && remainingSeconds > 0) {
                            onDecision(SleepConsentDecision.APPROVE)
                        }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                ) {
                    Text(
                        text = "Approve Sleep",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (hasLiveReceipt && !isSubmitting && remainingSeconds > 0) DamHopperColors.Success else DamHopperColors.TextSecondary
                    )
                }
            }
        }
    }
}
