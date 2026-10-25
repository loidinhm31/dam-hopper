package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.features.profiles.AuthAttemptRef
import dev.damhopper.nativeapp.features.profiles.AuthRepository
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ChallengeType
import dev.damhopper.nativeapp.features.profiles.LoginChallenge
import dev.damhopper.nativeapp.features.profiles.LoginResult
import dev.damhopper.nativeapp.features.profiles.MfaChallengeContent
import dev.damhopper.nativeapp.features.profiles.MfaSetupData
import dev.damhopper.nativeapp.features.profiles.ProfileRepository
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Immutable context encapsulating an active MFA challenge bound to its originating endpoint and attempt.
 */
private data class MfaActiveContext(
    val challenge: LoginChallenge,
    val profileId: String,
    val normalizedUrl: String,
    val attempt: AuthAttemptRef,
    val generation: Long,
)

/**
 * Validates whether an endpoint URL uses cleartext HTTP.
 */
private fun isCleartextHttp(url: String): Boolean {
    val validated = ServerProfile.validateServerUrl(url).getOrNull() ?: ServerProfile.normalizeUrl(url)
    return validated.startsWith("http://", ignoreCase = true)
}

/**
 * Mobile-first Profile selection and Login screen for DamHopper Android native app.
 *
 * Implements:
 * 1. Server-Reported Capability for Dev Mode: Dev login is strictly enabled ONLY after explicit
 *    server capability confirmation via /api/auth/status with dev_mode == true.
 * 2. Monotonic Stale-Attempt Fencing: All asynchronous operations track local operation generations
 *    and monotonic [AuthAttemptTracker] watermarks. Results, errors, and loading states from stale
 *    attempts are rejected across profile switching, URL edits, and cancellation.
 * 3. Cleartext Security Guard: Strictly blocks credential transmission (passwords, MFA codes, tokens)
 *    over cleartext HTTP. Only verified credentialless dev-mode sessions may operate over HTTP.
 * 4. Token Custody & Zero Password Persistence: Session tokens are stored exclusively via [CredentialVault]
 *    and [ConnectionRegistry]. Password state is cleared immediately upon auth or profile switch.
 * 5. Advances via [onAuthenticated] upon successful session establishment.
 * 6. Zero WebView, zero floating action buttons, strictly [DamHopperColors].
 */
@Composable
fun ProfileLoginScreen(
    profileRepository: ProfileRepository,
    onAuthenticated: (profileId: String) -> Unit,
    headerEntries: HeaderEntries? = null,
    modifier: Modifier = Modifier,
) {
    val profiles by profileRepository.profiles.collectAsState()
    val activeProfileId by profileRepository.activeProfileId.collectAsState()
    val authStatuses by profileRepository.authStatuses.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    var selectedProfileId by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("Local Server") }
    var baseUrl by remember { mutableStateOf("http://10.0.2.2:4803") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    var isLoading by remember { mutableStateOf(false) }
    var isTestingConnection by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var connectionTestMessage by remember { mutableStateOf<String?>(null) }
    var connectionTestIsReachable by remember { mutableStateOf(false) }

    // Synchronous operation generation counter to fence all in-flight callbacks
    var operationGeneration by remember { mutableStateOf(0L) }

    // Map of "$profileId|$normalizedUrl" -> Boolean indicating explicit server-confirmed dev mode capability
    val confirmedDevEndpoints = remember { mutableStateMapOf<String, Boolean>() }

    var mfaContext by remember { mutableStateOf<MfaActiveContext?>(null) }
    var setupData by remember { mutableStateOf<MfaSetupData?>(null) }
    var mfaErrorMessage by remember { mutableStateOf<String?>(null) }
    var hasStoredToken by remember { mutableStateOf(false) }

    val normalizedCurrentUrl = remember(baseUrl) {
        ServerProfile.normalizeUrl(baseUrl)
    }

    val isCurrentUrlCleartext = remember(normalizedCurrentUrl) {
        isCleartextHttp(normalizedCurrentUrl)
    }

    val currentEndpointKey = remember(selectedProfileId, normalizedCurrentUrl) {
        "${selectedProfileId ?: "new"}|$normalizedCurrentUrl"
    }

    val isDevModeConfirmed = confirmedDevEndpoints[currentEndpointKey] == true

    // Initial profile selection from activeProfileId or first available
    LaunchedEffect(profiles, activeProfileId) {
        if (selectedProfileId == null && profiles.isNotEmpty()) {
            val initial = profiles.find { it.id == activeProfileId } ?: profiles.first()
            selectedProfileId = initial.id
            name = initial.name
            baseUrl = initial.baseUrl
            username = initial.username ?: ""
            password = ""
        }
    }

    // Vault token check whenever selected profile or URL changes
    LaunchedEffect(selectedProfileId, normalizedCurrentUrl) {
        val currentId = selectedProfileId
        if (currentId != null) {
            val prof = profiles.find { it.id == currentId }
            if (prof != null) {
                hasStoredToken = try {
                    profileRepository.vault.getToken(prof.id, normalizedCurrentUrl) != null
                } catch (_: Exception) {
                    false
                }
            } else {
                hasStoredToken = false
            }
        } else {
            hasStoredToken = false
        }
    }

    // Synchronously invalidate and cleanup on disposal
    DisposableEffect(Unit) {
        onDispose {
            operationGeneration++
            selectedProfileId?.let { id ->
                coroutineScope.launch {
                    try {
                        profileRepository.attemptTracker.invalidate(id)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    suspend fun saveProfileFromInputs(
        inputName: String,
        inputUrl: String,
        inputUsername: String?
    ): ServerProfile? {
        val urlCheck = ServerProfile.validateServerUrl(inputUrl)
        if (urlCheck.isFailure) {
            errorMessage = urlCheck.exceptionOrNull()?.message ?: "Invalid server URL"
            return null
        }
        if (inputName.isBlank()) {
            errorMessage = "Server name cannot be blank"
            return null
        }
        val cleanUrl = urlCheck.getOrThrow()
        val cleanUsername = inputUsername?.trim()?.ifBlank { null }
        val currentId = selectedProfileId
        val existing = profiles.find { it.id == currentId }
        val saved = if (existing != null) {
            profileRepository.updateProfile(existing.id, inputName.trim(), cleanUrl, cleanUsername)
        } else {
            val created = profileRepository.addProfile(inputName.trim(), cleanUrl, cleanUsername)
            selectedProfileId = created.id
            created
        }
        profileRepository.selectProfile(saved.id)
        return saved
    }

    val currentStatus = selectedProfileId?.let { authStatuses[it] }
    val isCurrentlyAuthenticated = currentStatus is AuthStatus.Authenticated
    val isMfaActive = mfaContext != null
    val isBusy = isLoading || isTestingConnection || isMfaActive

    Surface(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .safeDrawingPadding()
            .imePadding(),
        color = DamHopperColors.Background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 20.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "DamHopper",
                        color = DamHopperColors.Primary,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Server Profiles & Authentication",
                        color = DamHopperColors.TextSecondary,
                        fontSize = 13.sp
                    )
                }

                if (selectedProfileId != null) {
                    TextButton(
                        onClick = {
                            operationGeneration++
                            selectedProfileId?.let { oldId ->
                                coroutineScope.launch { profileRepository.attemptTracker.invalidate(oldId) }
                            }
                            selectedProfileId = null
                            name = ""
                            baseUrl = "http://10.0.2.2:4803"
                            username = ""
                            password = ""
                            errorMessage = null
                            connectionTestMessage = null
                            mfaContext = null
                            hasStoredToken = false
                        },
                        enabled = !isBusy
                    ) {
                        Text("+ New Profile", color = DamHopperColors.Primary, fontSize = 13.sp)
                    }
                }

                headerEntries?.let { HeaderEntryButtons(it) }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Configured Profiles list
            if (profiles.isNotEmpty()) {
                Text(
                    text = "Configured Profiles",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(8.dp))

                profiles.forEach { profile ->
                    val isSelected = profile.id == selectedProfileId
                    val isActive = profile.id == activeProfileId
                    val status = authStatuses[profile.id]

                    ProfileRowItem(
                        profile = profile,
                        isSelected = isSelected,
                        isActive = isActive,
                        status = status,
                        onClick = {
                            if (selectedProfileId != profile.id) {
                                operationGeneration++
                                selectedProfileId?.let { oldId ->
                                    coroutineScope.launch { profileRepository.attemptTracker.invalidate(oldId) }
                                }
                                selectedProfileId = profile.id
                                name = profile.name
                                baseUrl = profile.baseUrl
                                username = profile.username ?: ""
                                password = ""
                                errorMessage = null
                                connectionTestMessage = null
                                mfaContext = null
                                coroutineScope.launch {
                                    profileRepository.selectProfile(profile.id)
                                    if (authStatuses[profile.id] == null) {
                                        try {
                                            profileRepository.refreshAuthStatus(profile.id)
                                        } catch (_: Exception) {}
                                    }
                                }
                            } else if (status is AuthStatus.Authenticated) {
                                onAuthenticated(profile.id)
                            }
                        },
                        onDelete = {
                            coroutineScope.launch {
                                try {
                                    operationGeneration++
                                    profileRepository.attemptTracker.invalidate(profile.id)
                                    profileRepository.deleteProfile(profile.id)
                                    if (selectedProfileId == profile.id) {
                                        val remaining = profileRepository.activeProfileId.value
                                        selectedProfileId = remaining
                                        val nextProf = profiles.find { it.id == remaining }
                                        if (nextProf != null) {
                                            name = nextProf.name
                                            baseUrl = nextProf.baseUrl
                                            username = nextProf.username ?: ""
                                            password = ""
                                        }
                                    }
                                } catch (e: Exception) {
                                    if (e is CancellationException) throw e
                                    errorMessage = "Failed to delete profile: ${e.message}"
                                }
                            }
                        },
                        enabled = !isBusy
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Spacer(modifier = Modifier.height(12.dp))
            }

            // Profile Edit / Create Card
            Card(
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
                border = BorderStroke(1.dp, DamHopperColors.Border),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = if (selectedProfileId != null) "Edit Profile" else "Add Server Profile",
                        color = DamHopperColors.TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    // Server Name
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Server Name") },
                        placeholder = { Text("e.g. Local Dev Server") },
                        singleLine = true,
                        enabled = !isBusy,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = DamHopperColors.TextPrimary,
                            unfocusedTextColor = DamHopperColors.TextPrimary,
                            focusedBorderColor = DamHopperColors.Primary,
                            unfocusedBorderColor = DamHopperColors.Border,
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    // Base URL
                    OutlinedTextField(
                        value = baseUrl,
                        onValueChange = {
                            operationGeneration++
                            mfaContext = null
                            baseUrl = it
                        },
                        label = { Text("Base URL (http:// or https://)") },
                        placeholder = { Text("http://10.0.2.2:4803") },
                        singleLine = true,
                        enabled = !isBusy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = DamHopperColors.TextPrimary,
                            unfocusedTextColor = DamHopperColors.TextPrimary,
                            focusedBorderColor = DamHopperColors.Primary,
                            unfocusedBorderColor = DamHopperColors.Border,
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    // Cleartext Security Notice
                    if (isCurrentUrlCleartext) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "\u26A0 Cleartext HTTP: Passwords prohibited over unencrypted HTTP. Only verified Dev Mode is permitted.",
                            color = DamHopperColors.Warning,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    // Quick-fill chips
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        PresetChip(
                            label = "Emulator: 10.0.2.2:4803",
                            onClick = {
                                operationGeneration++
                                mfaContext = null
                                baseUrl = "http://10.0.2.2:4803"
                            },
                            enabled = !isBusy
                        )
                        PresetChip(
                            label = "Loopback: 127.0.0.1:4803",
                            onClick = {
                                operationGeneration++
                                mfaContext = null
                                baseUrl = "http://127.0.0.1:4803"
                            },
                            enabled = !isBusy
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Username
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("Username") },
                        singleLine = true,
                        enabled = !isBusy,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = DamHopperColors.TextPrimary,
                            unfocusedTextColor = DamHopperColors.TextPrimary,
                            focusedBorderColor = DamHopperColors.Primary,
                            unfocusedBorderColor = DamHopperColors.Border,
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    // Password (transient remember only, cleared on switch/auth)
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password (HTTPS only)") },
                        singleLine = true,
                        enabled = !isBusy,
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                        trailingIcon = {
                            Text(
                                text = if (passwordVisible) "Hide" else "Show",
                                color = DamHopperColors.Primary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier
                                    .clickable(enabled = !isBusy) { passwordVisible = !passwordVisible }
                                    .padding(8.dp)
                            )
                        },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = DamHopperColors.TextPrimary,
                            unfocusedTextColor = DamHopperColors.TextPrimary,
                            focusedBorderColor = DamHopperColors.Primary,
                            unfocusedBorderColor = DamHopperColors.Border,
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Explicit Save Profile action
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(
                            onClick = {
                                val snapName = name.trim()
                                val snapUrl = baseUrl.trim()
                                val snapUsername = username.trim().ifBlank { null }
                                val opGen = ++operationGeneration

                                coroutineScope.launch {
                                    isLoading = true
                                    errorMessage = null
                                    connectionTestMessage = null
                                    try {
                                        val saved = saveProfileFromInputs(snapName, snapUrl, snapUsername)
                                        if (operationGeneration == opGen && saved != null) {
                                            connectionTestMessage = "Profile '${saved.name}' saved."
                                            connectionTestIsReachable = true
                                        }
                                    } catch (e: Exception) {
                                        if (e is CancellationException) throw e
                                        if (operationGeneration == opGen) {
                                            errorMessage = e.message ?: "Failed to save profile"
                                        }
                                    } finally {
                                        if (operationGeneration == opGen) {
                                            isLoading = false
                                        }
                                    }
                                }
                            },
                            enabled = !isBusy
                        ) {
                            Text(
                                text = if (selectedProfileId != null) "Save Profile Changes" else "Save Profile",
                                color = DamHopperColors.TextSecondary,
                                fontSize = 12.sp
                            )
                        }
                    }

                    // Red Alert Error Feedback
                    if (errorMessage != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Surface(
                            color = DamHopperColors.Error.copy(alpha = 0.15f),
                            border = BorderStroke(1.dp, DamHopperColors.Error),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = errorMessage ?: "",
                                color = DamHopperColors.Error,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }

                    // Connection Test / Status Result Feedback
                    if (connectionTestMessage != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        val statusColor = if (connectionTestIsReachable) DamHopperColors.Secondary else DamHopperColors.Error
                        Surface(
                            color = statusColor.copy(alpha = 0.15f),
                            border = BorderStroke(1.dp, statusColor),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = connectionTestMessage ?: "",
                                color = statusColor,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }

                    // MFA Challenge Overlay / Content bound to originating context
                    val activeCtx = mfaContext
                    if (activeCtx != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Card(
                            colors = CardDefaults.cardColors(containerColor = DamHopperColors.SurfaceVariant),
                            border = BorderStroke(1.dp, DamHopperColors.Warning),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    text = "Two-Factor Authentication",
                                    color = DamHopperColors.Warning,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                MfaChallengeContent(
                                    challenge = activeCtx.challenge,
                                    setupData = setupData,
                                    isLoading = isLoading,
                                    errorMessage = mfaErrorMessage,
                                    onConfirmCode = { code ->
                                        val mfaOpGen = ++operationGeneration
                                        coroutineScope.launch {
                                            isLoading = true
                                            mfaErrorMessage = null
                                            try {
                                                // Security guard: Prohibit MFA verification over cleartext HTTP
                                                if (isCleartextHttp(activeCtx.normalizedUrl)) {
                                                    mfaErrorMessage = "Security Error: MFA verification cannot occur over unencrypted HTTP."
                                                    return@launch
                                                }

                                                // Monotonic freshness check before sending code
                                                if (operationGeneration != mfaOpGen || selectedProfileId != activeCtx.profileId) {
                                                    return@launch
                                                }
                                                profileRepository.attemptTracker.assertActive(activeCtx.attempt)

                                                val client = profileRepository.getOrCreateApiClient(activeCtx.profileId)
                                                val authRepo = AuthRepository(client)

                                                val session = if (activeCtx.challenge.type == ChallengeType.ENROLLMENT_REQUIRED) {
                                                    authRepo.confirmMfaEnrollment(activeCtx.challenge.challengeToken, code)
                                                } else {
                                                    authRepo.verifyMfa(activeCtx.challenge.challengeToken, code)
                                                }

                                                // Monotonic freshness check before committing session
                                                if (operationGeneration != mfaOpGen || selectedProfileId != activeCtx.profileId) {
                                                    return@launch
                                                }
                                                profileRepository.attemptTracker.assertActive(activeCtx.attempt)

                                                profileRepository.applyAuthenticatedSession(activeCtx.profileId, session, activeCtx.attempt)
                                                mfaContext = null
                                                password = ""
                                                onAuthenticated(activeCtx.profileId)
                                            } catch (e: Exception) {
                                                if (e is CancellationException) throw e
                                                if (operationGeneration == mfaOpGen) {
                                                    mfaErrorMessage = e.message ?: "MFA verification failed"
                                                }
                                            } finally {
                                                if (operationGeneration == mfaOpGen) {
                                                    isLoading = false
                                                }
                                            }
                                        }
                                    },
                                    onCancel = {
                                        operationGeneration++
                                        val profId = activeCtx.profileId
                                        coroutineScope.launch {
                                            try {
                                                profileRepository.attemptTracker.invalidate(profId)
                                            } catch (_: Exception) {}
                                        }
                                        mfaContext = null
                                        setupData = null
                                        mfaErrorMessage = null
                                    }
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Primary Action: Connect & Login
                    Button(
                        onClick = {
                            val snapName = name.trim()
                            val snapUrl = baseUrl.trim()
                            val snapUsername = username.trim().ifBlank { null }
                            val snapPassword = password
                            val opGen = ++operationGeneration

                            coroutineScope.launch {
                                isLoading = true
                                errorMessage = null
                                connectionTestMessage = null
                                mfaContext = null

                                try {
                                    val isCleartext = isCleartextHttp(snapUrl)
                                    // Security Guard: Prohibit transmitting credentials over cleartext HTTP
                                    if (isCleartext) {
                                        errorMessage = "Security Error: Authentication credentials cannot be transmitted over unencrypted HTTP. Use HTTPS for credential login, or Dev Login for local development."
                                        return@launch
                                    }

                                    val target = saveProfileFromInputs(snapName, snapUrl, snapUsername) ?: return@launch
                                    val targetId = target.id
                                    val targetUrl = target.normalizedUrl

                                    val attempt = profileRepository.attemptTracker.startAttempt(targetId)

                                    val client = profileRepository.getOrCreateApiClient(targetId)
                                    val authRepo = AuthRepository(client)
                                    val u = snapUsername
                                    val p = snapPassword.ifBlank { null }

                                    when (val result = authRepo.login(u, p)) {
                                        is LoginResult.Session -> {
                                            // Enforce monotonic fencing before committing session
                                            if (operationGeneration != opGen || selectedProfileId != targetId || ServerProfile.normalizeUrl(baseUrl) != targetUrl) {
                                                return@launch
                                            }
                                            profileRepository.attemptTracker.assertActive(attempt)
                                            profileRepository.applyAuthenticatedSession(targetId, result.session, attempt)
                                            password = ""
                                            onAuthenticated(targetId)
                                        }
                                        is LoginResult.Challenge -> {
                                            if (operationGeneration != opGen || selectedProfileId != targetId || ServerProfile.normalizeUrl(baseUrl) != targetUrl) {
                                                return@launch
                                            }
                                            profileRepository.attemptTracker.assertActive(attempt)
                                            mfaContext = MfaActiveContext(
                                                challenge = result.challenge,
                                                profileId = targetId,
                                                normalizedUrl = targetUrl,
                                                attempt = attempt,
                                                generation = opGen,
                                            )
                                            if (result.challenge.type == ChallengeType.ENROLLMENT_REQUIRED) {
                                                try {
                                                    val setup = authRepo.fetchMfaSetup(result.challenge.challengeToken)
                                                    if (operationGeneration == opGen && selectedProfileId == targetId) {
                                                        profileRepository.attemptTracker.assertActive(attempt)
                                                        setupData = setup
                                                    }
                                                } catch (e: Exception) {
                                                    if (e is CancellationException) throw e
                                                    if (operationGeneration == opGen) {
                                                        mfaErrorMessage = "Failed to load MFA setup: ${e.message}"
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (e: Exception) {
                                    if (e is CancellationException) throw e
                                    if (operationGeneration == opGen) {
                                        errorMessage = if (e is ApiRequestError) {
                                            "Login failed (HTTP ${e.status}): ${e.message}"
                                        } else {
                                            "Login failed: ${e.message ?: "Invalid credentials or network timeout"}"
                                        }
                                    }
                                } finally {
                                    if (operationGeneration == opGen) {
                                        isLoading = false
                                    }
                                }
                            }
                        },
                        enabled = !isBusy,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = DamHopperColors.Primary,
                            disabledContainerColor = DamHopperColors.SurfaceVariant
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = DamHopperColors.Background,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Connecting...", color = DamHopperColors.Background, fontWeight = FontWeight.SemiBold)
                        } else {
                            Text("Connect & Login", color = DamHopperColors.Background, fontWeight = FontWeight.SemiBold)
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // Secondary Actions: Dev Login & Test Connection
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Dev Login: Strictly enabled only when server capability is confirmed
                        OutlinedButton(
                            onClick = {
                                val snapName = name.trim()
                                val snapUrl = baseUrl.trim()
                                val snapUsername = username.trim().ifBlank { null }
                                val opGen = ++operationGeneration

                                coroutineScope.launch {
                                    isLoading = true
                                    errorMessage = null
                                    connectionTestMessage = null

                                    try {
                                        val target = saveProfileFromInputs(snapName, snapUrl, snapUsername) ?: return@launch
                                        val targetId = target.id
                                        val targetUrl = target.normalizedUrl
                                        val endpointKey = "$targetId|$targetUrl"

                                        if (confirmedDevEndpoints[endpointKey] != true) {
                                            if (operationGeneration == opGen) {
                                                errorMessage = "Dev Login requires server capability confirmation. Run 'Test Connection' first."
                                            }
                                            return@launch
                                        }

                                        val attempt = profileRepository.attemptTracker.startAttempt(targetId)

                                        val client = profileRepository.getOrCreateApiClient(targetId)
                                        val authRepo = AuthRepository(client)

                                        when (val result = authRepo.login(null, null)) {
                                            is LoginResult.Session -> {
                                                if (operationGeneration != opGen || selectedProfileId != targetId || ServerProfile.normalizeUrl(baseUrl) != targetUrl) {
                                                    return@launch
                                                }
                                                profileRepository.attemptTracker.assertActive(attempt)
                                                profileRepository.applyAuthenticatedSession(targetId, result.session, attempt)
                                                password = ""
                                                onAuthenticated(targetId)
                                            }
                                            is LoginResult.Challenge -> {
                                                if (operationGeneration == opGen) {
                                                    errorMessage = "Dev Login returned unexpected MFA challenge; standard credentials required."
                                                }
                                            }
                                        }
                                    } catch (e: Exception) {
                                        if (e is CancellationException) throw e
                                        if (operationGeneration == opGen) {
                                            errorMessage = if (e is ApiRequestError) {
                                                "Dev Login failed (HTTP ${e.status}): ${e.message}"
                                            } else {
                                                "Dev Login failed: ${e.message ?: "Dev mode not active on server"}"
                                            }
                                        }
                                    } finally {
                                        if (operationGeneration == opGen) {
                                            isLoading = false
                                        }
                                    }
                                }
                            },
                            enabled = !isBusy && isDevModeConfirmed,
                            border = BorderStroke(
                                1.dp,
                                if (isDevModeConfirmed) DamHopperColors.Secondary else DamHopperColors.Border
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .height(44.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                text = if (isDevModeConfirmed) "Dev Login \u2713" else "Dev Login (N/A)",
                                color = if (isDevModeConfirmed) DamHopperColors.Secondary else DamHopperColors.TextSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }

                        // Test Connection & Capability Probe
                        OutlinedButton(
                            onClick = {
                                val snapName = name.trim()
                                val snapUrl = baseUrl.trim()
                                val snapUsername = username.trim().ifBlank { null }
                                val opGen = ++operationGeneration

                                coroutineScope.launch {
                                    isTestingConnection = true
                                    errorMessage = null
                                    connectionTestMessage = null

                                    try {
                                        val urlCheck = ServerProfile.validateServerUrl(snapUrl)
                                        if (urlCheck.isFailure) {
                                            if (operationGeneration == opGen) {
                                                errorMessage = urlCheck.exceptionOrNull()?.message ?: "Invalid server URL"
                                            }
                                            return@launch
                                        }
                                        val cleanUrl = urlCheck.getOrThrow()
                                        val currentId = selectedProfileId
                                        val endpointKey = "${currentId ?: "new"}|$cleanUrl"

                                        val status = if (currentId != null && profiles.any { it.id == currentId && it.baseUrl == cleanUrl }) {
                                            val client = profileRepository.getOrCreateApiClient(currentId)
                                            AuthRepository(client).checkAuthStatus()
                                        } else {
                                            val tempConn = dev.damhopper.nativeapp.core.model.ConnectionRef(currentId ?: "ephemeral-test", 0L)
                                            val tempClient = dev.damhopper.nativeapp.core.transport.ApiClient(tempConn, cleanUrl, { null }, null)
                                            AuthRepository(tempClient).checkAuthStatus()
                                        }

                                        if (operationGeneration != opGen || ServerProfile.normalizeUrl(baseUrl) != cleanUrl) {
                                            return@launch
                                        }
                                        connectionTestIsReachable = true

                                        val isDevCapability = status is AuthStatus.Authenticated && status.session.devMode
                                        confirmedDevEndpoints[endpointKey] = isDevCapability

                                        connectionTestMessage = when (status) {
                                            is AuthStatus.Authenticated -> {
                                                if (status.session.devMode) {
                                                    "Reachable: Dev Mode active (--no-auth confirmed)"
                                                } else {
                                                    "Reachable: Authenticated as ${status.session.user}"
                                                }
                                            }
                                            is AuthStatus.LoginRequired -> "Reachable: Server online (${status.code})"
                                            is AuthStatus.MfaRequired -> "Reachable: Server online (MFA required)"
                                            is AuthStatus.Unavailable -> "Reachable: Service unavailable (${status.code} - ${status.error})"
                                            is AuthStatus.Incompatible -> "Reachable: Protocol mismatch (${status.reason})"
                                        }
                                    } catch (e: Exception) {
                                        if (e is CancellationException) throw e
                                        if (operationGeneration == opGen) {
                                            connectionTestIsReachable = false
                                            connectionTestMessage = if (e is ApiRequestError) {
                                                "Reachable (HTTP ${e.status}): ${e.message}"
                                            } else {
                                                "Unreachable: ${e.message ?: "Connection timed out"}"
                                            }
                                        }
                                    } finally {
                                        if (operationGeneration == opGen) {
                                            isTestingConnection = false
                                        }
                                    }
                                }
                            },
                            enabled = !isBusy,
                            border = BorderStroke(1.dp, DamHopperColors.Border),
                            modifier = Modifier
                                .weight(1f)
                                .height(44.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            if (isTestingConnection) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    color = DamHopperColors.Primary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Text(
                                    "Test Connection",
                                    color = DamHopperColors.TextPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }

                    // Direct Continue shortcut if a profile is selected and already authenticated or has valid vault token
                    val targetProfile = selectedProfileId?.let { id -> profiles.find { it.id == id } }
                    if (targetProfile != null && (isCurrentlyAuthenticated || hasStoredToken)) {
                        Spacer(modifier = Modifier.height(10.dp))
                        Button(
                            onClick = {
                                val targetId = targetProfile.id
                                val targetUrl = targetProfile.normalizedUrl
                                val endpointKey = "$targetId|$targetUrl"
                                val opGen = ++operationGeneration

                                coroutineScope.launch {
                                    isLoading = true
                                    errorMessage = null
                                    try {
                                        val isCleartext = isCleartextHttp(targetUrl)

                                        // Guard: Do not transmit bearer token over cleartext HTTP unless dev mode
                                        if (isCleartext && confirmedDevEndpoints[endpointKey] != true) {
                                            if (operationGeneration == opGen) {
                                                errorMessage = "Security Error: Stored session tokens cannot be sent over unencrypted HTTP for non-dev servers."
                                            }
                                            return@launch
                                        }

                                        val attempt = profileRepository.attemptTracker.startAttempt(targetId)
                                        val client = profileRepository.getOrCreateApiClient(targetId)
                                        val authRepo = AuthRepository(client)
                                        val status = authRepo.checkAuthStatus()

                                        if (operationGeneration != opGen || selectedProfileId != targetId || ServerProfile.normalizeUrl(baseUrl) != targetUrl) {
                                            return@launch
                                        }
                                        profileRepository.attemptTracker.assertActive(attempt)

                                        if (status is AuthStatus.Authenticated) {
                                            profileRepository.selectProfile(targetId)
                                            onAuthenticated(targetId)
                                        } else {
                                            errorMessage = "Stored session expired. Please log in again."
                                        }
                                    } catch (e: Exception) {
                                        if (e is CancellationException) throw e
                                        if (operationGeneration == opGen) {
                                            errorMessage = "Session check failed: ${e.message ?: "Network error"}"
                                        }
                                    } finally {
                                        if (operationGeneration == opGen) {
                                            isLoading = false
                                        }
                                    }
                                }
                            },
                            enabled = !isBusy,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = DamHopperColors.Secondary,
                                disabledContainerColor = DamHopperColors.SurfaceVariant
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                "Continue with ${targetProfile.name} \u2192",
                                color = DamHopperColors.Background,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileRowItem(
    profile: ServerProfile,
    isSelected: Boolean,
    isActive: Boolean,
    status: AuthStatus?,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    enabled: Boolean,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val borderColor = when {
        isSelected -> DamHopperColors.Primary
        isActive -> DamHopperColors.Secondary
        else -> DamHopperColors.Border
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(if (isSelected) 2.dp else 1.dp, borderColor, RoundedCornerShape(8.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(12.dp)
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = profile.name,
                        color = DamHopperColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )

                    if (isActive) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Surface(
                            color = DamHopperColors.Secondary.copy(alpha = 0.2f),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text(
                                text = "ACTIVE",
                                color = DamHopperColors.Secondary,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                            )
                        }
                    }

                    if (isSelected && !isActive) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Surface(
                            color = DamHopperColors.Primary.copy(alpha = 0.2f),
                            shape = RoundedCornerShape(4.dp)
                        ) {
                            Text(
                                text = "SELECTED",
                                color = DamHopperColors.Primary,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                            )
                        }
                    }
                }

                if (!showDeleteConfirm) {
                    TextButton(
                        onClick = { showDeleteConfirm = true },
                        enabled = enabled
                    ) {
                        Text("\u2715", color = DamHopperColors.TextSecondary, fontSize = 14.sp)
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(
                            onClick = onDelete,
                            enabled = enabled
                        ) {
                            Text("Delete?", color = DamHopperColors.Error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        TextButton(
                            onClick = { showDeleteConfirm = false },
                            enabled = enabled
                        ) {
                            Text("No", color = DamHopperColors.TextSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(2.dp))

            Text(
                text = profile.baseUrl,
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace
            )

            if (profile.username != null) {
                Text(
                    text = "User: ${profile.username}",
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Auth status indicator
            val (statusText, statusColor) = when (status) {
                is AuthStatus.Authenticated -> {
                    if (status.session.devMode) {
                        "Dev Mode (\u2713)" to DamHopperColors.Secondary
                    } else {
                        "Authenticated (${status.session.user})" to DamHopperColors.Secondary
                    }
                }
                is AuthStatus.MfaRequired -> "MFA Required" to DamHopperColors.Warning
                is AuthStatus.LoginRequired -> "Login Required" to DamHopperColors.TextSecondary
                is AuthStatus.Unavailable -> "Unavailable" to DamHopperColors.Error
                is AuthStatus.Incompatible -> "Incompatible" to DamHopperColors.Error
                null -> "Not Authenticated" to DamHopperColors.TextSecondary
            }

            Text(
                text = "\u25CF $statusText",
                color = statusColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun PresetChip(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(16.dp),
        color = DamHopperColors.SurfaceVariant,
        border = BorderStroke(1.dp, DamHopperColors.Border),
        modifier = Modifier.padding(vertical = 2.dp)
    ) {
        Text(
            text = label,
            color = if (enabled) DamHopperColors.Primary else DamHopperColors.TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
        )
    }
}
