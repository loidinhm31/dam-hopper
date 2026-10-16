package dev.damhopper.nativeapp.ui.navigation

import dev.damhopper.nativeapp.model.WorkbenchPanel

/**
 * Metadata descriptor for an authoritative workbench panel.
 */
data class PanelDescriptor(
    val panel: WorkbenchPanel,
    val label: String,
    val shortCode: String,
    val iconGlyph: String,
    val description: String,
)

/**
 * Complete, authoritative 12-panel registry defined in docs/android-native-acceptance.md §2.
 * Invariant: Fails closed on any unknown panel identifier. No second navigation surface or drawer.
 */
object PanelRegistry {

    private val descriptors: Map<WorkbenchPanel, PanelDescriptor> = mapOf(
        WorkbenchPanel.TERMINAL to PanelDescriptor(
            panel = WorkbenchPanel.TERMINAL,
            label = "Terminal",
            shortCode = "TERM",
            iconGlyph = ">_",
            description = "Interactive shell sessions and stream replay"
        ),
        WorkbenchPanel.FILES to PanelDescriptor(
            panel = WorkbenchPanel.FILES,
            label = "Files",
            shortCode = "FS",
            iconGlyph = "[F]",
            description = "Sandboxed filesystem explorer and file operations"
        ),
        WorkbenchPanel.EDITOR to PanelDescriptor(
            panel = WorkbenchPanel.EDITOR,
            label = "Editor",
            shortCode = "EDIT",
            iconGlyph = "[E]",
            description = "Native code editor with syntax and language services"
        ),
        WorkbenchPanel.DIFF to PanelDescriptor(
            panel = WorkbenchPanel.DIFF,
            label = "Diff",
            shortCode = "DIFF",
            iconGlyph = "[D]",
            description = "Side-by-side and unified file diffs"
        ),
        WorkbenchPanel.MERGE to PanelDescriptor(
            panel = WorkbenchPanel.MERGE,
            label = "Merge",
            shortCode = "MRG",
            iconGlyph = "[M]",
            description = "3-way conflict resolution tool"
        ),
        WorkbenchPanel.GIT to PanelDescriptor(
            panel = WorkbenchPanel.GIT,
            label = "Git",
            shortCode = "GIT",
            iconGlyph = "[G]",
            description = "Commit log, staged changes, and branch management"
        ),
        WorkbenchPanel.WORKFLOW to PanelDescriptor(
            panel = WorkbenchPanel.WORKFLOW,
            label = "Workflow",
            shortCode = "FLOW",
            iconGlyph = "[W]",
            description = "Task execution, logs, and workflow plans"
        ),
        WorkbenchPanel.AGENTS to PanelDescriptor(
            panel = WorkbenchPanel.AGENTS,
            label = "Agents",
            shortCode = "AGNT",
            iconGlyph = "[A]",
            description = "Multi-agent status and loopback monitors"
        ),
        WorkbenchPanel.RESOURCES to PanelDescriptor(
            panel = WorkbenchPanel.RESOURCES,
            label = "Resources",
            shortCode = "RES",
            iconGlyph = "[R]",
            description = "Host CPU, memory, and disk telemetry"
        ),
        WorkbenchPanel.PORTS to PanelDescriptor(
            panel = WorkbenchPanel.PORTS,
            label = "Ports",
            shortCode = "PORT",
            iconGlyph = "[P]",
            description = "Listening port discovery and Cloudflare tunnels"
        ),
        WorkbenchPanel.SSH_HOST to PanelDescriptor(
            panel = WorkbenchPanel.SSH_HOST,
            label = "Host Controls",
            shortCode = "HOST",
            iconGlyph = "[H]",
            description = "Remote host systemd and daemon lifecycle controls"
        ),
        WorkbenchPanel.SETTINGS to PanelDescriptor(
            panel = WorkbenchPanel.SETTINGS,
            label = "Settings",
            shortCode = "SET",
            iconGlyph = "[S]",
            description = "Server profiles, auth sessions, and remote config"
        ),
    )

    val allPanels: List<PanelDescriptor> = WorkbenchPanel.entries.map {
        descriptors[it] ?: throw IllegalStateException("Missing descriptor for panel: $it")
    }

    fun get(panel: WorkbenchPanel): PanelDescriptor =
        descriptors[panel] ?: throw IllegalArgumentException("Unknown workbench panel: $panel")

    fun isAuthoritative(panel: WorkbenchPanel): Boolean = descriptors.containsKey(panel)
}
