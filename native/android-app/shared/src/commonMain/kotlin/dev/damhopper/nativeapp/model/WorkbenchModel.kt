package dev.damhopper.nativeapp.model

import kotlinx.serialization.Serializable

enum class WorkbenchMode {
    TERMINAL
}

enum class TerminalUsageMode {
    TRADITIONAL
}

/**
 * Authoritative 12-panel workbench registry defined in docs/android-native-acceptance.md §2.
 */
enum class WorkbenchPanel(val label: String, val shortCode: String) {
    TERMINAL("Terminal", "TERM"),
    FILES("Files", "FS"),
    EDITOR("Editor", "EDIT"),
    DIFF("Diff", "DIFF"),
    MERGE("Merge", "MRG"),
    GIT("Git", "GIT"),
    WORKFLOW("Workflow", "FLOW"),
    AGENTS("Agents", "AGNT"),
    RESOURCES("Resources", "RES"),
    PORTS("Ports", "PORT"),
    SSH_HOST("Host Controls", "HOST"),
    SETTINGS("Settings", "SET")
}

@Serializable
data class WorkbenchState(
    val activePanel: WorkbenchPanel = WorkbenchPanel.TERMINAL,
    val serverName: String = "Local Server",
    val activeProject: String = "Default Workspace",
    val isConnected: Boolean = false,
    val connectionStatus: String = "Offline (Phase 02 Foundation)"
) {
    // Shell Invariants
    val workspaceMode: WorkbenchMode = WorkbenchMode.TERMINAL
    val terminalUsageMode: TerminalUsageMode = TerminalUsageMode.TRADITIONAL
    val allowFloatingButtons: Boolean = false
    val singleContentArea: Boolean = true
}
