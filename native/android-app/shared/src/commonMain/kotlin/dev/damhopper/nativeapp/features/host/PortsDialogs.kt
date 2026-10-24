package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun CreateTunnelDialog(
    initialPort: Int?,
    onDismiss: () -> Unit,
    onCreate: (port: Int, label: String) -> Unit
) {
    var portText by remember { mutableStateOf(initialPort?.toString() ?: "") }
    var labelText by remember { mutableStateOf(if (initialPort != null) "port-$initialPort" else "") }
    val portInt = portText.toIntOrNull()
    val isPortValid = portInt != null && portInt in 1..65535
    val isLabelValid = labelText.isNotBlank() && labelText.trim().length <= 64
    val canSubmit = isPortValid && isLabelValid

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
                text = "Create Cloudflare Tunnel",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
            Text(
                text = "Exposes a remote host port through an encrypted Cloudflare Tunnel. Public exposure persists until stopped.",
                fontSize = 12.sp,
                color = DamHopperColors.TextSecondary
            )

            OutlinedTextField(
                value = portText,
                onValueChange = { portText = it.filter { ch -> ch.isDigit() } },
                label = { Text("Port (1-65535)", fontSize = 11.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = labelText,
                onValueChange = { labelText = it },
                label = { Text("Tunnel Label (max 64 chars)", fontSize = 11.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = onDismiss) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = {
                        if (canSubmit && portInt != null) {
                            onCreate(portInt, labelText.trim())
                        }
                    },
                    enabled = canSubmit,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                ) {
                    Text("Create Tunnel")
                }
            }
        }
    }
}

@Composable
fun InstallCloudflaredDialog(
    isInstalling: Boolean,
    onDismiss: () -> Unit,
    onInstall: () -> Unit
) {
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
                text = "Install Cloudflared Binary",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )
            Text(
                text = "The remote host server requires the 'cloudflared' binary to create public tunnels. Start automatic server-side installation?",
                fontSize = 12.sp,
                color = DamHopperColors.TextSecondary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onDismiss, enabled = !isInstalling) {
                    Text("Cancel", color = DamHopperColors.TextSecondary)
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = onInstall,
                    enabled = !isInstalling,
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary)
                ) {
                    if (isInstalling) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Installing...")
                    } else {
                        Text("Install on Server")
                    }
                }
            }
        }
    }
}

@Composable
fun QrCodeDialog(
    url: String,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(DamHopperColors.Surface)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "Public Tunnel URL",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = DamHopperColors.TextPrimary
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(12.dp)
            ) {
                Text(
                    text = url,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = DamHopperColors.Primary,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Text(
                text = "Anyone with this public link can reach your forwarded port until the tunnel is explicitly stopped.",
                fontSize = 11.sp,
                color = DamHopperColors.Warning
            )

            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant)
            ) {
                Text("Close", color = DamHopperColors.TextPrimary)
            }
        }
    }
}
