package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.notifications.AppNotification
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationSink
import dev.damhopper.nativeapp.core.notifications.NotificationTarget
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography

/**
 * Screen presenting Notifications configuration, Agent Attention Policies, and Channel Diagnostics.
 * Strictly adheres to 0 FABs, zero browser engines, Dark Workbench theme, and DamHopperColors invariants.
 */
@Composable
fun NotificationsView(
    settingsRepository: SettingsRepository,
    notificationSink: NotificationSink? = null,
    modifier: Modifier = Modifier,
) {
    val preferences by settingsRepository.preferences.collectAsState()
    val agentNotifs = preferences.terminalAgentNotifications
    val scrollState = rememberScrollState()

    var testNotificationStatus by remember { mutableStateOf<String?>(null) }
    val systemNotificationsEnabled = notificationSink?.areNotificationsEnabled() ?: false

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .verticalScroll(scrollState)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Test Notification Status Feedback Banner
        if (testNotificationStatus != null) {
            Card(
                shape = RoundedCornerShape(6.dp),
                colors = CardDefaults.cardColors(containerColor = DamHopperColors.Success.copy(alpha = 0.15f)),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, DamHopperColors.Success, RoundedCornerShape(6.dp)),
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = testNotificationStatus!!,
                        color = DamHopperColors.Success,
                        style = DamHopperTypography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = { testNotificationStatus = null },
                        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    ) {
                        Text("Dismiss", color = DamHopperColors.TextSecondary, fontSize = 11.sp)
                    }
                }
            }
        }

        // 0. System Permission Status Banner
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (systemNotificationsEnabled) DamHopperColors.Surface else DamHopperColors.Warning.copy(alpha = 0.15f)
            ),
            modifier = Modifier
                .fillMaxWidth()
                .border(
                    1.dp,
                    if (systemNotificationsEnabled) DamHopperColors.Border else DamHopperColors.Warning,
                    RoundedCornerShape(8.dp)
                ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "System Notification Permission",
                        style = DamHopperTypography.titleMedium,
                        color = DamHopperColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = if (systemNotificationsEnabled)
                            "OS notification permission granted. Alerts will be delivered."
                        else
                            "OS notifications disabled or permission not granted. Enable notifications in Android Settings.",
                        style = DamHopperTypography.bodyMedium,
                        color = if (systemNotificationsEnabled) DamHopperColors.TextSecondary else DamHopperColors.Warning,
                    )
                }
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (systemNotificationsEnabled) DamHopperColors.Success.copy(alpha = 0.2f) else DamHopperColors.Warning.copy(alpha = 0.3f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = if (systemNotificationsEnabled) "Granted" else "Disabled",
                        color = if (systemNotificationsEnabled) DamHopperColors.Success else DamHopperColors.Warning,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        // 1. Master Notifications Control Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                        Text(
                            text = "Terminal Agent Notifications",
                            style = DamHopperTypography.titleMedium,
                            color = DamHopperColors.TextPrimary,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = "Master toggle gating semantic agent turn-ended and needs-attention alerts across all terminals.",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.TextSecondary,
                        )
                    }

                    Switch(
                        checked = agentNotifs.masterEnabled,
                        onCheckedChange = { checked ->
                            settingsRepository.updatePreferences { prefs ->
                                prefs.copy(
                                    terminalAgentNotifications = prefs.terminalAgentNotifications.copy(
                                        masterEnabled = checked,
                                    ),
                                )
                            }
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = DamHopperColors.Background,
                            checkedTrackColor = DamHopperColors.Primary,
                            uncheckedThumbColor = DamHopperColors.TextSecondary,
                            uncheckedTrackColor = DamHopperColors.SurfaceVariant,
                        ),
                    )
                }
            }
        }

        // 2. Agent Policy: OMP
        AgentPolicyCard(
            title = "OMP (OpenCode / Oh-My-Posh / OMP Agent)",
            badgeText = "Turn-Ended & Needs-Attention",
            description = "Fires attention notifications when an automated turn completes or when the model requires user confirmation / approval.",
            masterEnabled = agentNotifs.masterEnabled,
            policy = agentNotifs.omp,
            isPolicyEditable = true,
            onPolicyChange = { updated ->
                settingsRepository.updatePreferences { prefs ->
                    prefs.copy(
                        terminalAgentNotifications = prefs.terminalAgentNotifications.copy(
                            omp = updated,
                        ),
                    )
                }
            },
        )

        // 3. Agent Policy: Claude
        AgentPolicyCard(
            title = "Claude Agent",
            badgeText = "Qualified Attention-Only",
            description = "Fires only when human attention is strictly required (approval prompts, questions, error states). Normal turn-ended notifications are suppressed per specification.",
            masterEnabled = agentNotifs.masterEnabled,
            policy = agentNotifs.claude,
            isPolicyEditable = true,
            onPolicyChange = { updated ->
                settingsRepository.updatePreferences { prefs ->
                    prefs.copy(
                        terminalAgentNotifications = prefs.terminalAgentNotifications.copy(
                            claude = updated,
                        ),
                    )
                }
            },
        )

        // 4. Agent Policy: Codex
        AgentPolicyCard(
            title = "Codex Agent",
            badgeText = "Status Only (Alerts Disabled)",
            description = "Codex hooks provide lifecycle status badges only. Terminal notifications and OSC 9 alerts are disabled per security protocol.",
            masterEnabled = false,
            policy = agentNotifs.codex.copy(enabled = false),
            isPolicyEditable = false,
            onPolicyChange = {},
        )

        // 5. Notification Channels & Diagnostics Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Notification Channels & Diagnostics",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Registered system notification channels for terminal alerts, transfer completions, and idle suspend warnings.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(12.dp))

                NotificationChannelId.entries.forEach { channel ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(
                                text = channel.channelName,
                                style = DamHopperTypography.bodyMedium,
                                color = DamHopperColors.TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = channel.id,
                                style = DamHopperTypography.labelSmall,
                                color = DamHopperColors.TextSecondary,
                                fontFamily = FontFamily.Monospace,
                            )
                        }

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(DamHopperColors.SurfaceVariant)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Text(
                                text = "Registered",
                                color = DamHopperColors.Secondary,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = {
                            if (notificationSink != null) {
                                if (!notificationSink.areNotificationsEnabled()) {
                                    testNotificationStatus = "Cannot post: system notifications are disabled or permission not granted."
                                } else {
                                    val testNotification = AppNotification(
                                        id = 9999,
                                        channel = NotificationChannelId.TERMINAL_ATTENTION,
                                        target = NotificationTarget(
                                            profileId = "test-target",
                                            generation = 1L,
                                        ),
                                        title = "DamHopper Agent Alert",
                                        body = "Test notification dispatched to channel_terminal_attention",
                                    )
                                    notificationSink.postNotification(testNotification)
                                    testNotificationStatus = "Test notification posted to channel_terminal_attention."
                                }
                            } else {
                                testNotificationStatus = "Notification sink not attached in current environment."
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                        modifier = Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Send Test Alert", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }

                    Button(
                        onClick = {
                            notificationSink?.cancelAll()
                            testNotificationStatus = "Active notifications cleared."
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.SurfaceVariant),
                        modifier = Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text("Clear All Alerts", color = DamHopperColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentPolicyCard(
    title: String,
    badgeText: String,
    description: String,
    masterEnabled: Boolean,
    policy: TerminalAgentPolicy,
    isPolicyEditable: Boolean,
    onPolicyChange: (TerminalAgentPolicy) -> Unit,
) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = title,
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = badgeText,
                        color = if (isPolicyEditable) DamHopperColors.Primary else DamHopperColors.TextSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = description,
                style = DamHopperTypography.bodyMedium,
                color = DamHopperColors.TextSecondary,
                lineHeight = 18.sp,
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Policy Master Toggle
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 48.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Enable Policy for $title",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                )

                Switch(
                    checked = policy.enabled && masterEnabled,
                    enabled = isPolicyEditable && masterEnabled,
                    onCheckedChange = { checked ->
                        onPolicyChange(policy.copy(enabled = checked))
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = DamHopperColors.Background,
                        checkedTrackColor = DamHopperColors.Primary,
                        uncheckedThumbColor = DamHopperColors.TextSecondary,
                        uncheckedTrackColor = DamHopperColors.SurfaceVariant,
                    ),
                )
            }

            if (isPolicyEditable) {
                Spacer(modifier = Modifier.height(8.dp))

                // Delivery Channels Checkboxes
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ChannelCheckbox(
                        label = "Toast",
                        checked = policy.toast,
                        enabled = policy.enabled && masterEnabled,
                        onCheckedChange = { checked ->
                            onPolicyChange(policy.copy(toast = checked))
                        },
                    )

                    ChannelCheckbox(
                        label = "Sound",
                        checked = policy.sound,
                        enabled = policy.enabled && masterEnabled,
                        onCheckedChange = { checked ->
                            onPolicyChange(policy.copy(sound = checked))
                        },
                    )

                    ChannelCheckbox(
                        label = "Browser",
                        checked = policy.browser,
                        enabled = policy.enabled && masterEnabled,
                        onCheckedChange = { checked ->
                            onPolicyChange(policy.copy(browser = checked))
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ChannelCheckbox(
    label: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
    ) {
        Checkbox(
            checked = checked,
            enabled = enabled,
            onCheckedChange = onCheckedChange,
            colors = CheckboxDefaults.colors(
                checkedColor = DamHopperColors.Primary,
                uncheckedColor = DamHopperColors.Border,
                checkmarkColor = Color.Black,
            ),
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = label,
            style = DamHopperTypography.bodyMedium,
            color = if (enabled) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary,
        )
    }
}
