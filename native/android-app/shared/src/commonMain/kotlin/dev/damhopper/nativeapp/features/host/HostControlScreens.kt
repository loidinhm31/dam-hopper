package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import kotlinx.coroutines.launch

@Composable
fun HostControlScreens(
    idleConsentController: IdleConsentController,
    sshRepository: SshRepository,
    hostControlRepository: HostControlRepository,
    diagnosticsRepository: DiagnosticsRepository
) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Idle Suspend", "SSH Credentials", "Diagnostics & Actions")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // Tab selector row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.SurfaceVariant)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            tabs.forEachIndexed { index, title ->
                val isSelected = selectedTab == index
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isSelected) DamHopperColors.Accent else DamHopperColors.Surface)
                        .clickable { selectedTab = index }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = title,
                        color = if (isSelected) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        when (selectedTab) {
            0 -> IdleSuspendTabScreen(idleConsentController = idleConsentController)
            1 -> SshCredentialsTabScreen(sshRepository = sshRepository)
            2 -> DiagnosticsAndActionsTabScreen(
                hostControlRepository = hostControlRepository,
                diagnosticsRepository = diagnosticsRepository
            )
        }
    }
}

@Composable
private fun IdleSuspendTabScreen(
    idleConsentController: IdleConsentController
) {
    val coroutineScope = rememberCoroutineScope()
    val status by idleConsentController.status.collectAsState()
    val isLoading by idleConsentController.isLoading.collectAsState()
    val actionError by idleConsentController.actionError.collectAsState()
    val activeFleetConflict by idleConsentController.activeFleetConflict.collectAsState()
    val fleetChangedConflict by idleConsentController.fleetChangedConflict.collectAsState()
    val lastAdmission by idleConsentController.lastForceSuspendAdmission.collectAsState()
    val isSubmittingForce by idleConsentController.isSubmittingForceSuspend.collectAsState()

    var showForceDialog by remember { mutableStateOf(false) }
    var quietSecText by remember { mutableStateOf("300") }
    var wakeSecText by remember { mutableStateOf("600") }

    LaunchedEffect(status) {
        status?.let {
            quietSecText = it.quietPeriodSeconds.toString()
            wakeSecText = it.wakeAfterSeconds.toString()
        }
    }

    LaunchedEffect(Unit) {
        idleConsentController.refreshStatus()
    }

    // Auto-open force dialog if conflict arises from submission
    LaunchedEffect(activeFleetConflict, fleetChangedConflict) {
        if (activeFleetConflict != null || fleetChangedConflict != null) {
            showForceDialog = true
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Status & Refresh Header
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Terminal Idle Sleep Coordination",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Surface)
                        .clickable { coroutineScope.launch { idleConsentController.refreshStatus() } }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = if (isLoading) "Refreshing..." else "Refresh",
                        fontSize = 11.sp,
                        color = DamHopperColors.TextPrimary
                    )
                }
            }
        }

        // Error message if any
        if (actionError != null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Error.copy(alpha = 0.2f))
                        .padding(8.dp)
                ) {
                    Text(
                        text = actionError ?: "",
                        fontSize = 11.sp,
                        color = DamHopperColors.Error
                    )
                }
            }
        }

        // Status Card
        item {
            val s = status
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Remote Host Status",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )

                if (s == null) {
                    Text("Fetching authoritative status...", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Coordinator State", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        val (stateBg, stateFg) = when (s.state) {
                            IdleSuspendState.DISABLED -> Pair(DamHopperColors.SurfaceVariant, DamHopperColors.TextSecondary)
                            IdleSuspendState.WATCHING -> Pair(DamHopperColors.Primary.copy(alpha = 0.2f), DamHopperColors.Primary)
                            IdleSuspendState.ARMED -> Pair(DamHopperColors.Warning.copy(alpha = 0.2f), DamHopperColors.Warning)
                            IdleSuspendState.HANDED_OFF -> Pair(DamHopperColors.Success.copy(alpha = 0.2f), DamHopperColors.Success)
                            IdleSuspendState.FAILED -> Pair(DamHopperColors.Error.copy(alpha = 0.2f), DamHopperColors.Error)
                            else -> Pair(DamHopperColors.SurfaceVariant, DamHopperColors.TextPrimary)
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(stateBg)
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(s.state.name, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = stateFg)
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Automatic Policy", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text(s.automaticPolicy.name.lowercase().replace('_', '-'), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DamHopperColors.TextPrimary)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Capability Driver", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text(s.capabilityCode, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = DamHopperColors.TextPrimary)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Revision / Epoch", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text("rev ${s.statusRevision} • epoch ${s.currentEpoch}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Active Fleet Sessions", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text("${s.fleetSnapshot.liveCount} live (gen ${s.fleetSnapshot.generation})", fontSize = 11.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }

        // Timing Settings Card
        item {
            val s = status
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Automatic Timing Settings",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )

                if (s?.timingMutable == false) {
                    Text(
                        text = "Timing is currently locked: ${s.timingMutableReason ?: "coordinator policy"}",
                        fontSize = 11.sp,
                        color = DamHopperColors.Warning
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = quietSecText,
                        onValueChange = { quietSecText = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Quiet sec (${s?.minQuietPeriodSeconds ?: 60}-${s?.maxQuietPeriodSeconds ?: 86400})", fontSize = 10.sp) },
                        singleLine = true,
                        enabled = s?.timingMutable == true,
                        modifier = Modifier.weight(1f)
                    )

                    OutlinedTextField(
                        value = wakeSecText,
                        onValueChange = { wakeSecText = it.filter { ch -> ch.isDigit() } },
                        label = { Text("Wake sec (${s?.minWakeAfterSeconds ?: 60}-${s?.maxWakeAfterSeconds ?: 86400})", fontSize = 10.sp) },
                        singleLine = true,
                        enabled = s?.timingMutable == true,
                        modifier = Modifier.weight(1f)
                    )
                }

                val qVal = quietSecText.toIntOrNull()
                val wVal = wakeSecText.toIntOrNull()
                val isTimingValid = qVal != null && qVal in 60..86400 && wVal != null && wVal in 60..86400

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (isTimingValid && s?.timingMutable == true) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                        .clickable(enabled = isTimingValid && s?.timingMutable == true) {
                            if (qVal != null && wVal != null) {
                                coroutineScope.launch {
                                    idleConsentController.updateTiming(qVal, wVal)
                                }
                            }
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "Update Timing Pair",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isTimingValid && s?.timingMutable == true) Color.White else DamHopperColors.TextSecondary
                    )
                }
            }
        }

        // Manual Force Suspend Action Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Manual Host Force Suspend",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )
                Text(
                    text = "Directly initiates host machine suspend through server coordinator admission. Will ask for explicit confirmation.",
                    fontSize = 11.sp,
                    color = DamHopperColors.TextSecondary
                )

                if (lastAdmission != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.Success.copy(alpha = 0.15f))
                            .padding(8.dp)
                    ) {
                        Text(
                            text = "Last admission accepted: ${lastAdmission?.requestId} (state: ${lastAdmission?.state})",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = DamHopperColors.Success
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Error.copy(alpha = 0.2f))
                        .clickable { showForceDialog = true }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = "Force Suspend Host...",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = DamHopperColors.Error
                    )
                }
            }
        }
    }

    if (showForceDialog) {
        ManualForceSuspendDialog(
            isSubmitting = isSubmittingForce,
            activeFleetConflict = activeFleetConflict,
            fleetChangedConflict = fleetChangedConflict,
            onDismiss = {
                showForceDialog = false
                idleConsentController.clearConflicts()
            },
            onConfirm = { wakeSec, force ->
                coroutineScope.launch {
                    val res = idleConsentController.requestForceSuspend(wakeSec, force)
                    if (res.isSuccess) {
                        showForceDialog = false
                    }
                }
            }
        )
    }
}

@Composable
private fun SshCredentialsTabScreen(
    sshRepository: SshRepository
) {
    val coroutineScope = rememberCoroutineScope()
    var keys by remember { mutableStateOf<List<SshKeyInfo>>(emptyList()) }
    var agentStatus by remember { mutableStateOf<SshAgentStatus?>(null) }
    var credentialStatus by remember { mutableStateOf<CredentialStatus?>(null) }
    var perKeySaved by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var isLoading by remember { mutableStateOf(false) }
    var loadKeyTarget by remember { mutableStateOf<SshKeyInfo?>(null) }
    var actionMessage by remember { mutableStateOf<String?>(null) }

    val reload = {
        coroutineScope.launch {
            isLoading = true
            sshRepository.listKeys().onSuccess { kList ->
                keys = kList
                val map = mutableMapOf<String, Boolean>()
                for (k in kList) {
                    sshRepository.getCredentialStatus(k.name).onSuccess { cs ->
                        if (cs.saved) map[k.name] = true
                    }
                }
                perKeySaved = map
            }.onFailure { err ->
                actionMessage = "Failed to fetch keys: ${err.message}"
            }
            sshRepository.checkAgent().onSuccess { agentStatus = it }
            sshRepository.getCredentialStatus().onSuccess { credentialStatus = it }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        reload()
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Remote SSH Credentials",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Surface)
                        .clickable { reload() }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = if (isLoading) "Refreshing..." else "Refresh",
                        fontSize = 11.sp,
                        color = DamHopperColors.TextPrimary
                    )
                }
            }
        }

        if (actionMessage != null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                        .padding(8.dp)
                ) {
                    Text(
                        text = actionMessage ?: "",
                        fontSize = 11.sp,
                        color = DamHopperColors.Primary
                    )
                }
            }
        }

        // SSH Agent Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("Remote SSH Agent", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
                val status = agentStatus
                if (status == null) {
                    Text("Probing ssh-add...", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Status", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text(
                            text = if (status.hasKeys) "Active (${status.keyCount} keys loaded)" else "No loaded keys",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (status.hasKeys) DamHopperColors.Success else DamHopperColors.TextSecondary
                        )
                    }
                }
            }
        }

        // Saved Keyring Passphrase Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("Saved Keyring Credential", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
                val cred = credentialStatus
                if (cred?.saved == true) {
                    Text(
                        text = "A passphrase is saved in the server OS keyring${if (cred.keyPath != null) " for ${cred.keyPath}" else ""}.",
                        fontSize = 11.sp,
                        color = DamHopperColors.Success
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.Error.copy(alpha = 0.2f))
                            .clickable {
                                coroutineScope.launch {
                                    sshRepository.forgetCredential().onSuccess {
                                        actionMessage = "Saved passphrase removed from server keyring"
                                        reload()
                                    }
                                }
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text("Forget Saved Passphrase", fontSize = 11.sp, color = DamHopperColors.Error)
                    }
                } else {
                    Text("No SSH passphrase currently saved in server keyring.", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                }
            }
        }

        // SSH Keys List
        item {
            Text(
                text = "Keys in ~/.ssh on Server (${keys.size})",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        if (keys.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(DamHopperColors.Surface)
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("No private SSH keys found in remote server ~/.ssh.", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                }
            }
        } else {
            items(keys, key = { it.name }) { key ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(DamHopperColors.Surface)
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(key.name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
                        Text(key.path, fontSize = 10.sp, fontFamily = FontFamily.Monospace, color = DamHopperColors.TextSecondary)
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (perKeySaved[key.name] == true) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(DamHopperColors.Error.copy(alpha = 0.2f))
                                    .clickable {
                                        coroutineScope.launch {
                                            sshRepository.forgetCredential(key.name).onSuccess { res ->
                                                actionMessage = if (res.forgotten) {
                                                    "Passphrase for '${key.name}' removed from server keyring"
                                                } else if (!res.success) {
                                                    "Failed to forget '${key.name}': ${res.error}"
                                                } else {
                                                    "No saved passphrase found for '${key.name}'"
                                                }
                                                reload()
                                            }.onFailure { err ->
                                                actionMessage = "Error forgetting credential: ${err.message}"
                                            }
                                        }
                                    }
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text("Forget", fontSize = 11.sp, color = DamHopperColors.Error)
                            }
                        }

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                                .clickable { loadKeyTarget = key }
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text("Load Key...", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = DamHopperColors.Primary)
                        }
                    }
                }
            }
        }
    }

    loadKeyTarget?.let { key ->
        LoadSshKeyDialog(
            keyName = key.name,
            keyPath = key.path,
            isLoading = isLoading,
            onDismiss = { loadKeyTarget = null },
            onLoad = { pass, save ->
                coroutineScope.launch {
                    isLoading = true
                    sshRepository.loadKey(key.name, pass.ifBlank { null }, save)
                        .onSuccess { res ->
                            if (res.success) {
                                actionMessage = if (res.error != null) {
                                    "Loaded '${key.name}' (warning: ${res.error})"
                                } else {
                                    "Loaded '${key.name}' successfully"
                                }
                                loadKeyTarget = null
                                reload()
                            } else {
                                actionMessage = "Failed to load '${key.name}': ${res.error ?: "invalid passphrase"}"
                                isLoading = false
                            }
                        }.onFailure { err ->
                            actionMessage = "Error: ${err.message}"
                            isLoading = false
                        }
                }
            }
        )
    }
}

@Composable
private fun DiagnosticsAndActionsTabScreen(
    hostControlRepository: HostControlRepository,
    diagnosticsRepository: DiagnosticsRepository
) {
    val coroutineScope = rememberCoroutineScope()
    var capabilities by remember { mutableStateOf<ActionCapabilitiesResponse?>(null) }
    var exportResult by remember { mutableStateOf<DiagnosticExportResponse?>(null) }
    var isExporting by remember { mutableStateOf(false) }
    var windowMinutesText by remember { mutableStateOf("60") }
    var includeTerminalOutput by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        hostControlRepository.getCapabilities().onSuccess { capabilities = it }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text(
                text = "Host Diagnostics & Actions",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
        }

        if (statusMessage != null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                        .padding(8.dp)
                ) {
                    Text(statusMessage ?: "", fontSize = 11.sp, color = DamHopperColors.Primary)
                }
            }
        }

        // Host Actions Capabilities Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text("Privileged Host Actions", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
                val cap = capabilities
                if (cap == null) {
                    Text("Querying server capabilities...", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Available", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                        Text(
                            text = if (cap.available) "Yes" else "No",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (cap.available) DamHopperColors.Success else DamHopperColors.Warning
                        )
                    }

                    Text("Reason: ${cap.reason}", fontSize = 10.sp, color = DamHopperColors.TextSecondary)

                    if (cap.actions.isNotEmpty()) {
                        Text("Actions: ${cap.actions.joinToString(", ")}", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        }

        // Diagnostics Export Card
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Server Diagnostics Export", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextPrimary)
                Text(
                    text = "Generate and export server-side diagnostics bundle. Terminal output is excluded by default for privacy.",
                    fontSize = 11.sp,
                    color = DamHopperColors.TextSecondary
                )

                OutlinedTextField(
                    value = windowMinutesText,
                    onValueChange = { windowMinutesText = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Window in minutes (e.g. 60)", fontSize = 10.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Checkbox(
                        checked = includeTerminalOutput,
                        onCheckedChange = { includeTerminalOutput = it }
                    )
                    Text(
                        text = "Include capped terminal output tails (privacy warning)",
                        fontSize = 11.sp,
                        color = if (includeTerminalOutput) DamHopperColors.Warning else DamHopperColors.TextPrimary
                    )
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Primary)
                        .clickable(enabled = !isExporting) {
                            coroutineScope.launch {
                                isExporting = true
                                val mins = windowMinutesText.toIntOrNull() ?: 60
                                val req = DiagnosticExportRequest(
                                    windowMinutes = mins,
                                    includeTerminalOutput = includeTerminalOutput
                                )
                                diagnosticsRepository.exportDiagnostics(req)
                                    .onSuccess { res ->
                                        exportResult = res
                                        statusMessage = "Diagnostics exported successfully (version ${res.diagnosticSchemaVersion})"
                                    }.onFailure { err ->
                                        statusMessage = "Export failed: ${err.message}"
                                    }
                                isExporting = false
                            }
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = if (isExporting) "Exporting..." else "Export Diagnostics Bundle",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    )
                }

                exportResult?.let { res ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.SurfaceVariant)
                            .padding(8.dp)
                    ) {
                        Text(
                            text = "Bundle generated in server daemon memory (schema v${res.diagnosticSchemaVersion}, ${res.generatedAt}). Server recorded events to localConfigJsonl.",
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            color = DamHopperColors.Success
                        )
                    }
                }
            }
        }
    }
}
