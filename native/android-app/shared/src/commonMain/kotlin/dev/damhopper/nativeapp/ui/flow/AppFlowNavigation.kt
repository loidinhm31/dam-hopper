package dev.damhopper.nativeapp.ui.flow

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * State machine managing the linear core mobile navigation flow:
 * [AppFlowStage.PROFILE_LOGIN] -> [AppFlowStage.PROJECT_LIST] -> [AppFlowStage.TERMINAL]
 *
 * Provides atomic back-press unwinding and selection state tracking. Settings is a retained **overlay** with a
 * captured [SettingsOrigin] (see [openSettings]/[closeSettings]), not a second navigation system: it never changes
 * the stage, the selected project or the active session, and Back closes it before any stage unwinding.
 *
 * Note on state retention: navigation transitions preserve existing selection fields
 * ([AppFlowState.activeProfileId], [AppFlowState.activeProject], [AppFlowState.activeSessionId])
 * unless explicitly modified by navigation methods. Any transition that changes the stage drops the Settings
 * overlay and the inline feed, because their captured origin would no longer exist.
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
     * Owned UI back interceptors (e.g. slide-over sidebars). Main-thread only.
     * Consulted newest-first by [handleBackPress] before stage unwinding.
     */
    private val backInterceptors = mutableListOf<() -> Boolean>()

    /**
     * Registers a back interceptor. It is invoked before stage navigation and returns true when it
     * consumed the back event. The returned lambda unregisters it; callers MUST invoke it on dispose.
     */
    fun registerBackInterceptor(interceptor: () -> Boolean): () -> Unit {
        backInterceptors.add(interceptor)
        return { backInterceptors.remove(interceptor) }
    }

    // ---- Settings overlay and inline feed ----

    /**
     * Opens Settings above the current stage, capturing [origin]. A second open keeps the first origin (the
     * overlay never nests and never re-captures a place the user is no longer looking at).
     */
    fun openSettings(origin: SettingsOrigin) {
        _state.update { current ->
            if (current.settings != null) current
            else current.copy(settings = SettingsOverlay(origin.copy(stage = current.stage)), notificationsOpen = false)
        }
    }

    /** Remembers the shown Settings sub-section so a configuration change restores it. */
    fun setSettingsSubSection(name: String) {
        _state.update { current ->
            val overlay = current.settings ?: return@update current
            if (overlay.subSection == name) current else current.copy(settings = overlay.copy(subSection = name))
        }
    }

    /** Closes Settings and returns the origin the user must land on, or null when it was not open. */
    fun closeSettings(): SettingsOrigin? {
        var origin: SettingsOrigin? = null
        _state.update { current ->
            origin = current.settings?.origin
            if (current.settings == null) current else current.copy(settings = null)
        }
        return origin
    }

    fun toggleNotifications() {
        _state.update { it.copy(notificationsOpen = !it.notificationsOpen) }
    }

    fun openNotifications() {
        _state.update { if (it.notificationsOpen) it else it.copy(notificationsOpen = true) }
    }

    fun closeNotifications() {
        _state.update { if (it.notificationsOpen) it.copy(notificationsOpen = false) else it }
    }

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
        _state.update {
            it.copy(stage = AppFlowStage.PROFILE_LOGIN, activeSessionId = null, settings = null, notificationsOpen = false)
        }
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
                activeWorktreePath = if (profileChanged) null else current.activeWorktreePath,
                settings = null,
                notificationsOpen = false,
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
                activeWorktreePath = if (projectChanged) null else current.activeWorktreePath,
                settings = null,
                notificationsOpen = false,
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
     * Commits a confirmed, still-current server reset: the selected project and session no longer exist, so the
     * flow returns to workspace (project) selection. The caller invokes it only for a confirmed reset of the
     * still-current target; uncertain or cancelled resets never reach it.
     */
    fun completeResetToWorkspaceSelection() {
        _state.update { current ->
            current.copy(
                stage = if (current.activeProfileId != null) AppFlowStage.PROJECT_LIST else AppFlowStage.PROFILE_LOGIN,
                activeProject = null,
                activeSessionId = null,
                activeWorktreePath = null,
                settings = null,
                notificationsOpen = false,
            )
        }
    }

    /**
     * Routes to an authoritative terminal (notification click). [revalidate] runs immediately before the state
     * commit - after any departure guard confirmation - so a click validated earlier cannot navigate once the
     * owner, socket or terminal changed. Returns true when the route was committed or deferred behind a departure
     * guard; false when it was refused outright.
     */
    fun routeToTerminal(
        profileId: String,
        project: String,
        worktreePath: String?,
        sessionId: String?,
        revalidate: () -> Boolean = { true },
        onCommitted: () -> Unit = {},
    ): Boolean {
        val commit = {
            if (revalidate()) {
                _state.update {
                    it.copy(
                        stage = AppFlowStage.TERMINAL,
                        activeProfileId = profileId,
                        activeProject = project,
                        activeWorktreePath = worktreePath,
                        activeSessionId = sessionId,
                        settings = null,
                        notificationsOpen = false,
                        notificationRouteActive = true,
                    )
                }
                onCommitted()
            }
        }
        if (!revalidate()) return false
        val current = _state.value
        val sameWorkspace = current.stage == AppFlowStage.TERMINAL && current.activeProfileId == profileId &&
            current.activeProject == project && current.activeWorktreePath == worktreePath
        val guard = departureGuard
        if (!sameWorkspace && guard != null && guard(AppFlowStage.TERMINAL, commit)) return true
        commit()
        return true
    }

    fun consumeNotificationRoute() {
        _state.update { it.copy(notificationRouteActive = false) }
    }

    /**
     * Atomically handles the platform back button:
     * - With Settings open: closes it (returns to its captured origin) and returns true.
     * - With the inline feed open: closes it and returns true.
     * - In [AppFlowStage.TERMINAL]: unwinds back to [AppFlowStage.PROJECT_LIST] and returns true.
     * - In [AppFlowStage.PROJECT_LIST]: unwinds back to [AppFlowStage.PROFILE_LOGIN] and returns true.
     * - In [AppFlowStage.PROFILE_LOGIN]: returns false (yields back handling to the system/host activity).
     *
     * @return True if back event was consumed by the flow navigation; false if unhandled.
     */
    fun handleBackPress(): Boolean {
        val snapshot = _state.value
        if (snapshot.settings != null) {
            closeSettings()
            return true
        }
        if (snapshot.notificationsOpen) {
            closeNotifications()
            return true
        }
        // Snapshot so an interceptor may unregister itself while handling the event.
        for (interceptor in backInterceptors.asReversed().toList()) {
            if (interceptor()) return true
        }
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
            current.copy(stage = targetStage, settings = null, notificationsOpen = false)
        }
        return true
    }
}
