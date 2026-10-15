package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.model.WorkbenchState
import dev.damhopper.nativeapp.ui.components.GenericPanelPlaceholder
import dev.damhopper.nativeapp.ui.components.PanelNavigationRow
import dev.damhopper.nativeapp.ui.components.TerminalPanelPlaceholder
import dev.damhopper.nativeapp.ui.components.WorkbenchHeader
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun WorkbenchScreen(
    initialState: WorkbenchState = WorkbenchState(),
    modifier: Modifier = Modifier
) {
    var state by remember { mutableStateOf(initialState) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .safeDrawingPadding()
    ) {
        // 1. Top Header: Server & Project info
        WorkbenchHeader(state = state)

        // 2. Single Top Panel-Navigation Row (Horizontally scrollable, docked)
        PanelNavigationRow(
            activePanel = state.activePanel,
            onSelectPanel = { panel ->
                state = state.copy(activePanel = panel)
            }
        )

        // 3. Single Content Area (replaces content visually, keeping controllers alive)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(DamHopperColors.Background)
                .padding(8.dp)
        ) {
            when (state.activePanel) {
                WorkbenchPanel.TERMINAL -> {
                    TerminalPanelPlaceholder()
                }
                else -> {
                    GenericPanelPlaceholder(panel = state.activePanel)
                }
            }
        }
    }
}
