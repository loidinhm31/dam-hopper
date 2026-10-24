package dev.damhopper.nativeapp.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.security.PrivacyController
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.launch

/**
 * Screen presenting all Workbench Preferences & Privacy controls.
 * Adheres to 0 FABs, zero browser engines, Dark Workbench theme, and DamHopperColors invariants.
 */
@Composable
fun PreferencesPrivacyView(
    settingsRepository: SettingsRepository,
    privacyController: PrivacyController,
    availableProfiles: List<ServerProfile>,
    modifier: Modifier = Modifier,
) {
    val preferences by settingsRepository.preferences.collectAsState()
    val sourceTargetState by settingsRepository.sourceTargetState.collectAsState()
    val scrollState = rememberScrollState()
    val coroutineScope = rememberCoroutineScope()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .verticalScroll(scrollState)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // 1. Preferences Source Server Card
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
                        text = "Preferences Source Server",
                        style = DamHopperTypography.titleMedium,
                        color = DamHopperColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                    )

                    // Status Badge
                    val statusText = when (sourceTargetState.preferencesStatus) {
                        PreferenceSourceStatus.ACTIVE -> "Active"
                        PreferenceSourceStatus.SOURCE_REMOVED -> "Source Removed"
                        PreferenceSourceStatus.UNSET -> "Local Only"
                    }
                    val statusBg = when (sourceTargetState.preferencesStatus) {
                        PreferenceSourceStatus.ACTIVE -> DamHopperColors.Success.copy(alpha = 0.2f)
                        PreferenceSourceStatus.SOURCE_REMOVED -> DamHopperColors.Warning.copy(alpha = 0.2f)
                        PreferenceSourceStatus.UNSET -> DamHopperColors.SurfaceVariant
                    }
                    val statusColor = when (sourceTargetState.preferencesStatus) {
                        PreferenceSourceStatus.ACTIVE -> DamHopperColors.Success
                        PreferenceSourceStatus.SOURCE_REMOVED -> DamHopperColors.Warning
                        PreferenceSourceStatus.UNSET -> DamHopperColors.TextSecondary
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(statusBg)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = statusText,
                            color = statusColor,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "Preferences source syncs allowlisted fonts, suggestions, explorer filters, and themes across workbench sessions.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Profile Selector Pills
                Text(
                    text = "Sync Source:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextPrimary,
                )
                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    // Local Only Option
                    val isUnset = sourceTargetState.preferencesProfileId == null
                    Box(
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (isUnset) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                            .border(1.dp, if (isUnset) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                            .clickable {
                                coroutineScope.launch {
                                    settingsRepository.switchPreferenceSource(null)
                                }
                            }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "Local Only (No Server Sync)",
                            color = if (isUnset) Color.Black else DamHopperColors.TextPrimary,
                            fontWeight = if (isUnset) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 12.sp,
                        )
                    }

                    availableProfiles.forEach { profile ->
                        val isSelected = sourceTargetState.preferencesProfileId == profile.id
                        Box(
                            modifier = Modifier
                                .defaultMinSize(minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    coroutineScope.launch {
                                        settingsRepository.switchPreferenceSource(profile.id)
                                    }
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column {
                                Text(
                                    text = profile.name,
                                    color = if (isSelected) Color.Black else DamHopperColors.TextPrimary,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 12.sp,
                                )
                                Text(
                                    text = profile.baseUrl,
                                    color = if (isSelected) Color.DarkGray else DamHopperColors.TextSecondary,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace,
                                )
                            }
                        }
                    }
                }

                if (sourceTargetState.lastSnapshot != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Retained safe snapshot: Theme = ${sourceTargetState.lastSnapshot?.theme?.name}, Editor = ${sourceTargetState.lastSnapshot?.editorFontSize}sp, Terminal = ${sourceTargetState.lastSnapshot?.terminalFontSize}sp",
                        style = DamHopperTypography.labelSmall,
                        color = DamHopperColors.TextSecondary,
                    )
                }
            }
        }

        // 2. Workbench Appearance Theme Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Workbench Theme",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Dark Workbench aesthetic is optimized for high-contrast OLED battery efficiency and IDE focus.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    WorkbenchTheme.entries.forEach { theme ->
                        val isSelected = preferences.theme == theme
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    settingsRepository.updatePreferences { it.copy(theme = theme) }
                                }
                                .padding(vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = theme.name,
                                color = if (isSelected) Color.Black else DamHopperColors.TextPrimary,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }
            }
        }

        // 3. Font Sizes 10..32 & Typography Preview
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Typography & Font Sizes (10..32)",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Adjust text scale across System UI, Code Editor, and Shell Terminal with real-time preview.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                )

                Spacer(modifier = Modifier.height(14.dp))

                // System Font Size
                FontSizeControlRow(
                    label = "System UI Font Size",
                    value = preferences.systemFontSize,
                    onValueChange = { newSize ->
                        settingsRepository.updatePreferences { it.copy(systemFontSize = newSize) }
                    },
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Editor Font Size
                FontSizeControlRow(
                    label = "Code Editor Font Size",
                    value = preferences.editorFontSize,
                    onValueChange = { newSize ->
                        settingsRepository.updatePreferences { it.copy(editorFontSize = newSize) }
                    },
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Terminal Font Size
                FontSizeControlRow(
                    label = "Terminal Font Size",
                    value = preferences.terminalFontSize,
                    onValueChange = { newSize ->
                        settingsRepository.updatePreferences { it.copy(terminalFontSize = newSize) }
                    },
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Live Typography Preview Box
                Text(
                    text = "Live Typography Preview:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextPrimary,
                )
                Spacer(modifier = Modifier.height(6.dp))

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(DamHopperColors.Background)
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "System UI • DamHopper Mobile Workbench",
                        fontSize = preferences.systemFontSize.sp,
                        color = DamHopperColors.TextPrimary,
                    )
                    Text(
                        text = "fun calculateSha256(bytes: ByteArray): String = digest(bytes)",
                        fontSize = preferences.editorFontSize.sp,
                        fontFamily = FontFamily.Monospace,
                        color = DamHopperColors.Secondary,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "damhopper@mobile:~$ git status --short",
                            fontSize = preferences.terminalFontSize.sp,
                            fontFamily = FontFamily.Monospace,
                            color = DamHopperColors.TextPrimary,
                        )
                        Box(
                            modifier = Modifier
                                .padding(start = 2.dp)
                                .width(8.dp)
                                .height(preferences.terminalFontSize.dp)
                                .background(DamHopperColors.TerminalCursor),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Editor Zoom Wheel Toggle
                PreferenceSwitchRow(
                    title = "Editor Zoom Wheel Gesture",
                    description = "Allow pinch and trackpad wheel zooming within the native editor",
                    checked = preferences.editorZoomWheelEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(editorZoomWheelEnabled = checked) }
                    },
                )
            }
        }

        // 4. Terminal Suggestions & Navigation Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Terminal Suggestions & Navigation",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(12.dp))

                PreferenceSwitchRow(
                    title = "Terminal Suggestions",
                    description = "Display inline shell completion and command history suggestions",
                    checked = preferences.terminalSuggestionsEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(terminalSuggestionsEnabled = checked) }
                    },
                )

                Spacer(modifier = Modifier.height(10.dp))

                PreferenceSwitchRow(
                    title = "Scroll Navigation Buttons",
                    description = "Render touch-friendly scroll-to-top and scroll-to-bottom buttons",
                    checked = preferences.terminalScrollButtonsEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(terminalScrollButtonsEnabled = checked) }
                    },
                )

                Spacer(modifier = Modifier.height(10.dp))

                PreferenceSwitchRow(
                    title = "Commit Status Header",
                    description = "Show live repository branch and commit status in terminal bar",
                    checked = preferences.terminalCommitStatusEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(terminalCommitStatusEnabled = checked) }
                    },
                )

                Spacer(modifier = Modifier.height(14.dp))

                // Terminal Scroll Step Stepper (1..20)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Terminal Scroll Step",
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.TextPrimary,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = "Lines advanced per scroll touch button press (1..20)",
                            style = DamHopperTypography.labelSmall,
                            color = DamHopperColors.TextSecondary,
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(DamHopperColors.SurfaceVariant)
                                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    val next = (preferences.terminalScrollStep - 1).coerceAtLeast(WorkbenchPreferences.SCROLL_STEP_MIN)
                                    settingsRepository.updatePreferences { it.copy(terminalScrollStep = next) }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("-", color = DamHopperColors.TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }

                        Text(
                            text = "${preferences.terminalScrollStep} lines",
                            style = DamHopperTypography.bodyMedium,
                            color = DamHopperColors.Primary,
                            fontWeight = FontWeight.Bold,
                        )

                        Box(
                            modifier = Modifier
                                .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(DamHopperColors.SurfaceVariant)
                                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    val next = (preferences.terminalScrollStep + 1).coerceAtMost(WorkbenchPreferences.SCROLL_STEP_MAX)
                                    settingsRepository.updatePreferences { it.copy(terminalScrollStep = next) }
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("+", color = DamHopperColors.TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        // 5. Explorer Filters & File Tree Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "File Explorer Filter & Visibility",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "Language Filter:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextPrimary,
                )
                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ExplorerLanguageFilter.entries.forEach { filter ->
                        val isSelected = preferences.explorerLanguageFilter == filter
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    settingsRepository.updatePreferences { it.copy(explorerLanguageFilter = filter) }
                                }
                                .padding(vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = filter.name,
                                color = if (isSelected) Color.Black else DamHopperColors.TextPrimary,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                PreferenceSwitchRow(
                    title = "Show Hidden Files",
                    description = "Display dotfiles (.git, .env) and hidden directory trees in explorer",
                    checked = preferences.explorerShowHidden,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(explorerShowHidden = checked) }
                    },
                )
            }
        }

        // 6. Sound & Haptics Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Feedback & Audio",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(12.dp))

                PreferenceSwitchRow(
                    title = "Sound Effects",
                    description = "Audio chimes on agent completion and terminal notifications",
                    checked = preferences.soundEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(soundEnabled = checked) }
                    },
                )

                Spacer(modifier = Modifier.height(10.dp))

                PreferenceSwitchRow(
                    title = "Haptic Feedback",
                    description = "Vibration feedback on interactive control taps and gestures",
                    checked = preferences.hapticFeedbackEnabled,
                    onCheckedChange = { checked ->
                        settingsRepository.updatePreferences { it.copy(hapticFeedbackEnabled = checked) }
                    },
                )
            }
        }

        // 7. Cognito Privacy Mode & Hardware Guard Card
        Card(
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = DamHopperColors.Surface),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, DamHopperColors.Border, RoundedCornerShape(8.dp)),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Cognito Privacy Mode",
                    style = DamHopperTypography.titleMedium,
                    color = DamHopperColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "Full-viewport ephemeral privacy mask. Consumes all pointer events and freezes input at dispatch boundaries. Activation state is strictly in-memory and never persisted.",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.TextSecondary,
                    lineHeight = 18.sp,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "Mask Presentation Style:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextPrimary,
                )
                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val styles = listOf(
                        CognitoModeStyle.HEAVY_BLUR to "Heavy Blur (16px slate frost)",
                        CognitoModeStyle.BLACK_SCREEN to "Black Screen (Pure OLED #000)",
                    )
                    styles.forEach { (style, label) ->
                        val isSelected = preferences.cognitoModeStyle == style
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 48.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant)
                                .border(1.dp, if (isSelected) DamHopperColors.Primary else DamHopperColors.Border, RoundedCornerShape(6.dp))
                                .clickable {
                                    settingsRepository.updatePreferences { it.copy(cognitoModeStyle = style) }
                                }
                                .padding(horizontal = 8.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = label,
                                color = if (isSelected) Color.Black else DamHopperColors.TextPrimary,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                Text(
                    text = "Dismissal Chord Shortcut:",
                    style = DamHopperTypography.labelSmall,
                    color = DamHopperColors.TextPrimary,
                )
                Spacer(modifier = Modifier.height(4.dp))

                OutlinedTextField(
                    value = preferences.cognitoModeShortcut,
                    onValueChange = { chord ->
                        settingsRepository.updatePreferences { it.copy(cognitoModeShortcut = chord) }
                    },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = DamHopperColors.TextPrimary,
                        unfocusedTextColor = DamHopperColors.TextPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Test Cognito Privacy Mode Button
                Button(
                    onClick = {
                        privacyController.activate(
                            chord = preferences.cognitoModeShortcut,
                            style = preferences.cognitoModeStyle,
                        )
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.PrimaryVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                ) {
                    Text(
                        text = "🔒 Test Cognito Privacy Mask",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun FontSizeControlRow(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = DamHopperTypography.bodyMedium,
                color = DamHopperColors.TextPrimary,
                fontWeight = FontWeight.SemiBold,
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    modifier = Modifier
                        .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                        .clickable {
                            val next = (value - 1).coerceAtLeast(WorkbenchPreferences.FONT_MIN)
                            onValueChange(next)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("-", color = DamHopperColors.TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }

                Text(
                    text = "$value sp",
                    style = DamHopperTypography.bodyMedium,
                    color = DamHopperColors.Primary,
                    fontWeight = FontWeight.Bold,
                )

                Box(
                    modifier = Modifier
                        .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .border(1.dp, DamHopperColors.Border, RoundedCornerShape(6.dp))
                        .clickable {
                            val next = (value + 1).coerceAtMost(WorkbenchPreferences.FONT_MAX)
                            onValueChange(next)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+", color = DamHopperColors.TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Slider(
            value = value.toFloat(),
            onValueChange = { onValueChange(it.toInt()) },
            valueRange = WorkbenchPreferences.FONT_MIN.toFloat()..WorkbenchPreferences.FONT_MAX.toFloat(),
            steps = WorkbenchPreferences.FONT_MAX - WorkbenchPreferences.FONT_MIN - 1,
            colors = SliderDefaults.colors(
                thumbColor = DamHopperColors.Primary,
                activeTrackColor = DamHopperColors.Primary,
                inactiveTrackColor = DamHopperColors.SurfaceVariant,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun PreferenceSwitchRow(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(
                text = title,
                style = DamHopperTypography.bodyMedium,
                color = DamHopperColors.TextPrimary,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = description,
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary,
            )
        }

        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = DamHopperColors.Background,
                checkedTrackColor = DamHopperColors.Primary,
                uncheckedThumbColor = DamHopperColors.TextSecondary,
                uncheckedTrackColor = DamHopperColors.SurfaceVariant,
            ),
        )
    }
}
