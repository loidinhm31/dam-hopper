package dev.damhopper.nativeapp.features.profiles

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun MfaChallengeContent(
    challenge: LoginChallenge,
    setupData: MfaSetupData?,
    isLoading: Boolean,
    errorMessage: String?,
    onConfirmCode: (code: String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    var code by remember { mutableStateOf("") }

    Column(modifier = modifier.fillMaxWidth()) {
        if (challenge.type == ChallengeType.ENROLLMENT_REQUIRED) {
            Text(
                text = "MFA Enrollment Required",
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary,
                fontSize = 15.sp
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Scan QR or enter key in authenticator app. Secrets are transient and never saved.",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )
            setupData?.let {
                Spacer(modifier = Modifier.height(6.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = DamHopperColors.Background),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(8.dp)) {
                        Text("Secret Key (Base32):", fontSize = 10.sp, color = DamHopperColors.TextSecondary)
                        Text(
                            text = it.secret,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            color = DamHopperColors.Primary
                        )
                    }
                }
            }
        } else {
            Text(
                text = "MFA Verification Required",
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary,
                fontSize = 15.sp
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Enter 6-digit TOTP code from your authenticator app.",
                color = DamHopperColors.TextSecondary,
                fontSize = 11.sp
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = code,
            onValueChange = { if (it.length <= 6 && it.all { c -> c.isDigit() }) code = it },
            label = { Text("6-Digit Code") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        errorMessage?.let {
            Spacer(modifier = Modifier.height(4.dp))
            Text(it, color = DamHopperColors.Error, fontSize = 12.sp)
        }

        Spacer(modifier = Modifier.height(10.dp))

        Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = onCancel, enabled = !isLoading) {
                Text("Cancel", color = DamHopperColors.TextSecondary)
            }
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = { onConfirmCode(code) },
                enabled = code.length == 6 && !isLoading,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
            ) {
                Text(
                    if (challenge.type == ChallengeType.ENROLLMENT_REQUIRED) "Confirm" else "Verify",
                    color = DamHopperColors.Background
                )
            }
        }
    }
}
