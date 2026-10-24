package dev.damhopper.nativeapp.ui.flow

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * State machine managing the linear core mobile navigation flow:
 * [AppFlowStage.PROFILE_LOGIN] -> [AppFlowStage.PROJECT_LIST] -> [AppFlowStage.TERMINAL]
 *
 * Provides atomic back-press unwinding and selection state tracking.
 *
 * Note on state retention: navigation transitions preserve existing selection fields
 * ([AppFlowState.activeProfileId], [AppFlowState.activeProject], [AppFlowState.activeSessionId])
 * unless explicitly modified by navigation methods. Downstream callers needing session resets
 * or logout semantics should explicitly call [selectSession](null) or construct a fresh navigation instance.
 */
class AppFlowNavigation(
    initialState: AppFlowState = AppFlowState(),
) {
    private val _state = MutableStateFlow(initialState)

    /**
     * Observable state flow representing current mobile flow state.
     */
    val state: StateFlow<AppFlowState> = _state.asStateFlow()

    /**
     * Interception hook for departure guards (e.g. dirty documents in workspace).
     * If returning true, navigation is intercepted and deferred until user confirms.
     */
    var departureGuard: ((targetStage: AppFlowStage, onProceed: () -> Unit) -> Boolean)? = null

    /**
     * Navigates back to the profile authentication stage.
     */
    fun navigateToProfiles() {
        val guard = departureGuard
        if (guard != null && guard(AppFlowStage.PROFILE_LOGIN) { directNavigateToProfiles() }) {
            return
        }
        directNavigateToProfiles()
    }

    private fun directNavigateToProfiles() {
        _state.update { it.copy(stage = AppFlowStage.PROFILE_LOGIN, activeSessionId = null) }
    }

    /**
     * Records successful authentication for a profile and advances to the project list stage.
     * If the profile changed, clears any previously selected project and terminal session.
     *
     * @param profileId Authenticated server profile identifier.
     */
    fun onProfileAuthenticated(profileId: String) {
        _state.update { current ->
            val profileChanged = current.activeProfileId != profileId
            current.copy(
                stage = AppFlowStage.PROJECT_LIST,
                activeProfileId = profileId,
                activeProject = if (profileChanged) null else current.activeProject,
                activeSessionId = if (profileChanged) null else current.activeSessionId,
            )
        }
    }

    /**
     * Selects an active project and advances to the terminal display stage.
     * If the project changed, clears any previously active terminal session.
     *
     * @param projectName Selected project name or workspace path.
     */
    fun selectProject(projectName: String) {
        val guard = departureGuard
        if (guard != null && guard(AppFlowStage.TERMINAL) { directSelectProject(projectName) }) {
            return
        }
        directSelectProject(projectName)
    }

    private fun directSelectProject(projectName: String) {
        _state.update { current ->
            val projectChanged = current.activeProject != projectName
            current.copy(
                stage = AppFlowStage.TERMINAL,
                activeProject = projectName,
                activeSessionId = if (projectChanged) null else current.activeSessionId,
            )
        }
    }

    /**
     * Updates the active terminal session ID for the current project.
     *
     * @param sessionId Active terminal session ID, or null to clear.
     */
    fun selectSession(sessionId: String?) {
        _state.update {
            it.copy(activeSessionId = sessionId)
        }
    }

    /**
     * Atomically handles the platform back button:
     * - In [AppFlowStage.TERMINAL]: unwinds back to [AppFlowStage.PROJECT_LIST] and returns true.
     * - In [AppFlowStage.PROJECT_LIST]: unwinds back to [AppFlowStage.PROFILE_LOGIN] and returns true.
     * - In [AppFlowStage.PROFILE_LOGIN]: returns false (yields back handling to the system/host activity).
     *
     * @return True if back event was consumed by the flow navigation; false if unhandled.
     */
    fun handleBackPress(): Boolean {
        val current = _state.value
        val targetStage = when (current.stage) {
            AppFlowStage.TERMINAL -> AppFlowStage.PROJECT_LIST
            AppFlowStage.PROJECT_LIST -> AppFlowStage.PROFILE_LOGIN
            AppFlowStage.PROFILE_LOGIN -> null
        }
        if (targetStage == null) return false

        val guard = departureGuard
        if (guard != null && guard(targetStage) { directProceedBack(targetStage) }) {
            return true
        }
        return directProceedBack(targetStage)
    }

    private fun directProceedBack(targetStage: AppFlowStage): Boolean {
        _state.update { current ->
            current.copy(stage = targetStage)
        }
        return true
    }
}
