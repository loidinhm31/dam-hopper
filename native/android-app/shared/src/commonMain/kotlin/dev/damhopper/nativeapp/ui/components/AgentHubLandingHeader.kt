package dev.damhopper.nativeapp.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingCallbacks
import dev.damhopper.nativeapp.ui.flow.AgentHubLandingUiState
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

const val TAG_HEADER_AGENTS_TRIGGER: String = "agent-hub-header:agents-trigger"
const val TAG_HEADER_FILES_TRIGGER: String = "agent-hub-header:files-trigger"
const val TAG_HEADER_CONTEXT_PILL: String = "agent-hub-header:context-pill"
const val TAG_HEADER_NOTIFICATIONS: String = "agent-hub-header:notifications"
const val TAG_HEADER_SETTINGS: String = "agent-hub-header:settings"

@Composable
fun AgentHubLandingHeader(
    state: AgentHubLandingUiState,
    callbacks: AgentHubLandingCallbacks,
    isCompact: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val barHeight = if (isCompact) 56.dp else 48.dp

    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(barHeight)
            .background(DamHopperColors.Surface)
            .border(1.dp, DamHopperColors.Border)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 1. Agents Sidebar Trigger
        Box(
            modifier = Modifier
                .testTag(TAG_HEADER_AGENTS_TRIGGER)
                .semantics { role = Role.Button; contentDescription = "Toggle Agents Sidebar" }
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable { callbacks.onToggleAgentsSidebar() }
                .padding(horizontal = 8.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("☰ AGENTS", color = DamHopperColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                if (state.urgencyCounters.attentionCount > 0) {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Color(0xFFD29922))
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                    ) {
                        // Dark text on amber #D29922 gives > 5:1 contrast
                        Text("!${state.urgencyCounters.attentionCount}", color = Color(0xFF0D1117), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        // 2. Server Context Pill
        Box(
            modifier = Modifier
                .testTag(TAG_HEADER_CONTEXT_PILL)
                .semantics { role = Role.Button; contentDescription = "Active Server Profile: ${state.profileName}" }
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(DamHopperColors.SurfaceVariant)
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                .clickable { callbacks.onSwitchProfile() }
                .padding(horizontal = 8.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (state.isOnline) Color(0xFF3FB950) else Color(0xFFF85149)),
                )
                Text(
                    text = state.profileName,
                    color = DamHopperColors.TextPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (state.isDevMode) {
                    Text("DEV", color = Color(0xFF58A6FF), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                } else if (state.hasMfa) {
                    Text("MFA ✓", color = Color(0xFF3FB950), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // 3. Urgency Counters
        AgentHubUrgencyCountersBar(
            counters = state.urgencyCounters,
            modifier = Modifier.padding(horizontal = 4.dp),
        )

        Spacer(Modifier.weight(1f))

        // 4. Files Sidebar Trigger
        Box(
            modifier = Modifier
                .testTag(TAG_HEADER_FILES_TRIGGER)
                .semantics { role = Role.Button; contentDescription = "Toggle Files Sidebar" }
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable { callbacks.onToggleFilesSidebar() }
                .padding(horizontal = 8.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("📁 FILES", color = DamHopperColors.Primary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }

        // 5. Notifications Trigger
        Box(
            modifier = Modifier
                .testTag(TAG_HEADER_NOTIFICATIONS)
                .semantics { role = Role.Button; contentDescription = "Notifications" }
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable { callbacks.onOpenNotifications() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Notifications, contentDescription = null, tint = DamHopperColors.TextSecondary, modifier = Modifier.size(18.dp))
        }

        // 6. Settings Trigger
        Box(
            modifier = Modifier
                .testTag(TAG_HEADER_SETTINGS)
                .semantics { role = Role.Button; contentDescription = "Settings" }
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable { callbacks.onOpenSettings() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Settings, contentDescription = null, tint = DamHopperColors.TextSecondary, modifier = Modifier.size(18.dp))
        }
    }
}
