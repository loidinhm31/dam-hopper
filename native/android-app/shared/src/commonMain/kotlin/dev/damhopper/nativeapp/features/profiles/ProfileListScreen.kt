package dev.damhopper.nativeapp.features.profiles

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun ProfileListScreen(
    profiles: List<ServerProfile>,
    activeProfileId: String?,
    authStatuses: Map<String, AuthStatus>,
    onSelectProfile: (String) -> Unit,
    onAddProfile: (name: String, url: String, username: String?) -> Unit,
    onDeleteProfile: (String) -> Unit,
    onOpenAuth: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showAddForm by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = DamHopperColors.Surface,
        shape = RoundedCornerShape(8.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Server Profiles",
                    color = DamHopperColors.TextPrimary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = onClose) {
                    Text("Close", color = DamHopperColors.Primary)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            if (!showAddForm) {
                Button(
                    onClick = { showAddForm = true },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Primary),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("+ Add Server Profile", color = DamHopperColors.Background)
                }
            } else {
                AddProfileCard(
                    onSave = { name, url, username ->
                        onAddProfile(name, url, username)
                        showAddForm = false
                    },
                    onCancel = { showAddForm = false }
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
                items(profiles, key = { it.id }) { profile ->
                    val isActive = profile.id == activeProfileId
                    val status = authStatuses[profile.id]
                    ProfileItemRow(
                        profile = profile,
                        isActive = isActive,
                        status = status,
                        onSelect = { onSelectProfile(profile.id) },
                        onAuth = { onOpenAuth(profile.id) },
                        onDelete = { onDeleteProfile(profile.id) }
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                }
            }
        }
    }
}

@Composable
private fun ProfileItemRow(
    profile: ServerProfile,
    isActive: Boolean,
    status: AuthStatus?,
    onSelect: () -> Unit,
    onAuth: () -> Unit,
    onDelete: () -> Unit
) {
    val borderColor = if (isActive) DamHopperColors.Primary else DamHopperColors.Border
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(DamHopperColors.SurfaceVariant)
            .border(1.dp, borderColor, RoundedCornerShape(6.dp))
            .clickable(onClick = onSelect)
            .padding(10.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = profile.name,
                        color = DamHopperColors.TextPrimary,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp
                    )
                    if (isActive) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "(Active)",
                            color = DamHopperColors.Primary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                Text(
                    text = profile.baseUrl,
                    color = DamHopperColors.TextSecondary,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onAuth) {
                    val label = when (status) {
                        is AuthStatus.Authenticated -> "Auth \u2713"
                        is AuthStatus.MfaRequired -> "MFA !"
                        else -> "Login"
                    }
                    val col = when (status) {
                        is AuthStatus.Authenticated -> DamHopperColors.Secondary
                        is AuthStatus.MfaRequired -> DamHopperColors.Warning
                        else -> DamHopperColors.Primary
                    }
                    Text(label, color = col, fontSize = 12.sp)
                }
                TextButton(onClick = onDelete) {
                    Text("\u2715", color = DamHopperColors.Error, fontSize = 12.sp)
                }
            }
        }
    }
}
