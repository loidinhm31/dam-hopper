package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.features.settings.WorkbenchPreferences
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.JetBrainsMonoFontFamily

/** Minimum touch target of every accessory key, independent of the visual padding preference. */
const val ACCESSORY_TOUCH_TARGET_DP = 48

/** What an accessory key does; every action travels through the terminal's existing input path. */
sealed interface AccessoryAction {
    /** A named special key (`ESC`, `TAB`, `UP`, `HOME`, ...), encoded by the session controller. */
    data class Special(val name: String) : AccessoryAction

    /** One-shot Ctrl+character (Ctrl+C / Ctrl+D). */
    data class CtrlChar(val char: Char) : AccessoryAction

    data object ToggleCtrl : AccessoryAction
    data object ToggleAlt : AccessoryAction
    data object ShowKeyboard : AccessoryAction
    data object ClearLocalDisplay : AccessoryAction
}

data class AccessoryKey(val label: String, val description: String, val action: AccessoryAction)

/** Modifier row (latched Ctrl/Alt, Ctrl+C/D, IME toggle, local clear) above the navigation row. */
fun accessoryModifierRow(): List<AccessoryKey> = listOf(
    AccessoryKey("⌨", "Show keyboard", AccessoryAction.ShowKeyboard),
    AccessoryKey("Ctrl", "Control modifier", AccessoryAction.ToggleCtrl),
    AccessoryKey("Alt", "Alt modifier", AccessoryAction.ToggleAlt),
    AccessoryKey("Ctrl+C", "Control C", AccessoryAction.CtrlChar('c')),
    AccessoryKey("Ctrl+D", "Control D", AccessoryAction.CtrlChar('d')),
    AccessoryKey("Clear", "Clear local display", AccessoryAction.ClearLocalDisplay),
)

fun accessoryNavigationRow(): List<AccessoryKey> = listOf(
    AccessoryKey("Esc", "Escape", AccessoryAction.Special("ESC")),
    AccessoryKey("Tab", "Tab", AccessoryAction.Special("TAB")),
    AccessoryKey("▲", "Up arrow", AccessoryAction.Special("UP")),
    AccessoryKey("▼", "Down arrow", AccessoryAction.Special("DOWN")),
    AccessoryKey("◀", "Left arrow", AccessoryAction.Special("LEFT")),
    AccessoryKey("▶", "Right arrow", AccessoryAction.Special("RIGHT")),
    AccessoryKey("Home", "Home", AccessoryAction.Special("HOME")),
    AccessoryKey("End", "End", AccessoryAction.Special("END")),
    AccessoryKey("Enter", "Enter", AccessoryAction.Special("ENTER")),
)

/** Clamped visual metrics from the synchronized accessory preferences (9..18 sp, 2..14 dp, 2..12 dp). */
data class AccessoryMetrics(val fontSp: Int, val paddingDp: Int, val gapDp: Int)

fun accessoryMetrics(prefs: WorkbenchPreferences): AccessoryMetrics = AccessoryMetrics(
    fontSp = prefs.mobileCustomKeyboardFontSize.coerceIn(9, 18),
    paddingDp = prefs.mobileCustomKeyboardPadding.coerceIn(2, 14),
    gapDp = prefs.mobileCustomKeyboardRowGap.coerceIn(2, 12),
)

/**
 * The native accessory row (not an Android-Chrome keyboard policy): shown only when the `mobileCustomKeyboardEnabled`
 * preference is on and nothing covers the terminal. [inert] (Settings/history/privacy covering it) hides it
 * entirely so it cannot send input. Every key keeps a 48 dp touch target regardless of [metrics] padding; haptics
 * play only with the local haptics consent ([haptics]).
 */
@Composable
fun NativeAccessoryKeyboard(
    enabled: Boolean,
    inert: Boolean,
    metrics: AccessoryMetrics,
    haptics: Boolean,
    ctrlLatched: Boolean,
    altLatched: Boolean,
    onAction: (AccessoryAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!enabled || inert) return
    val haptic = LocalHapticFeedback.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.Surface)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(metrics.gapDp.dp),
    ) {
        listOf(accessoryModifierRow(), accessoryNavigationRow()).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(metrics.gapDp.dp),
            ) {
                row.forEach { key ->
                    val active = (key.action == AccessoryAction.ToggleCtrl && ctrlLatched) ||
                        (key.action == AccessoryAction.ToggleAlt && altLatched)
                    AccessoryKeyButton(key, active, metrics) {
                        if (haptics) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        onAction(key.action)
                    }
                }
            }
        }
    }
}

@Composable
private fun AccessoryKeyButton(key: AccessoryKey, active: Boolean, metrics: AccessoryMetrics, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .sizeIn(minWidth = ACCESSORY_TOUCH_TARGET_DP.dp, minHeight = ACCESSORY_TOUCH_TARGET_DP.dp)
            .semantics {
                role = Role.Button
                contentDescription = key.description
                selected = active
            }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(if (active) DamHopperColors.PrimaryVariant else DamHopperColors.SurfaceVariant)
                .padding(metrics.paddingDp.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = key.label,
                color = if (active) DamHopperColors.Primary else DamHopperColors.TextPrimary,
                fontSize = metrics.fontSp.sp,
                fontFamily = JetBrainsMonoFontFamily,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}
