package dev.damhopper.nativeapp.ui.flow

import dev.damhopper.nativeapp.features.terminal.TerminalAgentsInstanceKey
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
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
     * Restores a previously saved navigation state across process recreation.
     */
    fun restoreState(
        stage: AppFlowStage,
        profileId: String?,
        project: String?,
        sessionId: String?,
        worktreePath: String? = null
    ) {
        _state.update {
            it.copy(
                stage = stage,
                activeProfileId = profileId,
                activeProject = project,
                activeSessionId = sessionId,
                activeWorktreePath = worktreePath,
            )
        }
    }
    /**
     * Interception hook for departure guards (e.g. dirty documents in workspace).
     * If returning true, navigation is intercepted and the guard owns exactly one later call of the request's
     * `onProceed` (user confirmed) or `onCancelled` (prompt cancelled/rejected/superseded/retired).
     */
    var departureGuard: ((DepartureRequest) -> Boolean)? = null

    /**
     * Called when ordinary navigation (profiles, project, back, notification route, reset) is REQUESTED, before any
     * departure guard runs, so a pending retained Agents activation is spent immediately and every captured
     * continuation of it becomes permanently inert. The verified manual route never calls it.
     */
    var onOrdinaryNavigationRequested: (() -> Unit)? = null

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

    private fun ordinaryNavigationRequested() {
        onOrdinaryNavigationRequested?.invoke()
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

    /**
     * Opens the existing Host administration -> Agents Settings section for the captured target workspace server
     * [targetProfileId] (B, independent of preference source A). Already open keeps the first origin but replaces the
     * intent deterministically (advancing [SettingsOverlay.intent]).
     */
    fun openAgentSettings(origin: SettingsOrigin, targetProfileId: String?) {
        _state.update { current ->
            val existing = current.settings
            val next = if (existing == null) {
                SettingsOverlay(
                    origin = origin.copy(stage = current.stage),
                    subSection = AGENT_SETTINGS_SUB_SECTION,
                    hostSection = AGENT_SETTINGS_HOST_SECTION,
                    targetProfileId = targetProfileId,
                    intent = 1L,
                )
            } else {
                existing.copy(
                    subSection = AGENT_SETTINGS_SUB_SECTION,
                    hostSection = AGENT_SETTINGS_HOST_SECTION,
                    targetProfileId = targetProfileId,
                    intent = existing.intent + 1L,
                )
            }
            current.copy(settings = next, notificationsOpen = false)
        }
    }

    /** Remembers the shown Settings sub-section so a configuration change restores it. */
    fun setSettingsSubSection(name: String) {
        _state.update { current ->
            val overlay = current.settings ?: return@update current
            if (overlay.subSection == name) current else current.copy(settings = overlay.copy(subSection = name))
        }
    }

    /** Remembers the shown Host administration section so a configuration change restores it. */
    fun setSettingsHostSection(name: String) {
        _state.update { current ->
            val overlay = current.settings ?: return@update current
            if (overlay.hostSection == name) current else current.copy(settings = overlay.copy(hostSection = name))
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
        ordinaryNavigationRequested()
        val guard = departureGuard
        if (guard != null && guard(DepartureRequest(AppFlowStage.PROFILE_LOGIN, { directNavigateToProfiles() }, {}))) {
            return
        }
        directNavigateToProfiles()
    }

    private fun directNavigateToProfiles() {
        _state.update {
            it.copy(
                stage = AppFlowStage.PROFILE_LOGIN,
                activeSessionId = null,
                settings = null,
                notificationsOpen = false,
                requiredTerminalInstance = null,
            )
        }
    }

    /**
     * Records successful authentication for a profile and advances to the project list stage.
     * If the profile changed, clears any previously selected project and terminal session.
     *
     * @param profileId Authenticated server profile identifier.
     */
    fun onProfileAuthenticated(profileId: String) {
        ordinaryNavigationRequested()
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
                requiredTerminalInstance = null,
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
        ordinaryNavigationRequested()
        val guard = departureGuard
        if (guard != null && guard(DepartureRequest(AppFlowStage.TERMINAL, { directSelectProject(projectName) }, {}))) {
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
                requiredTerminalInstance = null,
            )
        }
    }

    /**
     * Updates the active terminal session ID for the current project. An exact required instance survives a
     * same-terminal report (attachment callbacks) and is cleared by a deliberately different session.
     *
     * @param sessionId Active terminal session ID, or null to clear.
     */
    fun selectSession(sessionId: String?) {
        _state.update {
            it.copy(
                activeSessionId = sessionId,
                requiredTerminalInstance = it.requiredTerminalInstance?.takeIf { required -> required.terminalId == sessionId },
            )
        }
    }

    /**
     * Commits a confirmed, still-current server reset: the selected project and session no longer exist, so the
     * flow returns to workspace (project) selection. The caller invokes it only for a confirmed reset of the
     * still-current target; uncertain or cancelled resets never reach it.
     */
    fun completeResetToWorkspaceSelection() {
        ordinaryNavigationRequested()
        _state.update { current ->
            current.copy(
                stage = if (current.activeProfileId != null) AppFlowStage.PROJECT_LIST else AppFlowStage.PROFILE_LOGIN,
                activeProject = null,
                activeSessionId = null,
                activeWorktreePath = null,
                settings = null,
                notificationsOpen = false,
                requiredTerminalInstance = null,
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
                commitRouteState(
                    profileId = profileId,
                    project = project,
                    worktreePath = worktreePath,
                    sessionId = sessionId,
                    required = null,
                    notificationRouteActive = true,
                )
                onCommitted()
            }
        }
        if (!revalidate()) return false
        ordinaryNavigationRequested()
        val guard = departureGuard
        if (!isSameWorkspace(profileId, project, worktreePath) &&
            guard != null && guard(DepartureRequest(AppFlowStage.TERMINAL, commit, {}))
        ) {
            return true
        }
        commit()
        return true
    }

    /**
     * First step of a verified manual route (retained Agents activation): the exact same workspace proceeds; any
     * other workspace asks the existing departure guard. Never mutates route, profile or session. Returns
     * [TerminalRouteGate.DEFERRED] only when the guard intercepted, in which case exactly one of [onProceed] (after
     * the user confirms) or [onCancelled] is invoked later and the caller must launch its own fresh validation then.
     */
    fun requestVerifiedTerminalRoute(
        route: VerifiedTerminalRoute,
        onProceed: () -> Unit,
        onCancelled: () -> Unit,
    ): TerminalRouteGate {
        if (isSameWorkspace(route.profileId, route.project, route.worktreePath)) return TerminalRouteGate.PROCEED
        val guard = departureGuard ?: return TerminalRouteGate.PROCEED
        return if (guard(DepartureRequest(AppFlowStage.TERMINAL, onProceed, onCancelled))) {
            TerminalRouteGate.DEFERRED
        } else {
            TerminalRouteGate.PROCEED
        }
    }

    /**
     * Admitted, non-suspending, mutation-only entry into the SAME private route-state commit the notification route
     * uses. The caller must hold every authority gate of the local admission protocol; this method does not
     * revalidate, invoke user callbacks, cancel its own request, log, launch jobs, persist or attach controllers, and
     * it does not call the ordinary-navigation invalidator. It records the exact required terminal instance.
     */
    fun commitVerifiedTerminalRoute(route: VerifiedTerminalRoute) {
        commitRouteState(
            profileId = route.profileId,
            project = route.project,
            worktreePath = route.worktreePath,
            sessionId = route.sessionId,
            required = TerminalAgentsInstanceKey(route.profileId, route.sessionId, route.incarnation),
            notificationRouteActive = route.notificationRouteActive,
        )
    }

    private fun isSameWorkspace(profileId: String, project: String, worktreePath: String?): Boolean {
        val current = _state.value
        return current.stage == AppFlowStage.TERMINAL && current.activeProfileId == profileId &&
            current.activeProject == project &&
            WorkspaceFileOwner.normalizeWorktree(current.activeWorktreePath) == WorkspaceFileOwner.normalizeWorktree(worktreePath)
    }

    private fun commitRouteState(
        profileId: String,
        project: String,
        worktreePath: String?,
        sessionId: String?,
        required: TerminalAgentsInstanceKey?,
        notificationRouteActive: Boolean,
    ) {
        _state.update {
            it.copy(
                stage = AppFlowStage.TERMINAL,
                activeProfileId = profileId,
                activeProject = project,
                activeWorktreePath = worktreePath,
                activeSessionId = sessionId,
                settings = null,
                notificationsOpen = false,
                notificationRouteActive = notificationRouteActive,
                requiredTerminalInstance = required,
            )
        }
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

        ordinaryNavigationRequested()
        val guard = departureGuard
        if (guard != null && guard(DepartureRequest(targetStage, { directProceedBack(targetStage) }, {}))) {
            return true
        }
        return directProceedBack(targetStage)
    }

    private fun directProceedBack(targetStage: AppFlowStage): Boolean {
        _state.update { current ->
            current.copy(
                stage = targetStage,
                settings = null,
                notificationsOpen = false,
                requiredTerminalInstance = null,
            )
        }
        return true
    }

    private companion object {
        const val AGENT_SETTINGS_SUB_SECTION = "HOST"
        const val AGENT_SETTINGS_HOST_SECTION = "AGENTS"
    }
}
