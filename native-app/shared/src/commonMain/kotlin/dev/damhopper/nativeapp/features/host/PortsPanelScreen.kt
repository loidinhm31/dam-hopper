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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString

@Composable
fun PortsPanelScreen(
    portRepository: PortRepository,
    tunnelRepository: TunnelRepository,
    onCopyToClipboard: ((String) -> Unit)? = null
) {
    val coroutineScope = rememberCoroutineScope()
    val ports by portRepository.ports.collectAsState()
    val tunnels by tunnelRepository.tunnels.collectAsState()
    val installStatus by tunnelRepository.installStatus.collectAsState()
    val warningDismissed by tunnelRepository.warningDismissed.collectAsState()
    val isPortsLoading by portRepository.isLoading.collectAsState()
    val isTunnelsLoading by tunnelRepository.isLoading.collectAsState()
    val isInstalling by tunnelRepository.isInstalling.collectAsState()
    val clipboardManager = LocalClipboardManager.current
    var copiedUrlNotice by remember { mutableStateOf<String?>(null) }
    val portError by portRepository.errorMessage.collectAsState()
    val tunnelError by tunnelRepository.errorMessage.collectAsState()

    val effectiveCopy: (String) -> Unit = onCopyToClipboard ?: { url ->
        clipboardManager.setText(AnnotatedString(url))
        copiedUrlNotice = "URL copied to clipboard"
    }

    var showCreateDialogWithPort by remember { mutableStateOf<Int?>(null) }
    var showInstallDialog by remember { mutableStateOf(false) }
    var viewTunnelUrl by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        portRepository.refreshPorts()
        tunnelRepository.refreshTunnels()
        tunnelRepository.refreshInstallStatus()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // Top action bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.SurfaceVariant)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = "Ports & Tunnels",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )
                Text(
                    text = "Remote host listening ports & Cloudflare tunnels",
                    fontSize = 11.sp,
                    color = DamHopperColors.TextSecondary
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (installStatus?.installed == false) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.Warning.copy(alpha = 0.2f))
                            .clickable { showInstallDialog = true }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = if (isInstalling) "Installing..." else "Install Cloudflared",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = DamHopperColors.Warning
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Surface)
                        .clickable {
                            coroutineScope.launch {
                                portRepository.refreshPorts()
                                tunnelRepository.refreshTunnels()
                                tunnelRepository.refreshInstallStatus()
                            }
                        }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = if (isPortsLoading || isTunnelsLoading) "Refreshing..." else "Refresh",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = DamHopperColors.TextPrimary
                    )
                }
            }
        }

        // Public exposure warning banner
        if (!warningDismissed) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(DamHopperColors.Warning.copy(alpha = 0.15f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Public URL: exposure persists until explicitly stopped, even if origin port or terminal closes.",
                    fontSize = 11.sp,
                    color = DamHopperColors.Warning,
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Got it",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.Warning,
                    modifier = Modifier.clickable { tunnelRepository.dismissWarning() }
                )
            }
        }
        // Action error or notice banner
        val activeNotice = copiedUrlNotice ?: tunnelError ?: portError
        if (activeNotice != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(if (copiedUrlNotice != null) DamHopperColors.Success.copy(alpha = 0.2f) else DamHopperColors.Error.copy(alpha = 0.2f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = activeNotice,
                    fontSize = 11.sp,
                    color = if (copiedUrlNotice != null) DamHopperColors.Success else DamHopperColors.Error,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = "Dismiss",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextSecondary,
                    modifier = Modifier.clickable { copiedUrlNotice = null }
                )
            }
        }


        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Section: Active Tunnels
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Active Tunnels (${tunnels.size})",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = DamHopperColors.TextPrimary
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                            .clickable { showCreateDialogWithPort = 0 }
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = "+ New Tunnel",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = DamHopperColors.Primary
                        )
                    }
                }
            }

            if (tunnels.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(DamHopperColors.Surface)
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No active Cloudflare tunnels. Forward a listening port below or create a custom tunnel.",
                            fontSize = 12.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                }
            } else {
                items(tunnels, key = { it.id }) { tunnel ->
                    TunnelItemCard(
                        tunnel = tunnel,
                        onStop = {
                            coroutineScope.launch {
                                tunnelRepository.stopTunnel(tunnel.id)
                            }
                        },
                        onViewUrl = { viewTunnelUrl = it },
                        onCopy = effectiveCopy
                    )
                }
            }

            // Section: Detected Listening Ports
            item {
                Text(
                    text = "Detected Listening Ports (${ports.size})",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }

            if (ports.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(DamHopperColors.Surface)
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No listening ports detected on remote host proc/net.",
                            fontSize = 12.sp,
                            color = DamHopperColors.TextSecondary
                        )
                    }
                }
            } else {
                items(ports, key = { it.port }) { port ->
                    PortItemCard(
                        port = port,
                        onCreateTunnel = {
                            showCreateDialogWithPort = port.port
                        }
                    )
                }
            }
        }
    }

    // Dialogs
    showCreateDialogWithPort?.let { initialPort ->
        CreateTunnelDialog(
            initialPort = if (initialPort > 0) initialPort else null,
            onDismiss = { showCreateDialogWithPort = null },
            onCreate = { port, label ->
                showCreateDialogWithPort = null
                coroutineScope.launch {
                    tunnelRepository.createTunnel(port, label)
                }
            }
        )
    }

    if (showInstallDialog) {
        InstallCloudflaredDialog(
            isInstalling = isInstalling,
            onDismiss = { showInstallDialog = false },
            onInstall = {
                coroutineScope.launch {
                    tunnelRepository.installCloudflared()
                    showInstallDialog = false
                }
            }
        )
    }

    viewTunnelUrl?.let { url ->
        QrCodeDialog(
            url = url,
            onDismiss = { viewTunnelUrl = null }
        )
    }
}

@Composable
private fun TunnelItemCard(
    tunnel: TunnelSession,
    onStop: () -> Unit,
    onViewUrl: (String) -> Unit,
    onCopy: ((String) -> Unit)?
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.Surface)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = tunnel.label,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "Port ${tunnel.port}",
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = DamHopperColors.TextSecondary
                    )
                }
            }

            // Status Badge
            val (statusText, statusBg, statusFg) = when (tunnel.status) {
                TunnelStatus.READY -> Triple("READY", DamHopperColors.Success.copy(alpha = 0.2f), DamHopperColors.Success)
                TunnelStatus.STARTING -> Triple("STARTING", DamHopperColors.Primary.copy(alpha = 0.2f), DamHopperColors.Primary)
                TunnelStatus.FAILED -> Triple("FAILED", DamHopperColors.Error.copy(alpha = 0.2f), DamHopperColors.Error)
                TunnelStatus.STOPPED -> Triple("STOPPED", DamHopperColors.SurfaceVariant, DamHopperColors.TextSecondary)
            }

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(statusBg)
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    text = statusText,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = statusFg
                )
            }
        }

        // 3h Reminder Due Banner
        if (tunnel.reminderDue) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.Warning.copy(alpha = 0.15f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "3-hour reminder: tunnel exposure has been active for over 3 hours. Stop if no longer in use.",
                    fontSize = 10.sp,
                    color = DamHopperColors.Warning
                )
            }
        }

        // Public URL row
        if (tunnel.status == TunnelStatus.READY && !tunnel.url.isNullOrBlank()) {
            val url = tunnel.url
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = url,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = DamHopperColors.Primary,
                    modifier = Modifier.weight(1f)
                )

                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(DamHopperColors.Surface)
                            .clickable { onCopy?.invoke(url) }
                            .padding(horizontal = 6.dp, vertical = 3.dp)
                    ) {
                        Text("Copy", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                    }
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(DamHopperColors.Surface)
                            .clickable { onViewUrl(url) }
                            .padding(horizontal = 6.dp, vertical = 3.dp)
                    ) {
                        Text("View", fontSize = 10.sp, color = DamHopperColors.TextPrimary)
                    }
                }
            }
        } else if (tunnel.status == TunnelStatus.FAILED && !tunnel.error.isNullOrBlank()) {
            Text(
                text = "Error: ${tunnel.error}",
                fontSize = 11.sp,
                color = DamHopperColors.Error
            )
        }

        // Action controls
        if (tunnel.status != TunnelStatus.STOPPED) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.Error.copy(alpha = 0.15f))
                        .clickable { onStop() }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "Stop Tunnel",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = DamHopperColors.Error
                    )
                }
            }
        }
    }
}

@Composable
private fun PortItemCard(
    port: DetectedPort,
    onCreateTunnel: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(DamHopperColors.Surface)
            .padding(12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = port.port.toString(),
                    fontSize = 16.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    color = DamHopperColors.TextPrimary
                )

                val (badgeText, badgeBg, badgeFg) = when (port.state) {
                    PortState.LISTENING -> Triple("LISTENING", DamHopperColors.Success.copy(alpha = 0.2f), DamHopperColors.Success)
                    PortState.PROVISIONAL -> Triple("PROVISIONAL", DamHopperColors.Warning.copy(alpha = 0.2f), DamHopperColors.Warning)
                    PortState.LOST -> Triple("LOST", DamHopperColors.SurfaceVariant, DamHopperColors.TextSecondary)
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(badgeBg)
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = badgeText,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        color = badgeFg
                    )
                }
            }

            Text(
                text = "Detected via ${port.detectedVia.name.lowercase().replace('_', '.')}${if (!port.project.isNullOrBlank()) " • ${port.project}" else ""}",
                fontSize = 10.sp,
                color = DamHopperColors.TextSecondary
            )
        }

        if (port.state != PortState.LOST) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(DamHopperColors.Primary.copy(alpha = 0.2f))
                    .clickable { onCreateTunnel() }
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "Forward / Tunnel",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = DamHopperColors.Primary
                )
            }
        }
    }
}
