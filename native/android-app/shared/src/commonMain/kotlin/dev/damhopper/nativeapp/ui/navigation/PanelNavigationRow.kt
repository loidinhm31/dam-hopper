@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package dev.damhopper.nativeapp.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Exactly one horizontally scrollable panel-navigation row placed below the server/project header.
 *
 * Invariants:
 * - Single-line horizontal scroll; never wraps.
 * - Icon glyph + short code + text for every included panel.
 * - Automatically reveals the active button into viewport on selection.
 * - Stays visible when software keyboard (IME) is displayed.
 * - Zero floating action buttons (FABs), draggable launchers, or More menus.
 */
@Composable
fun PanelNavigationRow(
    activePanel: WorkbenchPanel,
    onSelectPanel: (WorkbenchPanel) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scrollState = rememberScrollState()

    // Reveal active button when selection changes via BringIntoViewRequester
    LaunchedEffect(activePanel) {
        // Parent scroll synchronization
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(DamHopperColors.NavRowBackground)
            .border(width = 0.5.dp, color = DamHopperColors.Border)
            .horizontalScroll(scrollState)
            .padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        PanelRegistry.allPanels.forEach { descriptor ->
            val isActive = descriptor.panel == activePanel
            val bringIntoViewRequester = remember { BringIntoViewRequester() }
            LaunchedEffect(isActive) {
                if (isActive) {
                    bringIntoViewRequester.bringIntoView()
                }
            }
            val backgroundColor = if (isActive) DamHopperColors.NavButtonActive else DamHopperColors.NavButtonInactive
            val textColor = if (isActive) DamHopperColors.TextPrimary else DamHopperColors.TextSecondary

            Box(
                modifier = Modifier
                    .bringIntoViewRequester(bringIntoViewRequester)
                    .clip(RoundedCornerShape(4.dp))
                    .background(backgroundColor)
                    .clickable { onSelectPanel(descriptor.panel) }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = descriptor.iconGlyph,
                        color = textColor,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "[${descriptor.shortCode}]",
                        color = textColor,
                        fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                    Text(
                        text = descriptor.label,
                        color = textColor,
                        fontSize = 12.sp,
                        fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal
                    )
                }
            }
        }
    }
}
