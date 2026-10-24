package dev.damhopper.nativeapp.features.profiles

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

enum class AuthTab { LOGIN, REGISTER }

@Composable
fun AuthDialog(
    profile: ServerProfile,
    authStatus: AuthStatus?,
    onLogin: (username: String, password: String) -> Unit,
    onRegister: (username: String, password: String) -> Unit,
    onConfirmMfa: (challengeToken: String, code: String) -> Unit,
    onVerifyMfa: (challengeToken: String, code: String) -> Unit,
    onLogout: () -> Unit,
    onDismiss: () -> Unit,
    activeChallenge: LoginChallenge? = null,
    setupData: MfaSetupData? = null,
    isLoading: Boolean = false,
    errorMessage: String? = null,
    noticeMessage: String? = null,
) {
    var selectedTab by remember { mutableStateOf(AuthTab.LOGIN) }
    var username by remember { mutableStateOf(profile.username ?: "") }
    var password by remember { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = DamHopperColors.Surface,
            modifier = Modifier.fillMaxWidth().padding(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "${profile.name} — Authentication",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = DamHopperColors.TextPrimary
                )
                Spacer(modifier = Modifier.height(8.dp))

                if (activeChallenge != null) {
                    MfaChallengeContent(
                        challenge = activeChallenge,
                        setupData = setupData,
                        isLoading = isLoading,
                        errorMessage = errorMessage,
                        onConfirmCode = { code ->
                            if (activeChallenge.type == ChallengeType.ENROLLMENT_REQUIRED) {
                                onConfirmMfa(activeChallenge.challengeToken, code)
                            } else {
                                onVerifyMfa(activeChallenge.challengeToken, code)
                            }
                        },
                        onCancel = onDismiss
                    )
                } else if (authStatus is AuthStatus.Authenticated) {
                    Text(
                        text = "Authenticated as ${authStatus.session.user} (${authStatus.session.role})",
                        color = DamHopperColors.Secondary,
                        fontSize = 13.sp
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = onDismiss) {
                            Text("Close", color = DamHopperColors.TextSecondary)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = onLogout,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Error)
                        ) {
                            Text("Logout", color = DamHopperColors.TextPrimary)
                        }
                    }
                } else {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        TabButton("Login", selectedTab == AuthTab.LOGIN) { selectedTab = AuthTab.LOGIN }
                        Spacer(modifier = Modifier.width(8.dp))
                        TabButton("Register", selectedTab == AuthTab.REGISTER) { selectedTab = AuthTab.REGISTER }
                    }
                    Spacer(modifier = Modifier.height(10.dp))

                    if (selectedTab == AuthTab.REGISTER) {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                        ) {
                            Text(
                                text = "Notice: Newly registered accounts are created disabled. An administrator must approve and promote your account before login can proceed.",
                                color = DamHopperColors.Warning,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(8.dp)
                            )
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                    }

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("Username") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )

                    errorMessage?.let {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(it, color = DamHopperColors.Error, fontSize = 12.sp)
                    }
                    noticeMessage?.let {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(it, color = DamHopperColors.Secondary, fontSize = 12.sp)
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = onDismiss, enabled = !isLoading) {
                            Text("Cancel", color = DamHopperColors.TextSecondary)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = {
                                if (selectedTab == AuthTab.LOGIN) {
                                    onLogin(username, password)
                                } else {
                                    onRegister(username, password)
                                }
                            },
                            enabled = username.isNotBlank() && password.isNotBlank() && !isLoading,
                            colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                        ) {
                            Text(
                                if (selectedTab == AuthTab.LOGIN) "Login" else "Register",
                                color = DamHopperColors.Background
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TabButton(text: String, selected: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(
            contentColor = if (selected) DamHopperColors.Primary else DamHopperColors.TextSecondary
        )
    ) {
        Text(text, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
    }
}
