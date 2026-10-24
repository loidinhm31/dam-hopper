package dev.damhopper.nativeapp.ui.screens

import androidx.compose.runtime.*
import dev.damhopper.nativeapp.features.profiles.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

@Composable
fun WorkbenchAuthFlow(
    profileId: String,
    profiles: List<ServerProfile>,
    authStatuses: Map<String, AuthStatus>,
    profileRepository: ProfileRepository,
    coroutineScope: CoroutineScope,
    onDismiss: () -> Unit,
) {
    val prof = profiles.find { it.id == profileId } ?: return
    var activeChallenge by remember { mutableStateOf<LoginChallenge?>(null) }
    var setupData by remember { mutableStateOf<MfaSetupData?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var noticeMessage by remember { mutableStateOf<String?>(null) }

    AuthDialog(
        profile = prof,
        authStatus = authStatuses[profileId],
        activeChallenge = activeChallenge,
        setupData = setupData,
        isLoading = isLoading,
        errorMessage = errorMessage,
        noticeMessage = noticeMessage,
        onLogin = { u, p ->
            coroutineScope.launch {
                isLoading = true
                errorMessage = null
                try {
                    val client = profileRepository.getOrCreateApiClient(profileId)
                    val authRepo = AuthRepository(client)
                    val attempt = profileRepository.attemptTracker.startAttempt(profileId)
                    when (val res = authRepo.login(u, p)) {
                        is LoginResult.Challenge -> {
                            activeChallenge = res.challenge
                            if (res.challenge.type == ChallengeType.ENROLLMENT_REQUIRED) {
                                setupData = authRepo.fetchMfaSetup(res.challenge.challengeToken)
                            }
                        }
                        is LoginResult.Session -> {
                            profileRepository.applyAuthenticatedSession(profileId, res.session, attempt)
                            onDismiss()
                        }
                    }
                } catch (e: Exception) {
                    errorMessage = e.message ?: "Login failed"
                } finally {
                    isLoading = false
                }
            }
        },
        onRegister = { u, p ->
            coroutineScope.launch {
                isLoading = true
                errorMessage = null
                try {
                    val client = profileRepository.getOrCreateApiClient(profileId)
                    val authRepo = AuthRepository(client)
                    authRepo.register(u, p).getOrThrow()
                    noticeMessage = "Registration submitted! Account is pending operator approval."
                } catch (e: Exception) {
                    errorMessage = e.message ?: "Registration failed"
                } finally {
                    isLoading = false
                }
            }
        },
        onConfirmMfa = { challengeToken, code ->
            coroutineScope.launch {
                isLoading = true
                errorMessage = null
                try {
                    val client = profileRepository.getOrCreateApiClient(profileId)
                    val authRepo = AuthRepository(client)
                    val attempt = profileRepository.attemptTracker.startAttempt(profileId)
                    val session = authRepo.confirmMfaEnrollment(challengeToken, code)
                    profileRepository.applyAuthenticatedSession(profileId, session, attempt)
                    onDismiss()
                } catch (e: Exception) {
                    errorMessage = e.message ?: "MFA Confirmation failed"
                } finally {
                    isLoading = false
                }
            }
        },
        onVerifyMfa = { challengeToken, code ->
            coroutineScope.launch {
                isLoading = true
                errorMessage = null
                try {
                    val client = profileRepository.getOrCreateApiClient(profileId)
                    val authRepo = AuthRepository(client)
                    val attempt = profileRepository.attemptTracker.startAttempt(profileId)
                    val session = authRepo.verifyMfa(challengeToken, code)
                    profileRepository.applyAuthenticatedSession(profileId, session, attempt)
                    onDismiss()
                } catch (e: Exception) {
                    errorMessage = e.message ?: "MFA Verification failed"
                } finally {
                    isLoading = false
                }
            }
        },
        onLogout = {
            coroutineScope.launch {
                profileRepository.logout(profileId)
                onDismiss()
            }
        },
        onDismiss = onDismiss
    )
}
