package dev.damhopper.nativeapp.ui.navigation

import dev.damhopper.nativeapp.model.WorkbenchPanel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * State machine managing navigation and dialog states for the TERMINAL/Traditional workbench.
 *
 * Invariants:
 * - Back-stack precedence: Dismisses open overlays/dialogs first; non-terminal panels return
 *   to TERMINAL; already at TERMINAL yields to platform back.
 * - Single selected content area; no split-screen or multi-panel docking.
 * - Destructive workspace switch requires explicit two-phase confirmation (request -> confirm).
 */
class WorkbenchNavigation(
    initialPanel: WorkbenchPanel = WorkbenchPanel.TERMINAL,
    initialProject: String = "Default Workspace",
) {
    data class State(
        val activePanel: WorkbenchPanel = WorkbenchPanel.TERMINAL,
        val activeProject: String = "Default Workspace",
        val showTargetPicker: Boolean = false,
        val showWorkspaceSwitcher: Boolean = false,
        val pendingWorkspaceSwitchPath: String? = null,
        val showProfileList: Boolean = false,
        val authProfileId: String? = null,
    ) {
        val hasActiveOverlay: Boolean
            get() = showTargetPicker ||
                showWorkspaceSwitcher ||
                pendingWorkspaceSwitchPath != null ||
                showProfileList ||
                authProfileId != null
    }

    private val _state = MutableStateFlow(
        State(
            activePanel = initialPanel,
            activeProject = initialProject
        )
    )
    var panelBackHandler: (() -> Boolean)? = null
    val state: StateFlow<State> = _state.asStateFlow()

    fun navigateTo(panel: WorkbenchPanel) {
        _state.update { it.copy(activePanel = panel) }
    }

    fun selectProject(project: String) {
        require(project.isNotBlank()) { "project name cannot be blank" }
        _state.update { it.copy(activeProject = project, showTargetPicker = false) }
    }

    fun openTargetPicker() {
        _state.update { it.copy(showTargetPicker = true) }
    }

    fun closeTargetPicker() {
        _state.update { it.copy(showTargetPicker = false) }
    }

    fun openWorkspaceSwitcher() {
        _state.update { it.copy(showWorkspaceSwitcher = true) }
    }

    fun closeWorkspaceSwitcher() {
        _state.update { it.copy(showWorkspaceSwitcher = false) }
    }

    fun requestWorkspaceSwitch(path: String) {
        require(path.isNotBlank()) { "workspace path cannot be blank" }
        _state.update { it.copy(pendingWorkspaceSwitchPath = path) }
    }

    fun clearWorkspaceSwitchRequest() {
        _state.update { it.copy(pendingWorkspaceSwitchPath = null) }
    }

    fun openProfileList() {
        _state.update { it.copy(showProfileList = true) }
    }

    fun closeProfileList() {
        _state.update { it.copy(showProfileList = false) }
    }

    fun openAuth(profileId: String) {
        _state.update { it.copy(authProfileId = profileId) }
    }

    fun closeAuth() {
        _state.update { it.copy(authProfileId = null) }
    }

    /**
     * Handles system back button invocation with strict precedence:
     * 1. If auth dialog is open -> close auth dialog.
     * 2. If destructive switch confirmation is open -> cancel confirmation.
     * 3. If target picker is open -> close target picker.
     * 4. If workspace switcher is open -> close workspace switcher.
     * 5. If profile list is open -> close profile list.
     * 6. If activePanel is not TERMINAL -> return to TERMINAL panel.
     * 7. Else -> return false (unhandled, delegate to platform back/exit).
     */
    fun handleBackPress(): Boolean {
        val current = _state.value
        when {
            current.authProfileId != null -> {
                closeAuth()
                return true
            }
            current.pendingWorkspaceSwitchPath != null -> {
                clearWorkspaceSwitchRequest()
                return true
            }
            current.showTargetPicker -> {
                closeTargetPicker()
                return true
            }
            current.showWorkspaceSwitcher -> {
                closeWorkspaceSwitcher()
                return true
            }
            current.showProfileList -> {
                closeProfileList()
                return true
            }
            panelBackHandler?.invoke() == true -> {
                return true
            }
            current.activePanel != WorkbenchPanel.TERMINAL -> {
                navigateTo(WorkbenchPanel.TERMINAL)
                return true
            }
            else -> return false
        }
    }
}
