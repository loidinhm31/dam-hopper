package dev.damhopper.nativeapp.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.model.WorkbenchPanel
import dev.damhopper.nativeapp.ui.components.GenericPanelPlaceholder
import dev.damhopper.nativeapp.ui.components.TerminalPanelPlaceholder
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/**
 * Single content area host container for all form factors (phones, tablets, foldables).
 *
 * Invariants:
 * - Exactly one active content area rendered at any time.
 * - No wide-screen side-by-side terminal/panel docking; selected panel visually replaces the terminal.
 * - State controllers (e.g. TerminalSessionController, EditorSession, ProjectTargetStore) live outside
 *   composition and are retained across panel switches.
 * - Only the currently visible panel receives touch, click, or keyboard input.
 */
@Composable
fun PanelHost(
    activePanel: WorkbenchPanel,
    modifier: Modifier = Modifier,
    terminalContent: @Composable () -> Unit = { TerminalPanelPlaceholder() },
    filesContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.FILES) },
    editorContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.EDITOR) },
    diffContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.DIFF) },
    mergeContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.MERGE) },
    gitContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.GIT) },
    workflowContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.WORKFLOW) },
    agentsContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.AGENTS) },
    resourcesContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.RESOURCES) },
    portsContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.PORTS) },
    sshHostContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.SSH_HOST) },
    settingsContent: @Composable () -> Unit = { GenericPanelPlaceholder(WorkbenchPanel.SETTINGS) },
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(4.dp)
    ) {
        when (activePanel) {
            WorkbenchPanel.TERMINAL -> terminalContent()
            WorkbenchPanel.FILES -> filesContent()
            WorkbenchPanel.EDITOR -> editorContent()
            WorkbenchPanel.DIFF -> diffContent()
            WorkbenchPanel.MERGE -> mergeContent()
            WorkbenchPanel.GIT -> gitContent()
            WorkbenchPanel.WORKFLOW -> workflowContent()
            WorkbenchPanel.AGENTS -> agentsContent()
            WorkbenchPanel.RESOURCES -> resourcesContent()
            WorkbenchPanel.PORTS -> portsContent()
            WorkbenchPanel.SSH_HOST -> sshHostContent()
            WorkbenchPanel.SETTINGS -> settingsContent()
        }
    }
}
